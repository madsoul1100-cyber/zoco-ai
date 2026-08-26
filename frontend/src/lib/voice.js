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
      if (currentPlayer === audio) stopAudio();
      fn(value);
    };
    let timer = setTimeout(() => finish(resolve), timeoutMs);
    audio.onloadedmetadata = () => {
      const ms = Number(audio.duration) * 1000;
      if (Number.isFinite(ms) && ms > 0) {
        clearTimeout(timer);
        timer = setTimeout(() => finish(resolve), Math.min(timeoutMs, ms + 1200));
      }
    };
    audio.onended = () => finish(resolve);
    audio.onerror = () => finish(reject, new Error("Could not play the selected voice"));
    audio.play().catch((err) => finish(reject, new Error(err.message || "Could not play the selected voice")));
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
  const match = buffer.match(/^([\s\S]*?[.!?])\s+([\s\S]*)$/);
  if (!match) return { sentence: null, rest: buffer };
  return { sentence: match[1].trim(), rest: match[2] };
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
