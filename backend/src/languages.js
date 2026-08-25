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
  /\b(haan|hanji|nahi|nahin|mat|kya|hai|hain|aap|namaste|namaskar|theek|thik|achha|accha|bilkul|yaar|bhai|ji|kaise|hoon|rha|raha|karo|bolo|suno|samajh|matlab|kitna|kab|kahan)\b/i;

const LANGUAGE_REQUESTS = [
  { code: "en-IN", re: /\b(?:talk|speak|switch|reply|answer|please|want|in).{0,48}\benglish\b|\bin english\b|\benglish please\b|\benglish (?:mein|me|में)\b|\bnot english\b|\bangrezi\b|\bangreji\b|अंग्रेजी|इंग्लिश|इंग्लिश में|अंग्रेज़ी/i },
  { code: "hi-IN", re: /\b(?:talk|speak|switch|reply|answer|please).{0,40}\bhindi\b|\bin hindi\b|\bhindi please\b|\bhindi mein\b|\bhindi me\b|हिंदी में|हिन्दी में|हिंदी बोल|हिन्दी बोल/i },
  { code: "ta-IN", re: /\b(?:talk|speak|switch).{0,40}\btamil\b|\bin tamil\b|தமிழில்/i },
  { code: "te-IN", re: /\b(?:talk|speak|switch).{0,40}\btelugu\b|\bin telugu\b|తెలుగులో/i },
  { code: "mr-IN", re: /\b(?:talk|speak|switch).{0,40}\bmarathi\b|\bin marathi\b|मराठीत/i },
  { code: "bn-IN", re: /\b(?:talk|speak|switch).{0,40}\bbengali\b|\bin bengali\b|\bbangla\b|বাংলায়/i },
  { code: "gu-IN", re: /\b(?:talk|speak|switch).{0,40}\bgujarati\b|\bin gujarati\b|ગુજરાતી/i },
  { code: "pa-IN", re: /\b(?:talk|speak|switch).{0,40}\bpunjabi\b|\bin punjabi\b|ਪੰਜਾਬੀ/i },
  { code: "kn-IN", re: /\b(?:talk|speak|switch).{0,40}\bkannada\b|\bin kannada\b|ಕನ್ನಡದಲ್ಲಿ/i },
  { code: "ml-IN", re: /\b(?:talk|speak|switch).{0,40}\bmalayalam\b|\bin malayalam\b|മലയാളത്തിൽ/i },
  { code: "ur-IN", re: /\b(?:talk|speak|switch).{0,40}\burdu\b|\bin urdu\b|اردو میں/i },
];

export function detectRequestedLanguage(text) {
  const raw = String(text || "").trim();
  if (!raw) return null;
  for (const { re, code } of LANGUAGE_REQUESTS) {
    if (re.test(raw)) return code;
  }
  return null;
}

function looksLikeEnglish(text) {
  const raw = String(text || "").trim();
  const letters = raw.replace(/[^A-Za-z]/g, "");
  if (letters.length < 12) return false;
  if (HINGLISH.test(raw)) return false;
  return /\b(the|and|you|please|talk|speak|english|what|this|that|have|want|will|just|because|at least|don't|dont|i'm|i am|can you)\b/i.test(raw);
}

export function detectLanguageFromText(text, fallback = DEFAULT_LANGUAGE) {
  const raw = String(text || "").trim();
  const current = normalizeLanguage(fallback);
  if (raw.length < 2) return current;

  const requested = detectRequestedLanguage(raw);
  if (requested) return requested;

  for (const { re, code } of SCRIPT_LANGS) {
    if (re.test(raw)) return code;
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

export { LANGUAGES, DEFAULT_LANGUAGE };
