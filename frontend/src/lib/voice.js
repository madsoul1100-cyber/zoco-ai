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

/** Explicit language-switch ask — never match the agent's own Telugu greeting. */
export function isLanguageSwitchCommand(text) {
  const raw = String(text || "")
    .trim()
    .replace(/ప్లీజ్|ప్లీస్/gi, "please")
    .replace(/హలో|హెలో/gi, "hello")
    .replace(/కెన్|కాన్/gi, "can")
    .replace(/యూ|యు/gi, "you")
    .replace(/టాక్|టాకు/gi, "talk")
    .replace(/ఇన్/gi, "in")
    .replace(/హిందీ|హింది/gi, "hindi")
    .replace(/ఇంగ్లీష్|ఇంగ్లిష్|ఇంగ్లీషు/gi, "english")
    .replace(/బాత్|బాతు/gi, "baat")
    .replace(/కరో|కరియే/gi, "karo")
    .replace(/మాట్లాడండి|మాట్లాడు|మాట్లాడ/gi, "baat")
    .replace(/\bమే\b|లో\b/gi, "mein");
  if (!raw) return false;
  if (/\bhindi\b/i.test(raw) && /\b(talk|speak|in|mein|me|baat|can|you|please|hello|karo|bolo)\b/i.test(raw)) {
    return true;
  }
  if (/हिंदी|हिन्दी/.test(raw) && /(में|बात|बोल|कर)/.test(raw)) return true;
  if (/\benglish\b/i.test(raw) && /\b(talk|speak|in|mein|me|can|you|please|hello)\b/i.test(raw)) {
    return true;
  }
  if (/\btelugu\b.*\b(lo|mein|me|please|baat|speak|talk)\b|\bin telugu\b|తెలుగులో/i.test(raw)) return true;
  return false;
}

