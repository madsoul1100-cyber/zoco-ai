const LANGUAGES = [
  {
    code: "en-IN",
    label: "English (India)",
    native: "English",
    gather: "en-IN",
    sayLanguage: "en-IN",
    sayVoice: "Polly.Raveena",
    missed: "Sorry, I missed that. Please say it again.",
    inactive: "This call is no longer active.",
  },
  {
    code: "hi-IN",
    label: "Hindi",
    native: "हिन्दी",
    gather: "hi-IN",
    sayLanguage: "hi-IN",
    sayVoice: "Google.hi-IN-Standard-A",
    missed: "माफ़ कीजिए, मैं सुन नहीं पाई। फिर से बोलिए।",
    inactive: "यह कॉल अब सक्रिय नहीं है।",
  },
  {
    code: "ta-IN",
    label: "Tamil",
    native: "தமிழ்",
    gather: "ta-IN",
    sayLanguage: "ta-IN",
    sayVoice: "Google.ta-IN-Standard-A",
    missed: "மன்னிக்கவும், எனக்குப் புரியவில்லை. மீண்டும் சொல்லுங்கள்.",
    inactive: "இந்த அழைப்பு இப்போது செயலில் இல்லை.",
  },
  {
    code: "te-IN",
    label: "Telugu",
    native: "తెలుగు",
    gather: "te-IN",
    sayLanguage: "te-IN",
    sayVoice: "Google.te-IN-Standard-A",
    missed: "క్షమించండి, నాకు వినిపించలేదు. మళ్లీ చెప్పండి.",
    inactive: "ఈ కాల్ ఇప్పుడు యాక్టివ్‌గా లేదు.",
  },
  {
    code: "pa-IN",
    label: "Punjabi",
    native: "ਪੰਜਾਬੀ",
    gather: "pa-IN",
    sayLanguage: "pa-IN",
    sayVoice: "Google.pa-IN-Standard-A",
    missed: "ਮਾਫ਼ ਕਰੋ, ਮੈਂ ਸੁਣ ਨਹੀਂ ਸਕੀ। ਫਿਰ ਬੋਲੋ ਜੀ।",
    inactive: "ਇਹ ਕਾਲ ਹੁਣ ਐਕਟਿਵ ਨਹੀਂ ਹੈ।",
  },
  {
    code: "bn-IN",
    label: "Bengali",
    native: "বাংলা",
    gather: "bn-IN",
    sayLanguage: "bn-IN",
    sayVoice: "Google.bn-IN-Standard-A",
    missed: "মাফ করবেন, শুনতে পাইনি। আবার বলুন।",
    inactive: "এই কল এখন সক্রিয় নেই।",
  },
  {
    code: "mr-IN",
    label: "Marathi",
    native: "मराठी",
    gather: "mr-IN",
    sayLanguage: "mr-IN",
    sayVoice: "Google.mr-IN-Standard-A",
    missed: "माफ करा, ऐकू आले नाही. पुन्हा सांगा.",
    inactive: "ही कॉल आता सक्रिय नाही.",
  },
  {
    code: "gu-IN",
    label: "Gujarati",
    native: "ગુજરાતી",
    gather: "gu-IN",
    sayLanguage: "gu-IN",
    sayVoice: "Google.gu-IN-Standard-A",
    missed: "માફ કરશો, સાંભળી ન શકાયું. ફરી કહો.",
    inactive: "આ કૉલ હવે સક્રિય નથી.",
  },
  {
    code: "kn-IN",
    label: "Kannada",
    native: "ಕನ್ನಡ",
    gather: "kn-IN",
    sayLanguage: "kn-IN",
    sayVoice: "Google.kn-IN-Standard-A",
    missed: "ಕ್ಷಮಿಸಿ, ಕೇಳಿಸಲಿಲ್ಲ. ಮತ್ತೆ ಹೇಳಿ.",
    inactive: "ಈ ಕರೆ ಈಗ ಸಕ್ರಿಯವಾಗಿಲ್ಲ.",
  },
  {
    code: "ml-IN",
    label: "Malayalam",
    native: "മലയാളം",
    gather: "ml-IN",
    sayLanguage: "ml-IN",
    sayVoice: "Google.ml-IN-Standard-A",
    missed: "ക്ഷമിക്കണം, കേട്ടില്ല. വീണ്ടും പറയൂ.",
    inactive: "ഈ കോൾ ഇപ്പോൾ സജീവമല്ല.",
  },
  {
    code: "ur-IN",
    label: "Urdu",
    native: "اردو",
    gather: "ur-IN",
    sayLanguage: "ur-IN",
    sayVoice: "Google.ur-IN-Standard-A",
    missed: "معاف کیجیے، سن نہیں پائی۔ دوبارہ بولیں۔",
    inactive: "یہ کال اب فعال نہیں ہے۔",
  },
  {
    code: "or-IN",
    label: "Odia",
    native: "ଓଡ଼ିଆ",
    gather: "or-IN",
    sayLanguage: "or-IN",
    sayVoice: "Google.or-IN-Standard-A",
    missed: "କ୍ଷମା କରନ୍ତୁ, ଶୁଣି ପାରିଲି ନାହିଁ। ଆଉଥରେ କୁହନ୍ତୁ।",
    inactive: "ଏହି କଲ୍ ବର୍ତ୍ତମାନ ସକ୍ରିୟ ନୁହେଁ।",
  },
  {
    code: "as-IN",
    label: "Assamese",
    native: "অসমীয়া",
    gather: "as-IN",
    sayLanguage: "as-IN",
    sayVoice: "Google.as-IN-Standard-A",
    missed: "ক্ষমা কৰিব, শুনিবলৈ পোৱা নাই। আকৌ কওক।",
    inactive: "এই কল এতিয়া সক্ৰিয় নহয়।",
  },
];

