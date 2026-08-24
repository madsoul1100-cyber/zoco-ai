export const LLM_CATALOG = [
  {
    id: "openrouter",
    label: "OpenRouter",
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
    models: [
      { id: "sarvam-105b-conversations", label: "Sarvam 105B Conversations" },
      { id: "sarvam-105b", label: "Sarvam 105B" },
    ],
  },
  {
    id: "grok",
    label: "Grok (xAI)",
    models: [
      { id: "grok-4", label: "Grok 4" },
      { id: "grok-3", label: "Grok 3" },
      { id: "grok-3-mini", label: "Grok 3 mini" },
    ],
  },
  {
    id: "openai",
    label: "OpenAI",
    models: [
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    ],
  },
];

export function brainKey(provider, model) {
  return `${provider}::${model}`;
}

export function parseBrain(value) {
  const raw = String(value || "");
  const idx = raw.indexOf("::");
  if (idx === -1) return { llmProvider: raw || "openrouter", llmModel: "" };
  return { llmProvider: raw.slice(0, idx), llmModel: raw.slice(idx + 2) };
}

export function voiceGender(catalog, agent) {
  const spec = (catalog?.tts || []).find((item) => item.id === (agent?.ttsProvider || "browser"));
  const voice = spec?.voices?.find((item) => item.id === agent?.ttsVoice);
  if (voice?.gender === "male" || voice?.gender === "female") return voice.gender;
  const blob = `${agent?.ttsVoice || ""} ${voice?.label || ""}`;
  if (/\b(male|man|shubh|aditya|rahul|rohan|abhilash|onyx|echo|ash|fable)\b/i.test(blob)) return "male";
  return "female";
}

export function mergeLlmCatalog(remote) {
  const incoming = Array.isArray(remote) && remote.length ? remote : LLM_CATALOG;
  const byId = new Map(incoming.map((item) => [item.id, item]));
  return LLM_CATALOG.map((base) => {
    const extra = byId.get(base.id);
    return {
      ...base,
      ...extra,
      label: extra?.label || base.label,
      ready: extra?.ready,
      models: extra?.models?.length ? extra.models : base.models,
    };
  });
}
