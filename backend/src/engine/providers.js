export const LLM_PROVIDERS = [
  {
    id: "openrouter",
    label: "OpenRouter",
    hint: "One key, many models (Gemini, Claude, GPT, Grok via OpenRouter).",
    baseUrl: "https://openrouter.ai/api/v1",
    env: "OPENROUTER_API_KEY",
    models: [
      { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash" },
      { id: "openai/gpt-4o-mini", label: "GPT-4o mini" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet" },
      { id: "x-ai/grok-4", label: "Grok 4 (via OpenRouter)" },
      { id: "meta-llama/llama-3.3-70b-instruct", label: "Llama 3.3 70B" },
    ],
  },
  {
    id: "sarvam",
    label: "Sarvam AI",
    hint: "Indic chat models. Best paired with Bulbul voices.",
    baseUrl: "https://api.sarvam.ai/v1",
    env: "SARVAM_API_KEY",
    headerStyle: "sarvam",
    models: [
      { id: "sarvam-105b-conversations", label: "Sarvam 105B Conversations" },
      { id: "sarvam-105b", label: "Sarvam 105B" },
    ],
  },
  {
    id: "grok",
    label: "Grok (xAI)",
    hint: "Direct xAI API. Add an XAI key in Settings.",
    baseUrl: "https://api.x.ai/v1",
    env: "XAI_API_KEY",
    models: [
      { id: "grok-4", label: "Grok 4" },
      { id: "grok-3", label: "Grok 3" },
      { id: "grok-3-mini", label: "Grok 3 mini" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    hint: "GPT models plus OpenAI TTS voices.",
    baseUrl: "https://api.openai.com/v1",
    env: "OPENAI_API_KEY",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
  },
];

export const TTS_PROVIDERS = [
  {
    id: "browser",
    label: "Browser voice",
    hint: "Uses the computer’s built-in speech. No API key.",
    voices: [],
  },
  {
    id: "sarvam",
    label: "Sarvam Bulbul",
    hint: "Natural Indian voices (Hindi, Tamil, English-IN, and more).",
    model: "bulbul:v3",
    env: "SARVAM_API_KEY",
    voices: [
      { id: "anushka", label: "Anushka (female)", model: "bulbul:v2", gender: "female" },
      { id: "manisha", label: "Manisha (female)", model: "bulbul:v2", gender: "female" },
      { id: "vidya", label: "Vidya (female)", model: "bulbul:v2", gender: "female" },
      { id: "arya", label: "Arya (female)", model: "bulbul:v2", gender: "female" },
      { id: "abhilash", label: "Abhilash (male)", model: "bulbul:v2", gender: "male" },
      { id: "ritu", label: "Ritu (female)", model: "bulbul:v3", gender: "female" },
      { id: "priya", label: "Priya (female)", model: "bulbul:v3", gender: "female" },
      { id: "neha", label: "Neha (female)", model: "bulbul:v3", gender: "female" },
      { id: "simran", label: "Simran (female)", model: "bulbul:v3", gender: "female" },
      { id: "shubh", label: "Shubh (male)", model: "bulbul:v3", gender: "male" },
      { id: "aditya", label: "Aditya (male)", model: "bulbul:v3", gender: "male" },
      { id: "rahul", label: "Rahul (male)", model: "bulbul:v3", gender: "male" },
      { id: "rohan", label: "Rohan (male)", model: "bulbul:v3", gender: "male" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI TTS",
    hint: "Alloy, Nova, and other OpenAI speakers.",
    model: "tts-1",
    env: "OPENAI_API_KEY",
    voices: [
      { id: "alloy", label: "Alloy (neutral)", gender: "female" },
      { id: "ash", label: "Ash (male)", gender: "male" },
      { id: "coral", label: "Coral (female)", gender: "female" },
      { id: "echo", label: "Echo (male)", gender: "male" },
      { id: "fable", label: "Fable (male)", gender: "male" },
      { id: "nova", label: "Nova (female)", gender: "female" },
      { id: "onyx", label: "Onyx (male)", gender: "male" },
      { id: "sage", label: "Sage (female)", gender: "female" },
      { id: "shimmer", label: "Shimmer (female)", gender: "female" },
    ],
  },
];

const SARVAM_TTS_LANGS = new Set([
  "hi-IN",
  "bn-IN",
  "kn-IN",
  "ml-IN",
  "mr-IN",
  "od-IN",
  "pa-IN",
  "ta-IN",
  "te-IN",
  "gu-IN",
  "en-IN",
]);

export function defaultAiSettings() {
  return {
    defaultLlmProvider: "openrouter",
    defaultTtsProvider: "browser",
    keys: { openrouter: "", sarvam: "", grok: "", openai: "" },
  };
}

export function envKeys() {
  return {
    openrouter: String(process.env.OPENROUTER_API_KEY || "").trim(),
    sarvam: String(process.env.SARVAM_API_KEY || "").trim(),
    grok: String(process.env.XAI_API_KEY || process.env.GROK_API_KEY || "").trim(),
    openai: String(process.env.OPENAI_API_KEY || "").trim(),
  };
}

export function mergedKeys(stored = {}) {
  const env = envKeys();
  const saved = stored.keys || {};
  return {
    openrouter: saved.openrouter || env.openrouter,
    sarvam: saved.sarvam || env.sarvam,
    grok: saved.grok || env.grok,
    openai: saved.openai || env.openai,
  };
}

export function providerById(id) {
  return LLM_PROVIDERS.find((item) => item.id === id) || null;
}

export function ttsProviderById(id) {
  return TTS_PROVIDERS.find((item) => item.id === id) || TTS_PROVIDERS[0];
}

function firstReadyLlm(keys) {
  return LLM_PROVIDERS.find((item) => keys[item.id])?.id || "openrouter";
}

export function fallbackLlmConfig(settings = defaultAiSettings()) {
  const keys = mergedKeys(settings);
  if (keys.openrouter) {
    const spec = providerById("openrouter");
    return {
      provider: "openrouter",
      label: spec.label,
      apiKey: keys.openrouter,
      baseUrl: (process.env.OPENROUTER_BASE_URL || spec.baseUrl).replace(/\/$/, ""),
      model: process.env.OPENROUTER_MODEL || spec.models[0].id,
      headerStyle: spec.headerStyle || spec.id,
    };
  }
  return null;
}

export function resolveLlmConfig(agent = {}, settings = defaultAiSettings()) {
  const keys = mergedKeys(settings);
  const providerId = agent.llmProvider || settings.defaultLlmProvider || firstReadyLlm(keys);
  const spec = providerById(providerId) || providerById("openrouter");
  const apiKey = keys[spec.id] || "";
  const model =
    agent.llmModel ||
    spec.models[0]?.id ||
    (spec.id === "openrouter" ? process.env.OPENROUTER_MODEL : "") ||
    spec.models[0]?.id;
  if (!apiKey) return null;
  return {
    provider: spec.id,
    label: spec.label,
    apiKey,
    baseUrl: (spec.id === "openrouter" && process.env.OPENROUTER_BASE_URL
      ? process.env.OPENROUTER_BASE_URL
      : spec.baseUrl
    ).replace(/\/$/, ""),
    model,
    headerStyle: spec.headerStyle || spec.id,
  };
}

export function speakerGender(agent = {}) {
  const spec = ttsProviderById(agent.ttsProvider || "browser");
  const chosen = spec.voices?.find((item) => item.id === agent.ttsVoice);
  if (chosen?.gender === "male" || chosen?.gender === "female") return chosen.gender;
  const blob = `${agent.ttsVoice || ""} ${agent.voice || ""} ${chosen?.label || ""}`;
  if (/\b(male|man|shubh|aditya|rahul|rohan|abhilash|onyx|echo|ash|fable)\b/i.test(blob)) return "male";
  return "female";
}

export function sarvamSpeakerGender(gender) {
  return gender === "male" ? "Male" : "Female";
}

export function resolveTtsConfig(agent = {}, settings = defaultAiSettings()) {
  const keys = mergedKeys(settings);
  const providerId = agent.ttsProvider || settings.defaultTtsProvider || "browser";
  const spec = ttsProviderById(providerId);
  if (spec.id === "browser") {
    return { provider: "browser", ready: true, voice: agent.voice || "", model: null };
  }
  const apiKey = keys[spec.env === "SARVAM_API_KEY" ? "sarvam" : spec.env === "OPENAI_API_KEY" ? "openai" : spec.id] || "";
  const chosen = spec.voices?.find((item) => item.id === agent.ttsVoice) || spec.voices?.[0];
  return {
    provider: spec.id,
    ready: Boolean(apiKey),
    apiKey,
    model: agent.ttsModel || chosen?.model || spec.model,
    voice: agent.ttsVoice || chosen?.id,
    language: agent.language || "en-IN",
  };
}

export function llmHeaders(llm) {
  const headers = { "Content-Type": "application/json" };
  if (llm.headerStyle === "sarvam" || llm.provider === "sarvam") {
    headers["api-subscription-key"] = llm.apiKey;
    headers.Authorization = `Bearer ${llm.apiKey}`;
    return headers;
  }
  headers.Authorization = `Bearer ${llm.apiKey}`;
  if (llm.provider === "openrouter") {
    headers["HTTP-Referer"] = "http://localhost:5173";
    headers["X-Title"] = "Zoco AI";
  }
  return headers;
}

export function sarvamTtsLanguage(code) {
  const value = String(code || "en-IN");
  if (SARVAM_TTS_LANGS.has(value)) return value;
  if (value.startsWith("hi")) return "hi-IN";
  if (value.startsWith("ta")) return "ta-IN";
  if (value.startsWith("te")) return "te-IN";
  if (value.startsWith("bn")) return "bn-IN";
  if (value.startsWith("mr")) return "mr-IN";
  if (value.startsWith("gu")) return "gu-IN";
  if (value.startsWith("kn")) return "kn-IN";
  if (value.startsWith("ml")) return "ml-IN";
  if (value.startsWith("pa")) return "pa-IN";
  return "en-IN";
}

export function publicProviderCatalog(settings = defaultAiSettings()) {
  const keys = mergedKeys(settings);
  return {
    defaultLlmProvider: settings.defaultLlmProvider || "openrouter",
    defaultTtsProvider: settings.defaultTtsProvider || "browser",
    llm: LLM_PROVIDERS.map((item) => ({
      id: item.id,
      label: item.label,
      hint: item.hint,
      ready: Boolean(keys[item.id]),
      models: item.models,
    })),
    tts: TTS_PROVIDERS.map((item) => ({
      id: item.id,
      label: item.label,
      hint: item.hint,
      ready: item.id === "browser" || Boolean(keys[item.env === "SARVAM_API_KEY" ? "sarvam" : item.env === "OPENAI_API_KEY" ? "openai" : item.id]),
      model: item.model || null,
      voices: item.voices,
    })),
    keys: {
      openrouter: Boolean(keys.openrouter),
      sarvam: Boolean(keys.sarvam),
      grok: Boolean(keys.grok),
      openai: Boolean(keys.openai),
    },
  };
}