const DEFAULT_LANGUAGE = "en-IN";

export function getLanguage(code = DEFAULT_LANGUAGE) {
  const key = String(code || "").trim().toLowerCase();
  return (
    LANGUAGES.find((lang) => lang.code.toLowerCase() === key) ||
    LANGUAGES.find((lang) => lang.label.toLowerCase() === key || lang.native.toLowerCase() === key) ||
    LANGUAGES[0]
  );
}

export function normalizeLanguage(code) {
  return getLanguage(code).code;
}

export function publicLanguages() {
  return LANGUAGES.map(({ code, label, native }) => ({ code, label, native }));
}

export function resolveSpokenLanguage(call, agent) {
  return normalizeLanguage(call?.language || agent?.language || DEFAULT_LANGUAGE);
}

const SCRIPT_LANGS = [
  { re: /[\u0B80-\u0BFF]/, code: "ta-IN" },
  { re: /[\u0C00-\u0C7F]/, code: "te-IN" },
  { re: /[\u0A00-\u0A7F]/, code: "pa-IN" },
  { re: /[\u0A80-\u0AFF]/, code: "gu-IN" },
  { re: /[\u0C80-\u0CFF]/, code: "kn-IN" },
  { re: /[\u0D00-\u0D7F]/, code: "ml-IN" },
  { re: /[\u0980-\u09FF]/, code: "bn-IN" },
  { re: /[\u0B00-\u0B7F]/, code: "or-IN" },
  { re: /[\u0600-\u06FF\u0750-\u077F]/, code: "ur-IN" },
  { re: /[\u0900-\u097F]/, code: "hi-IN" },
];

const HINGLISH =
  /\b(haan|hanji|haa[n]?|nahi|nahin|mat|kya|hai|hain|aap|aapka|aapke|main|mein|mujhe|mera|meri|namaste|namaskar|theek|thik|achha|accha|bilkul|yaar|bhai|ji|kaise|kaisa|hoon|hun|rha|raha|rahi|karo|karna|bolo|bolna|suno|samajh|matlab|kitna|kab|kahan|kyun|kyunki|batao|bataiye|sunao|baat|karo|kariye|chahiye|sakte|sakta|sakti)\b/i;

/** Telugu STT often emits long repeated syllables when the caller spoke Hindi/English. */
export function looksLikeSttGarble(text) {
  const raw = String(text || "").replace(/\s+/g, "");
  if (raw.length < 24) return false;
  const unique = new Set([...raw]).size;
  if (unique <= 4 && raw.length >= 24) return true;
  if (unique <= 8 && raw.length >= 48 && unique / raw.length < 0.12) return true;
  // Same 2–4 char chunk repeated many times (లోలోలో / హాహాహా).
  const chunk = raw.slice(0, Math.min(4, Math.floor(raw.length / 8)));
  if (chunk.length >= 2) {
    const repeats = raw.split(chunk).length - 1;
    if (repeats >= 8 && repeats * chunk.length / raw.length > 0.55) return true;
  }
  return false;
}

