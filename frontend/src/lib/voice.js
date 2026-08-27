const PREFERRED_VOICES = [
  "Google UK English Female",
  "Google US English",
  "Microsoft Sonia",
  "Microsoft Aria",
  "Samantha",
  "Karen",
  "Moira",
  "Victoria",
];

export function loadVoices() {
  return new Promise((resolve) => {
    const current = window.speechSynthesis?.getVoices?.() || [];
    if (current.length) return resolve(current);
    window.speechSynthesis.onvoiceschanged = () => {
      resolve(window.speechSynthesis.getVoices() || []);
    };
    setTimeout(() => resolve(window.speechSynthesis?.getVoices?.() || []), 400);
  });
}

export function voicesForLang(voices, lang = "en-IN") {
  const code = String(lang || "en-IN").toLowerCase();
  const prefix = code.split("-")[0];
  const exact = voices.filter((voice) => String(voice.lang || "").toLowerCase().startsWith(code));
  const family = voices.filter((voice) => String(voice.lang || "").toLowerCase().startsWith(prefix));
  const merged = [...exact];
  for (const voice of family) {
    if (!merged.includes(voice)) merged.push(voice);
  }
  return merged.length ? merged : voices;
}

export function pickVoice(voices, preferredName, lang = "en-IN") {
  const code = String(lang || "en-IN").toLowerCase();
  const prefix = code.split("-")[0];
  if (preferredName) {
    const exact = voices.find((voice) => voice.name === preferredName);
    const voiceLang = String(exact?.lang || "").toLowerCase();
    if (exact && (voiceLang.startsWith(code) || voiceLang.startsWith(prefix))) return exact;
  }
  const matching = voicesForLang(voices, lang);
  if (matching !== voices) {
    const female = matching.find((voice) => /female|woman|raveena|aditi|heera|swara/i.test(voice.name));
    if (female) return female;
    if (matching[0]) return matching[0];
  }
  for (const name of PREFERRED_VOICES) {
    const match = voices.find((voice) => voice.name.includes(name) || voice.name === name);
    if (match) return match;
  }
  return (
    voices.find((voice) => /en-(GB|US|IN)/i.test(voice.lang) && /female|samantha|aria|sonia/i.test(voice.name)) ||
    voices.find((voice) => voice.lang.startsWith("en-IN")) ||
    voices.find((voice) => voice.lang.startsWith("en-GB")) ||
    voices.find((voice) => voice.lang.startsWith("en-US")) ||
    voices.find((voice) => voice.lang.startsWith("en")) ||
    voices[0] ||
    null
  );
}

let currentPlayer = null;
let ambientPlayer = null;

export function stopAudio() {
  if (!currentPlayer) return;
  try {
    currentPlayer._zocoStopped = true;
    currentPlayer.pause();
    currentPlayer.removeAttribute("src");
    currentPlayer.load();
  } catch {
    /* ignore */
  }
  currentPlayer = null;
}

export function stopAmbient() {
  if (!ambientPlayer) return;
  try {
    ambientPlayer.pause();
    ambientPlayer.removeAttribute("src");
    ambientPlayer.load();
  } catch {
    /* ignore */
  }
  ambientPlayer = null;
}

export function startAmbient(url, volume = 0.12) {
  stopAmbient();
  if (!url) return null;
  const audio = new Audio(url);
  audio.loop = true;
  audio.volume = Math.min(0.4, Math.max(0.02, Number(volume) || 0.12));
  ambientPlayer = audio;
  audio.play().catch(() => {
    if (ambientPlayer === audio) stopAmbient();
  });
  return audio;
}

