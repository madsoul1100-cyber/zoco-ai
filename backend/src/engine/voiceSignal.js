/** Shared voice turn-taking helpers (mirrors frontend/src/lib/voice.js for PSTN streams). */

const TTS_PUNCT = /[!?¿¡؟।॥…,.;:"""''`()[\]{}]/g;
const NOISE_PHRASE =
  /exclamation\s*(point|mark)?|question\s*mark|full\s*stop|\bperiod\b|\bcomma\b|एक्सक्लेमेशन(?:\s*(?:पॉइंट|प्वाइंट|प्वाइन्ट))?|एक्स्क्लेमेशन|क्वेश्चन\s*मार्क|फुल\s*स्टॉप|प्रश्न\s*चिह्न|पूर्ण\s*विराम/gi;
const NOISE_LEFTOVER = /^(point|mark|stop|पॉइंट|प्वाइंट|प्वाइन्ट)?$/i;

export function isUrgentUserCommand(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/\bhindi\b.*\b(mein|me|baat|bolo|karo|kariye|please)\b|\bin hindi\b|\bhindi please\b|हिंदी|हिन्दी|హిందీ/i.test(raw)) {
    return true;
  }
  if (/\b(english|angrezi)\b.*\b(mein|me|please|baat|speak)\b|\bin english\b|\benglish please\b/i.test(raw)) {
    return true;
  }
  if (/^(stop|please stop|wait|hold on|रुको|रुकिए|बस|मत बोलो|ఆపు|వద్దు|చాలు)\b/iu.test(raw)) return true;
  if (/please stop|stop talking|not interested/i.test(raw)) return true;
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
  if (isUrgentUserCommand(normalized)) return true;
  const words = normalized.match(/[\p{L}\p{M}\p{N}'’]+/gu) || [];
  return words.length >= 3 && normalized.length >= 8;
}

function compactSpeech(text) {
  return String(text || "")
    .toLowerCase()
    .replace(NOISE_PHRASE, " ")
    .replace(TTS_PUNCT, "")
    .replace(/\s+/g, "");
}

export function isLikelyAgentEcho(heard, lastSpoken = "") {
  const heardBits = compactSpeech(heard);
  const spokenBits = compactSpeech(lastSpoken);
  if (!heardBits || !spokenBits) return false;
  if (spokenBits.includes(heardBits)) return true;
  if (heardBits.length >= 6 && heardBits.includes(spokenBits.slice(0, Math.min(24, spokenBits.length)))) {
    return true;
  }
  const heardWords = String(heard || "").trim().split(/\s+/).filter(Boolean);
  const spokenWords = String(lastSpoken || "").trim().split(/\s+/).filter(Boolean);
  if (heardWords.length <= 2 && spokenWords.length >= 3) {
    const prefix = spokenWords.slice(0, 4).join(" ");
    if (prefix.includes(heardWords.join(" "))) return true;
  }
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

export function normalizeVoiceTranscript(text) {
  const raw = String(text || "").trim();
  if (
    /\bniacin\b|नियासिन/i.test(raw)
    && /(?:saath|साथ).{0,16}(?:kholo|खोलो)/i.test(raw)
  ) {
    return "Hindi mein baat karo";
  }
  return raw
    .replace(/\bVomitin\b|\bvomitin\b/gi, "Form 18")
    .replace(/महाली|मोहली/gi, "मोहाली")
    .replace(/\s+/g, " ")
    .trim();
}

export function pcmRms(pcm) {
  if (!pcm?.length) return 0;
  const samples = Math.floor(pcm.length / 2);
  if (!samples) return 0;
  let sum = 0;
  for (let i = 0; i < pcm.length; i += 2) {
    const sample = pcm.readInt16LE(i) / 32768;
    sum += sample * sample;
  }
  return Math.sqrt(sum / samples);
}

export function rmsFromDb(db = -50) {
  const clamped = Math.min(-10, Math.max(-70, Number(db) || -50));
  return Math.max(0.008, Math.min(0.12, 10 ** (clamped / 20)));
}

export function silenceMsFromEagerness(eagerness = 7) {
  return Math.max(800, 400 + (11 - Number(eagerness || 7)) * 100);
}

export function nudgeDelayMs(agent) {
  const nudges = Array.isArray(agent?.callSettings?.nudges) ? agent.callSettings.nudges : [];
  const index = 0;
  const next = nudges[index];
  const seconds = Number(next?.afterSeconds || 14);
  return Math.max(8, seconds) * 1000;
}