/** Enough signal to lock the call language from content (not a lone "yes"/"Form 18"). */
export function shouldLockSpokenLanguage(text, code) {
  const raw = String(text || "").trim();
  if (!raw || !code) return false;
  if (looksLikeSttGarble(raw)) return false;
  if (code === "hi-IN") {
    if (/[\u0900-\u097F]/.test(raw) && raw.replace(/[^\u0900-\u097F]/g, "").length >= 6) return true;
    const hits = (raw.match(new RegExp(HINGLISH.source, "gi")) || []).length;
    if (hits >= 2 && raw.length >= 10) return true;
    if (hits >= 1 && raw.length >= 22 && !looksLikeEnglish(raw)) return true;
    return false;
  }
  if (code === "en-IN") {
    return looksLikeEnglish(raw) && (raw.match(/[A-Za-z]+/g) || []).length >= 4;
  }
  if (code === "te-IN") {
    return /[\u0C00-\u0C7F]/.test(raw) && !looksLikeSttGarble(raw) && raw.length >= 8;
  }
  return false;
}

const HINDI_REQUEST =
  /\b(?:talk|speak|switch|reply|answer|please|want|can|you|in).{0,48}\bhindi\b|\bin hindi\b|\bhindi please\b|\bhindi mein\b|\bhindi me\b|\bhindi\b.{0,24}(?:baat|mein|me|bolo|karo|kariye|please)|(?:baat|bolo|karo).{0,16}\bhindi\b|(?:hindi|हिंदी|हिन्दी|హిందీ|హింది).{0,24}(?:baat|बात|mein|me|में|bolo|बोल|karo|kariye|कर|करो|please|ప్లీజ్)|(?:baat|बात|ప్లీజ్).{0,16}(?:hindi|हिंदी|హిందీ)|हिंदी में|हिन्दी में|हिंदी बोल|హిందీలో|(?:hindi\s+){2,}/i;

const ENGLISH_REQUEST =
  /\b(?:talk|speak|switch|reply|answer|please|want|can|you|in).{0,48}\benglish\b|\bin english\b|\benglish please\b|\benglish (?:mein|me|में)\b|\bangrezi\b|\bangreji\b|अंग्रेजी|इंग्लिश|ఇంగ్లీష్|ఇంగ్లిష్|ఇంగ్లీషులో|(?:please|ప్లీజ్).{0,12}(?:english|ఇంగ్లీష్)|(?:english|ఇంగ్లీష్).{0,12}(?:please|ప్లీజ్|లో)/i;

const LANGUAGE_REQUESTS = [
  { code: "en-IN", re: ENGLISH_REQUEST },
  { code: "hi-IN", re: HINDI_REQUEST },
  { code: "ta-IN", re: /\b(?:talk|speak|switch).{0,40}\btamil\b|\bin tamil\b|தமிழில்/i },
  { code: "te-IN", re: /\b(?:talk|speak|switch).{0,40}\btelugu\b|\bin telugu\b|తెలుగులో|(?:telugu|తెలుగు).{0,20}(?:lo|లో|matlad|మాట్లాడ)/i },
  { code: "mr-IN", re: /\b(?:talk|speak|switch).{0,40}\bmarathi\b|\bin marathi\b|मराठीत/i },
  { code: "bn-IN", re: /\b(?:talk|speak|switch).{0,40}\bbengali\b|\bin bengali\b|\bbangla\b|বাংলায়/i },
  { code: "gu-IN", re: /\b(?:talk|speak|switch).{0,40}\bgujarati\b|\bin gujarati\b|ગુજરાતી/i },
  { code: "pa-IN", re: /\b(?:talk|speak|switch).{0,40}\bpunjabi\b|\bin punjabi\b|ਪੰਜਾਬੀ/i },
  { code: "kn-IN", re: /\b(?:talk|speak|switch).{0,40}\bkannada\b|\bin kannada\b|ಕನ್ನಡದಲ್ಲಿ/i },
  { code: "ml-IN", re: /\b(?:talk|speak|switch).{0,40}\bmalayalam\b|\bin malayalam\b|മലയാളത്തിൽ/i },
  { code: "ur-IN", re: /\b(?:talk|speak|switch).{0,40}\burdu\b|\bin urdu\b|اردو میں/i },
];

/** Repair Telugu-script STT of English/Hindi language asks before detection. */
export function normalizeLanguageAsk(text) {
  let raw = String(text || "").trim();
  if (!raw) return raw;
  raw = raw
    .replace(/ప్లీజ్|ప్లీస్/gi, "please")
    .replace(/హలో|హెలో/gi, "hello")
    .replace(/కెన్|కాన్/gi, "can")
    .replace(/యూ|యు/gi, "you")
    .replace(/టాక్|టాకు/gi, "talk")
    .replace(/స్పీక్/gi, "speak")
    .replace(/ఇన్/gi, "in")
    .replace(/హిందీ|హింది/gi, "hindi")
    .replace(/ఇంగ్లీష్|ఇంగ్లిష్|ఇంగ్లీషు|ఆంగ్లం/gi, "english")
    .replace(/బాత్|బాతు/gi, "baat")
    .replace(/కరో|కరియే|కరండి/gi, "karo")
    .replace(/మాట్లాడండి|మాట్లాడు|మాట్లాడ/gi, "baat")
    .replace(/\bమే\b|\bమెయిన్\b|లో\b/gi, "mein")
    .replace(/\s+/g, " ")
    .trim();
  return raw;
}