export function playAudio(url, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error("No audio to play"));
    window.speechSynthesis?.cancel();
    stopAudio();
    const audio = new Audio(url);
    currentPlayer = audio;
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearInterval(poll);
      if (currentPlayer === audio) {
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
        currentPlayer = null;
      }
      fn(value);
    };
    let timer = setTimeout(() => finish(resolve), timeoutMs);
    const poll = setInterval(() => {
      if (audio._zocoStopped || (currentPlayer && currentPlayer !== audio)) finish(resolve);
      if (!currentPlayer && !settled) finish(resolve);
    }, 80);
    audio.onloadedmetadata = () => {
      const ms = Number(audio.duration) * 1000;
      if (Number.isFinite(ms) && ms > 0) {
        clearTimeout(timer);
        timer = setTimeout(() => finish(resolve), Math.min(timeoutMs, ms + 1200));
      }
    };
    audio.onended = () => finish(resolve);
    audio.onerror = () => {
      if (audio._zocoStopped) finish(resolve);
      else finish(reject, new Error("Could not play the selected voice"));
    };
    audio.play().catch((err) => {
      if (audio._zocoStopped) finish(resolve);
      else finish(reject, new Error(err.message || "Could not play the selected voice"));
    });
  });
}

export function speakText(text, { voice, lang = "en-IN", rate = 0.98, pitch = 1, cancel = true } = {}) {
  return new Promise((resolve) => {
    if (!text || !window.speechSynthesis) return resolve();
    if (cancel) window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const prefix = String(lang || "").split("-")[0].toLowerCase();
    const voiceLang = String(voice?.lang || "").toLowerCase();
    if (voice && (!prefix || voiceLang.startsWith(String(lang || "").toLowerCase()) || voiceLang.startsWith(prefix))) {
      utterance.voice = voice;
    }
    utterance.lang = lang || voice?.lang || "en-IN";
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = 1;
    utterance.onend = () => resolve();
    utterance.onerror = () => resolve();
    window.speechSynthesis.speak(utterance);
  });
}

export function splitSentences(buffer) {
  return pullSpeakable(buffer);
}

/**
 * Pull the next speakable clause from a streaming LLM buffer.
 * Speaks ASAP: sentence end, Indic danda, or early word flush for low TTFA.
 */
export function pullSpeakable(buffer, { force = false, minChars = 8 } = {}) {
  const text = String(buffer || "");
  if (!text.trim()) return { speakable: null, rest: "" };
  if (force) return { speakable: text.trim(), rest: "" };

  const spaced = text.match(/^([\s\S]*?[.!?…])(?:\s+|$)([\s\S]*)$/u);
  if (spaced?.[1]?.trim() && spaced[1].trim().length >= 2) {
    return { speakable: spaced[1].trim(), rest: spaced[2] || "" };
  }

  const danda = text.match(/^([\s\S]*?[।॥])([\s\S]*)$/u);
  if (danda?.[1]?.trim() && danda[1].trim().length >= 2) {
    return { speakable: danda[1].trim(), rest: danda[2] || "" };
  }

  // Early flush: enough words/chars even without punctuation (voice TTFA).
  const trimmed = text.trim();
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length >= 3 || trimmed.length >= Math.max(minChars, 14)) {
    const soft = text.match(/^([\s\S]{4,}?[,;，、])\s+([\s\S]+)$/u);
    if (soft?.[1]?.trim()) {
      return { speakable: soft[1].trim(), rest: soft[2] || "" };
    }
    // Split after 3–5 words so TTS can start while LLM continues.
    if (words.length >= 3) {
      const cut = Math.min(5, Math.max(3, words.length - 1));
      const head = words.slice(0, cut).join(" ");
      const tail = words.slice(cut).join(" ");
      if (head.length >= 4) return { speakable: head, rest: tail ? `${tail}${/\s$/.test(text) ? " " : ""}` : "" };
    }
  }

  return { speakable: null, rest: text };
}

/**
 * Ordered TTS playback queue — speak sentence N while N+1 may still be generating.
 */