export function isMeaningfulBargeIn(text) {
  const normalized = String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}'’]+/gu, " ")
    .trim();
  if (!normalized) return false;
  const strongCommand = /^(stop|please stop|no|nope|wait|hold on|रुको|रुकिए|बस|नहीं|मत बोलो|ఆపు|వద్దు|చాలు)$/iu;
  if (strongCommand.test(normalized)) return true;
  if (isLanguageSwitchCommand(normalized)) return true;
  if (/please stop|stop talking|not interested|don't call|do not call|मेरी बात|बात पूरी|रुक|सुनो|wait a minute|let me finish|hold on/i.test(normalized)) return true;
  const words = normalized.match(/[\p{L}\p{M}\p{N}'’]+/gu) || [];
  // Require a real phrase — short fragments of agent echo must not barge in.
  return words.length >= 3 && normalized.length >= 8;
}

/** Stop / language-switch only — do NOT match generic Telugu "మాట్లాడ" from the agent's greeting. */
export function isUrgentUserCommand(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isLanguageSwitchCommand(raw)) return true;
  if (/^(stop|please stop|wait|hold on|रुको|रुकिए|बस|मत बोलो|ఆపు|వద్దు|చాలు)\b/iu.test(raw)) return true;
  if (/please stop|stop talking|not interested/i.test(raw)) return true;
  return false;
}

export function stripModelControlText(text) {
  return String(text || "")
    .replace(
      /^\s*(?:knowledge(?:\s+base(?:\s+query)?)?|voice(?:\s+stream)?|language(?:\s+lock)?|instructions?|system)\b[^\n]*(?:\n|$)/gim,
      ""
    )
    .replace(/\[END:[a-z_]+\]/gi, "")
    .trimStart();
}

export function normalizeVoiceTranscript(text) {
  const raw = String(text || "").trim();
  if (
    /\bniacin\b|नियासिन/i.test(raw)
    && /(?:saath|साथ).{0,16}(?:kholo|खोलो)/i.test(raw)
  ) {
    return "Hindi mein baat karo";
  }
  let next = raw
    .replace(/ప్లీజ్|ప్లీస్/gi, "please")
    .replace(/హలో|హెలో/gi, "hello")
    .replace(/కెన్|కాన్/gi, "can")
    .replace(/యూ|యు/gi, "you")
    .replace(/టాక్|టాకు/gi, "talk")
    .replace(/ఇన్/gi, "in")
    .replace(/హిందీ|హింది/gi, "hindi")
    .replace(/ఇంగ్లీష్|ఇంగ్లిష్|ఇంగ్లీషు/gi, "english")
    .replace(/బాత్|బాతు/gi, "baat")
    .replace(/కరో|కరియే/gi, "karo")
    .replace(/మాట్లాడండి|మాట్లాడు/gi, "baat kariye")
    .replace(/\bమే\b|లో\b/gi, "mein")
    // Common Hindi STT corruptions
    .replace(/\bVomitin\b|\bvomitin\b|\bform\s*eat(een|en)\b|\bform\s*aitin\b/gi, "Form 18")
    .replace(/फॉर्म\s*एटीन|फॉर्म\s*एटिन|वोमिटिन/gi, "Form 18")
    .replace(/महाली|मोहाली|मोहली/gi, "मोहाली")
    .replace(/\bmohali\b/gi, "मोहाली")
    .replace(/\s+/g, " ")
    .trim();
  if (/\bhindi\b/i.test(next) && /\b(talk|speak|in|mein|me|baat|can|you|please|hello|karo)\b/i.test(next)) {
    return "Hindi mein baat kariye";
  }
  if (/\benglish\b/i.test(next) && /\b(talk|speak|in|mein|me|can|you|please|hello)\b/i.test(next)) {
    return "Please talk in English";
  }
  return next;
}

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

function connectRecordingCapture(audio, context, destination) {
  if (!audio || !context || !destination) return null;
  try {
    const source = context.createMediaElementSource(audio);
    source.connect(context.destination);
    source.connect(destination);
    return source;
  } catch {
    return null;
  }
}

export function stopAudio() {
  if (!currentPlayer) return;
  const player = currentPlayer;
  currentPlayer = null;
  try {
    player._zocoStopped = true;
    player._zocoClose?.();
    player.pause();
    player.removeAttribute("src");
    player.load();
  } catch {
    /* ignore */
  }
}

function base64Bytes(value) {
  const binary = atob(String(value || ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Progressive Sarvam TTS playback. Audio starts on the first MP3 chunk instead
 * of waiting for a complete REST-generated file.
 */
export function playStreamingTts(payload, {
  firstAudioTimeoutMs = 10000,
  captureContext,
  captureDestination,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!window.MediaSource?.isTypeSupported?.("audio/mpeg")) {
      reject(new Error("Streaming audio is not supported by this browser."));
      return;
    }

    stopAudio();
    window.speechSynthesis?.cancel();

    const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(`${proto}//${window.location.host}/api/tts/stream`);
    const mediaSource = new MediaSource();
    const objectUrl = URL.createObjectURL(mediaSource);
    const audio = new Audio(objectUrl);
    audio.preload = "auto";
    currentPlayer = audio;
    const captureSource = connectRecordingCapture(audio, captureContext, captureDestination);

    let sourceBuffer = null;
    let settled = false;
    let streamDone = false;
    let playbackStarted = false;
    let receivedAudio = false;
    const chunks = [];
    const timer = setTimeout(() => {
      finish(reject, new Error("Streaming voice timed out."));
    }, firstAudioTimeoutMs);

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: "stop" }));
        }
        socket.close();
      } catch {
        /* ignore */
      }
      if (currentPlayer === audio) currentPlayer = null;
      try {
        captureSource?.disconnect();
      } catch {
        /* ignore */
      }
      setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      fn(value);
    };

    const maybePlay = () => {
      if (playbackStarted || !receivedAudio || audio._zocoStopped) return;
      playbackStarted = true;
      audio.play().catch((error) => {
        finish(reject, new Error(error.message || "Could not play streaming voice."));
      });
    };

    const appendNext = () => {
      if (!sourceBuffer || sourceBuffer.updating || settled) return;
      if (chunks.length) {
        const chunk = chunks.shift();
        try {
          sourceBuffer.appendBuffer(chunk);
        } catch (error) {
          finish(reject, error);
        }
        return;
      }
      if (streamDone && mediaSource.readyState === "open") {
        try {
          mediaSource.endOfStream();
        } catch {
          /* updateend will retry */
        }
      }
    };

    audio._zocoClose = () => finish(resolve);
    audio.onended = () => finish(resolve);
    audio.onerror = () => {
      if (audio._zocoStopped) finish(resolve);
      else finish(reject, new Error("Could not play streaming voice."));
    };

    mediaSource.addEventListener("sourceopen", () => {
      if (settled) return;
      try {
        sourceBuffer = mediaSource.addSourceBuffer("audio/mpeg");
        sourceBuffer.mode = "sequence";
        sourceBuffer.addEventListener("updateend", () => {
          maybePlay();
          appendNext();
        });
        sourceBuffer.addEventListener("error", () => {
          finish(reject, new Error("Streaming audio buffer failed."));
        });
        appendNext();
      } catch (error) {
        finish(reject, error);
      }
    }, { once: true });

    socket.onmessage = (event) => {
      let message = null;
      try {
        message = JSON.parse(String(event.data || ""));
      } catch {
        return;
      }
      if (message.type === "ready") {
        socket.send(JSON.stringify({ type: "start", ...payload }));
        return;
      }
      if (message.type === "audio" && message.audio) {
        receivedAudio = true;
        clearTimeout(timer);
        chunks.push(base64Bytes(message.audio));
        appendNext();
        return;
      }
      if (message.type === "done") {
        streamDone = true;
        appendNext();
        return;
      }
      if (message.type === "error") {
        finish(reject, new Error(message.error || "Streaming voice failed."));
      }
    };
    socket.onerror = () => {
      if (!receivedAudio) finish(reject, new Error("Streaming voice connection failed."));
    };
  });
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

