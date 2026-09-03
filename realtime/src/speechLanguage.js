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

/**
 * Explicit caller language-switch requests only.
 * Includes Telugu-script STT of Hindi/English requests when Deepgram is pinned to `te`
 * (e.g. "హిందీవే బాతకరు" for "हिंदी में बात करो").
 */
export function detectExplicitLanguageSwitch(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  const lower = raw.toLowerCase();

  if (
    (/\bhindi\b/.test(lower) && /\b(talk|speak|in|mein|me|baat|please|karo|bolo|can|you|ho|se|mujhe|mujhse)\b/.test(lower))
    || (/हिंदी|हिन्दी/.test(raw) && /बात|बोल|में|करो|कर|मुझ/.test(raw))
    || (/హిందీ|హింది/.test(raw) && /బాత|మాట|మాట్లాడ|కరు|బోల|మేము|మాట్ల/.test(raw))
  ) {
    return "hi";
  }

  if (
    (/\benglish\b/.test(lower) && /\b(talk|speak|in|mein|please|can|you|don't|dont|understand)\b/.test(lower))
    || (/(?:don't|dont|do not)\s+understand/.test(lower) && /\btelugu\b/.test(lower))
    || (/अंग्रेजी|इंग्लिश/.test(raw) && /बात|बोल|में/.test(raw))
    || (/ఇంగ్లీష్|ఇంగ్లిష్|ఇంగ్లీషు/.test(raw) && /మాట్లాడ|మాట|బాత|అర్థం|అర్ధం/.test(raw))
  ) {
    return "en";
  }

  if (
    (/\btelugu\b/.test(lower) && /\b(talk|speak|in|mein|please|baat|karo|bolo)\b/.test(lower))
    || (/తెలుగు/.test(raw) && /మాట్లాడ/.test(raw))
  ) {
    return "te";
  }

  return null;
}

/**
 * @param {string} text
 * @param {string} current
 * @param {{ locked?: boolean }} [opts]
 * When locked=true after an explicit switch, do not flip STT back to Telugu
 * just because Deepgram still emits Telugu script for Hindi audio.
 */
export function detectSpeechLanguage(text, current = "te", opts = {}) {
  const raw = String(text || "").trim();
  if (!raw) return null;

  const explicit = detectExplicitLanguageSwitch(raw);
  if (explicit) return explicit;

  if (opts.locked) {
    // Still allow a clear English sentence to leave hi/te without saying "English".
    if ((current === "hi" || current === "te") && looksLikeEnglishSentence(raw)) return "en";
    return null;
  }

  const hasHindi = /[\u0900-\u097F]/.test(raw);
  const hasTelugu = /[\u0C00-\u0C7F]/.test(raw);

  if (hasHindi && !hasTelugu) return "hi";
  if (hasTelugu) return "te";
  if (current === "hi" || current === "te") {
    return looksLikeEnglishSentence(raw) ? "en" : null;
  }
  if (looksLikeEnglishSentence(raw)) return "en";
  return null;
}

export function isShortAffirmation(text) {
  const normalized = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return /^(yes|yeah|yep|yup|sure|ok|okay|correct|right|haan|हां|जी|go ahead|yeah sure|yes please|yeah yeah|yes yes|yeah yeah go ahead|yes go ahead|sure go ahead|please go ahead)$/i.test(
    normalized
  );
}

export function looksLikeSttNoise(text, current = "te") {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (isShortAffirmation(raw)) return false;
  if (detectExplicitLanguageSwitch(raw)) return false;
  const normalized = raw.replace(/[^\p{L}\p{M}\p{N}\s]+/gu, " ").replace(/\s+/g, " ").trim();
  const words = normalized.split(/\s+/).filter(Boolean);
  const letters = latinCount(normalized);
  // Short acks are real turns in any language (incl. "Yes." with punctuation).
  if (/^(yes|yeah|yep|ok|okay|no|nope|sure|haan|हां|जी)$/i.test(normalized)) return false;
  if (current === "en" && /^(hi|hello)$/i.test(normalized)) return false;

  if (current === "en") {
    if (words.length === 1 && letters < 12) return true;
    if (words.length <= 4 && letters < 22 && /^(i am|you are|i said|i saying)\b/i.test(normalized) && !/[.!?]$/.test(raw)) {
      return true;
    }
    return false;
  }

  if (current !== "hi" && current !== "te") return false;
  if (/[\u0900-\u097F\u0C00-\u0C7F]/.test(raw)) return false;
  if (ROMAN_HINDI.test(normalized) && letters >= 12) return false;
  if (/^(?:no\.?\s*){2,}/i.test(raw)) return true;
  if (/^hello\??\.?$/i.test(raw) || /^hello$/i.test(normalized)) return true;
  if (/\bwho\b/i.test(normalized) && words.length <= 4) return true;
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