export function createSpeechQueue({ play, onStart, onIdle, isAborted } = {}) {
  let items = [];
  let running = false;
  let generation = 0;
  let resolveIdle = null;

  function signalIdle() {
    onIdle?.();
    if (resolveIdle) {
      resolveIdle();
      resolveIdle = null;
    }
  }

  function waitIdle() {
    if (!running && !items.length) return Promise.resolve();
    return new Promise((resolve) => {
      const prev = resolveIdle;
      resolveIdle = () => {
        prev?.();
        resolve();
      };
    });
  }

  async function pump() {
    if (running) return;
    running = true;
    const gen = generation;
    onStart?.();
    try {
      while (items.length && gen === generation && !isAborted?.()) {
        const next = items.shift();
        await play(next);
      }
    } catch {
      /* keep draining */
    } finally {
      if (gen === generation) {
        running = false;
        if (items.length && !isAborted?.()) pump();
        else signalIdle();
      }
    }
  }

  return {
    push(text) {
      const clean = String(text || "").replace(/\[END:[a-z_]+\]/gi, "").trim();
      if (!clean || isAborted?.()) return;
      items.push(clean);
      pump();
    },
    flush(text) {
      this.push(text);
    },
    clear() {
      generation += 1;
      items = [];
      running = false;
      signalIdle();
    },
    drain() {
      return waitIdle();
    },
    get pending() {
      return items.length;
    },
    get busy() {
      return running || items.length > 0;
    },
  };
}

/** RMS 0–1 from AnalyserNode time-domain data. */
export function analyserRms(analyser, buffer) {
  if (!analyser) return 0;
  const data = buffer || new Uint8Array(analyser.fftSize);
  analyser.getByteTimeDomainData(data);
  let sum = 0;
  for (let i = 0; i < data.length; i += 1) {
    const n = (data[i] - 128) / 128;
    sum += n * n;
  }
  return Math.sqrt(sum / data.length);
}

/** Map callSettings.volumeThresholdDb (−60…0) to RMS threshold. */
export function rmsFromDb(db = -50) {
  const clamped = Math.min(-10, Math.max(-70, Number(db) || -50));
  return Math.max(0.008, Math.min(0.12, 10 ** (clamped / 20)));
}

const TTS_PUNCT = /[!?¿¡؟।॥…,.;:"""''`()[\]{}]/g;
const NOISE_PHRASE =
  /exclamation\s*(point|mark)?|question\s*mark|full\s*stop|\bperiod\b|\bcomma\b|एक्सक्लेमेशन(?:\s*(?:पॉइंट|प्वाइंट|प्वाइन्ट))?|एक्स्क्लेमेशन|क्वेश्चन\s*मार्क|फुल\s*स्टॉप|प्रश्न\s*चिह्न|पूर्ण\s*विराम/gi;
const NOISE_LEFTOVER = /^(point|mark|stop|पॉइंट|प्वाइंट|प्वाइन्ट)?$/i;

export function spokenForTts(text) {
  return String(text || "")
    .replace(/\[END:[a-z_]+\]/gi, "")
    .replace(TTS_PUNCT, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compactSpeech(text) {
  return String(text || "")
    .toLowerCase()
    .replace(NOISE_PHRASE, " ")
    .replace(TTS_PUNCT, "")
    .replace(/\s+/g, "");
}

export function isNoiseTranscript(heard, lastSpoken = "") {
  const raw = String(heard || "").trim();
  if (!raw) return true;
  const leftover = raw.replace(NOISE_PHRASE, " ").replace(TTS_PUNCT, " ").replace(/\s+/g, " ").trim();
  if (!leftover || leftover.length < 2 || NOISE_LEFTOVER.test(leftover)) return true;
  const heardBits = compactSpeech(raw);
  const spokenBits = compactSpeech(lastSpoken);
  if (heardBits && spokenBits && (spokenBits.includes(heardBits) || (heardBits.length >= 8 && heardBits.includes(spokenBits)))) {
    return true;
  }
  return false;
}
