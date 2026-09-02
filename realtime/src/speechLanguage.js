const ROMAN_HINDI =
  /\b(hai|hain|kya|nahi|nahin|mein|baat|karo|bolo|samajh|aap|hum|theek|bilkul)\b/i;
const ENGLISH_MARKERS =
  /\b(the|is|are|you|your|because|please|about|this|that|have|has|will|would|could|don't|dont|understand)\b/gi;

function latinCount(raw) {
  return (String(raw || "").match(/[A-Za-z]/g) || []).length;
}

export function looksLikeEnglishSentence(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/[\u0900-\u097F\u0C00-\u0C7F]/.test(raw)) return false;
  if (ROMAN_HINDI.test(raw)) return false;
  const markers = raw.match(ENGLISH_MARKERS) || [];
  return markers.length >= 3 && latinCount(raw) >= 28;
}

export function detectSpeechLanguage(text, current = "te") {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const hasHindi = /[\u0900-\u097F]/.test(raw);
  const hasTelugu = /[\u0C00-\u0C7F]/.test(raw);
  const askedHindi =
    (/\bhindi\b/i.test(raw) && /\b(talk|speak|in|mein|me|baat|please|karo|bolo|can|you|ho)\b/i.test(raw)) ||
    (/हिंदी|हिन्दी/.test(raw) && /बात|बोल|में/.test(raw));
  const askedEnglish =
    (/\benglish\b/i.test(raw) && /\b(talk|speak|in|mein|please|can|you)\b/i.test(raw)) ||
    (/ఇంగ్లీష్|ఇంగ్లిష్/.test(raw) && /మాట్లాడ/.test(raw));
  const askedTelugu = /తెలుగు/.test(raw) && /మాట్లాడ/.test(raw);

  if (askedHindi) return "hi";
  if (askedEnglish) return "en";
  if (askedTelugu) return "te";
  if (/(?:don't|dont|do not)\s+understand/i.test(raw) && /\btelugu\b/i.test(raw)) return "en";
  if (hasHindi && !hasTelugu) return "hi";
  if (hasTelugu) return "te";
  if (current === "hi" || current === "te") {
    return looksLikeEnglishSentence(raw) ? "en" : null;
  }
  if (looksLikeEnglishSentence(raw)) return "en";
  return null;
}

export function looksLikeSttNoise(text, current = "te") {
  const raw = String(text || "").trim();
  if (!raw) return true;
  const words = raw.split(/\s+/).filter(Boolean);
  const letters = latinCount(raw);
  if (/^(yes|yeah|yep|ok|okay|no|nope|sure|haan|हां|जी|hi|hello)$/i.test(raw)) return false;

  if (current === "en") {
    if (words.length === 1 && letters < 12) return true;
    if (words.length <= 4 && letters < 22 && /^(i am|you are|i said|i saying)\b/i.test(raw) && !/[.!?]$/.test(raw)) {
      return true;
    }
    return false;
  }

  if (current !== "hi" && current !== "te") return false;
  if (/[\u0900-\u097F\u0C00-\u0C7F]/.test(raw)) return false;
  if (ROMAN_HINDI.test(raw) && letters >= 12) return false;
  if (/^(?:no\.?\s*){2,}/i.test(raw)) return true;
  if (/^hello\??\.?$/i.test(raw)) return true;
  if (/\bwho\b/i.test(raw) && words.length <= 4) return true;
  if (words.length <= 4 && letters < 24) return true;
  return false;
}

function compactSpeech(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, "");
}

export function isLikelyAgentEcho(heard, lastSpoken = "") {
  const raw = String(heard || "").trim();
  const spoken = String(lastSpoken || "").trim();
  if (!raw || !spoken) return false;
  const heardBits = compactSpeech(raw);
  const spokenBits = compactSpeech(spoken);
  if (heardBits.length >= 4 && spokenBits.includes(heardBits)) return true;
  if (heardBits.length >= 6 && spokenBits.includes(heardBits.slice(0, Math.min(heardBits.length, 18)))) return true;

  const heardWords = raw.split(/\s+/).filter(Boolean);
  const spokenWords = spoken.split(/\s+/).filter((w) => compactSpeech(w).length >= 3);
  const spokenSet = new Set(spokenWords.map((w) => compactSpeech(w)));
  const overlap = heardWords.filter((w) => spokenSet.has(compactSpeech(w))).length;
  if (heardWords.length && overlap / heardWords.length >= 0.5) return true;

  const brands = [...new Set((spoken.match(/[A-Za-z]{4,}/g) || []).map((w) => w.toLowerCase()))];
  const heardLatin = raw.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (heardWords.length <= 4) {
    for (const brand of brands) {
      if (heardLatin.length >= 4 && (heardLatin === brand || brand.includes(heardLatin) || heardLatin.includes(brand))) {
        return true;
      }
    }
  }
  if (
    heardWords.length <= 5
    && !/[?।]|कब|क्या|बताइए|चाहिए|\bwhen\b|\bwhich\b|\bbook\b/i.test(raw)
    && brands.some((b) => /care|clinic|point|meera|priya|anika|nova|fixit/.test(b))
    && /केयर|प्वाइंट|क्लिनिक|मीरा|प्रिया|केयरपॉइंट/i.test(raw)
  ) {
    return true;
  }
  return false;
}
