export const LANGUAGES = [
  { code: "en-IN", label: "English (India)", native: "English" },
  { code: "hi-IN", label: "Hindi", native: "हिन्दी" },
  { code: "ta-IN", label: "Tamil", native: "தமிழ்" },
  { code: "te-IN", label: "Telugu", native: "తెలుగు" },
  { code: "pa-IN", label: "Punjabi", native: "ਪੰਜਾਬੀ" },
  { code: "bn-IN", label: "Bengali", native: "বাংলা" },
  { code: "mr-IN", label: "Marathi", native: "मराठी" },
  { code: "gu-IN", label: "Gujarati", native: "ગુજરાતી" },
  { code: "kn-IN", label: "Kannada", native: "ಕನ್ನಡ" },
  { code: "ml-IN", label: "Malayalam", native: "മലയാളം" },
  { code: "ur-IN", label: "Urdu", native: "اردو" },
  { code: "or-IN", label: "Odia", native: "ଓଡ଼ିଆ" },
  { code: "as-IN", label: "Assamese", native: "অসমীয়া" },
];

export const DEFAULT_LANGUAGE = "en-IN";

export function getLanguage(code = DEFAULT_LANGUAGE) {
  const key = String(code || "").trim();
  return LANGUAGES.find((lang) => lang.code.toLowerCase() === key.toLowerCase()) || LANGUAGES[0];
}

export function languageLabel(code) {
  const lang = getLanguage(code);
  return lang.native && lang.native !== lang.label ? `${lang.label} · ${lang.native}` : lang.label;
}
