import { getLanguage, normalizeLanguage } from "../languages.js";
import { getAiSettings } from "../store.js";
import { llmHeaders, mergedKeys, resolveLlmConfig, sarvamSpeakerGender, sarvamTtsLanguage } from "./providers.js";

function sarvamTranslateCode(code) {
  const mapped = sarvamTtsLanguage(code);
  if (String(code).startsWith("or") || String(code).startsWith("od")) return "od-IN";
  return mapped;
}

function genderHint(gender) {
  if (gender === "male") {
    return "The speaker is male. Use masculine first-person forms. Hindi: करूंगा, रहा हूँ, गया — never करूंगी, रही, गई.";
  }
  return "The speaker is female. Use feminine first-person forms. Hindi: करूंगी, रही हूँ, गई — never करूंगा.";
}

export async function translateText({ text, from = "en-IN", to, speakerGender: gender } = {}) {
  const source = String(text || "").trim();
  const target = normalizeLanguage(to);
  const origin = normalizeLanguage(from);
  if (!source) return "";
  if (target === origin) return source;

  const settings = await getAiSettings();
  const keys = mergedKeys(settings);
  const targetLang = getLanguage(target);
  const resolvedGender = gender === "male" || gender === "female" ? gender : "female";

  if (keys.sarvam) {
    try {
      const response = await fetch("https://api.sarvam.ai/translate", {
        method: "POST",
        headers: {
          "api-subscription-key": keys.sarvam,
          Authorization: `Bearer ${keys.sarvam}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: source,
          source_language_code: origin === "en-IN" ? "en-IN" : "auto",
          target_language_code: sarvamTranslateCode(target),
          speaker_gender: sarvamSpeakerGender(resolvedGender),
          mode: "formal",
          enable_preprocessing: true,
        }),
      });
      const data = await response.json().catch(() => ({}));
      const translated = String(data.translated_text || data.output || "").trim();
      if (response.ok && translated) return translated;
    } catch (error) {
      console.warn("Sarvam translate fallback:", error.message);
    }
  }

  const llm = resolveLlmConfig({}, settings);
  if (!llm) return source;

  const response = await fetch(`${llm.baseUrl}/chat/completions`, {
    method: "POST",
    headers: llmHeaders(llm),
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.1,
      max_tokens: 220,
      messages: [
        {
          role: "system",
          content: `Translate into ${targetLang.label} (${targetLang.native}). Keep it a short spoken greeting. Native script only, no quotes, no extra words. ${genderHint(resolvedGender)}`,
        },
        { role: "user", content: source },
      ],
    }),
  });
  if (!response.ok) return source;
  const data = await response.json();
  return String(data.choices?.[0]?.message?.content || source).replace(/^["']|["']$/g, "").trim();
}