export function detectRequestedLanguage(text) {
  const raw = normalizeLanguageAsk(text);
  if (!raw) return null;
  if (
    (/\bniacin\b|नियासिन/i.test(raw))
    && /(?:saath|साथ).{0,16}(?:kholo|खोलो)/i.test(raw)
  ) {
    return "hi-IN";
  }
  for (const { re, code } of LANGUAGE_REQUESTS) {
    if (re.test(raw)) return code;
  }
  // Fallback: latin "hindi" plus any talk/switch cue (covers messy Telugu-phonetic STT).
  if (/\bhindi\b/i.test(raw) && /\b(talk|speak|in|mein|me|baat|can|you|please|hello|karo|bolo)\b/i.test(raw)) {
    return "hi-IN";
  }
  if (/\benglish\b/i.test(raw) && /\b(talk|speak|in|mein|me|can|you|please|hello)\b/i.test(raw)) {
    return "en-IN";
  }
  return null;
}

export function looksLikeEnglish(text) {
  const raw = normalizeLanguageAsk(text);
  const letters = raw.replace(/[^A-Za-z]/g, "");
  const words = raw.match(/[A-Za-z]+/g) || [];
  if (letters.length < 6) return false;
  // Single filler like "please" / "hello" is not enough to switch the call language.
  if (words.length < 2 && letters.length < 14) return false;
  // Romanized Hindi / Hinglish is not English even with Latin letters.
  if (HINGLISH.test(raw)) return false;
  if (/\b(mein|me|nahi|nahin|samajh|baat|karo|bolo|kya|hai|aap|mujhe|kyun|kyunki)\b/i.test(raw)) {
    return false;
  }
  return /\b(the|and|you|please|talk|speak|english|what|this|that|have|want|will|just|because|at least|don't|dont|i'm|i am|can you|tell me|why are|why you|calling|date of birth|living in|address|thank you|hello|hi)\b/i.test(raw);
}

export function detectLanguageFromText(text, fallback = DEFAULT_LANGUAGE) {
  const raw = normalizeLanguageAsk(text);
  const current = normalizeLanguage(fallback);
  if (raw.length < 2) return current;

  const requested = detectRequestedLanguage(raw);
  if (requested) return requested;

  // Wrong-language STT garble (Hindi heard as repeated Telugu) — do not trust script.
  if (looksLikeSttGarble(raw)) return current;

  // Use normalized text so Telugu-script "ప్లీజ్ హిందీ" is not forced to te-IN.
  for (const { re, code } of SCRIPT_LANGS) {
    if (re.test(raw)) {
      if (code === "te-IN" && looksLikeSttGarble(raw)) continue;
      return code;
    }
  }

  if (HINGLISH.test(raw) && !looksLikeEnglish(raw)) return "hi-IN";
  if (looksLikeEnglish(raw)) return "en-IN";
  return current;
}

export function looksLikeLanguage(text, code) {
  return detectLanguageFromText(text, code) === normalizeLanguage(code);
}

const TTS_PUNCT = /[!?¿¡؟।॥…,.;:"""''`()[\]{}]/g;
const NOISE_PHRASE =
  /exclamation\s*(point|mark)?|question\s*mark|full\s*stop|\bperiod\b|\bcomma\b|एक्सक्लेमेशन(?:\s*(?:पॉइंट|प्वाइंट|प्वाइन्ट))?|एक्स्क्लेमेशन|क्वेश्चन\s*मार्क|फुल\s*स्टॉप|प्रश्न\s*चिह्न|पूर्ण\s*विराम/gi;
const NOISE_LEFTOVER = /^(point|mark|stop|पॉइंट|प्वाइंट|प्वाइन्ट)?$/i;

export function spokenForTts(text) {
  // Keep .,?!,। and commas — Bulbul uses them for natural pauses and question intonation.
  // Only strip tags, brackets, and quotes that confuse synthesis.
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

export function isNoiseTranscript(heard, lastSpoken = "") {
  const raw = String(heard || "").trim();
  if (!raw) return true;
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

export { LANGUAGES, DEFAULT_LANGUAGE };