export function playAudio(url, {
  timeoutMs = 120000,
  captureContext,
  captureDestination,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!url) return reject(new Error("No audio to play"));
    window.speechSynthesis?.cancel();
    stopAudio();
    const audio = new Audio(url);
    audio.preload = "auto";
    currentPlayer = audio;
    const captureSource = connectRecordingCapture(audio, captureContext, captureDestination);
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
      try {
        captureSource?.disconnect();
      } catch {
        /* ignore */
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
        timer = setTimeout(() => finish(resolve), Math.min(timeoutMs, ms + 400));
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
 * Only split on real sentence ends — comma splits caused each clip to sound like a different voice.
 */
export function pullSpeakable(buffer, { force = false } = {}) {
  const text = String(buffer || "");
  if (!text.trim()) return { speakable: null, rest: "" };
  if (force) return { speakable: text.trim(), rest: "" };

  // Prefer holding a short two-sentence turn in one clip when possible.
  const ends = [...text.matchAll(/[.!?…।॥]/gu)];
  if (ends.length >= 1) {
    const first = ends[0].index + 1;
    const chunk = text.slice(0, first).trim();
    const rest = text.slice(first).trimStart();
    // If the first sentence is very short (ack only), wait for more unless force.
    if (chunk.length < 12 && rest) {
      if (ends.length >= 2) {
        const second = ends[1].index + 1;
        return { speakable: text.slice(0, second).trim(), rest: text.slice(second).trimStart() };
      }
      return { speakable: null, rest: text };
    }
    if (chunk) return { speakable: chunk, rest };
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
  // Keep sentence punctuation for natural TTS prosody (pauses / questions).
  return String(text || "")
    .replace(/(?:Knowledge Base Query|VOICE STREAM|LANGUAGE LOCK)\s*:\s*[^?\n]*\?\s*/gi, "")
    .replace(/^\s*(?:Knowledge Base Query|VOICE STREAM|LANGUAGE LOCK|Instructions?|System)\s*:\s*/gim, "")
    .replace(/\[END:[a-z_]+\]/gi, "")
    .replace(/["""''`()[\]{}]/g, " ")
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

/** True when STT is hearing the agent's own TTS (speaker → mic echo). */
export function isLikelyAgentEcho(heard, lastSpoken = "") {
  const heardBits = compactSpeech(heard);
  const spokenBits = compactSpeech(lastSpoken);
  if (!heardBits || !spokenBits) return false;
  if (spokenBits.includes(heardBits)) return true;
  if (heardBits.length >= 6 && spokenBits.includes(heardBits.slice(0, Math.min(heardBits.length, 18)))) return true;
  if (heardBits.length >= 8 && heardBits.includes(spokenBits.slice(0, Math.min(24, spokenBits.length)))) return true;
  const heardWords = String(heard || "").trim().split(/\s+/).filter(Boolean);
  const spokenWords = String(lastSpoken || "").trim().split(/\s+/).filter(Boolean);
  if (!heardWords.length || !spokenWords.length) return false;
  const spokenSet = new Set(spokenWords.map((w) => compactSpeech(w)).filter(Boolean));
  const overlap = heardWords.filter((w) => spokenSet.has(compactSpeech(w))).length;
  if (heardWords.length <= 4 && overlap >= Math.ceil(heardWords.length * 0.6)) return true;
  if (heardWords.length >= 3 && overlap / heardWords.length >= 0.55) return true;
  return false;
}

export function isNoiseTranscript(heard, lastSpoken = "") {
  const raw = String(heard || "").trim();
  if (!raw) return true;
  if (isLikelyAgentEcho(raw, lastSpoken)) return true;
  if (/^(?:m+|h+m+|u+h+|u+m+)[\s.,!?-]*$/i.test(raw) || /^(?:హ్మ్|అం|हम्म|उम्)[\s.,!?-]*$/u.test(raw)) {
    return true;
  }
  const leftover = raw.replace(NOISE_PHRASE, " ").replace(TTS_PUNCT, " ").replace(/\s+/g, " ").trim();
  if (!leftover || leftover.length < 2 || NOISE_LEFTOVER.test(leftover)) return true;
  const heardBits = compactSpeech(raw);
  const spokenBits = compactSpeech(lastSpoken);
  if (heardBits && spokenBits && (spokenBits.includes(heardBits) || (heardBits.length >= 8 && heardBits.includes(spokenBits)))) {
    return true;
  }
  return false;
}
