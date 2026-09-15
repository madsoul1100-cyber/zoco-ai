/**
 * voice-greeting-language-bind-v1
 *
 * The agent's greeting is authored once and stored as a fixed string, while the language
 * the call is actually spoken in comes from `call.language`. When those disagree the
 * synthesizer is told to speak one language but handed text in another — a call audit
 * found this on 16/57 recordings, most often a Telugu greeting on a hi-IN call, with
 * callers asking to switch language and being ignored.
 *
 * This resolves the greeting into the language the call will actually be spoken in.
 */
import { detectScriptLanguage, normalizeLanguage } from "../languages.js";
import { renderGreeting } from "./template.js";
import { translateText } from "./translate.js";

/**
 * Translations are stable for a given (text, target language, gender) triple, so cache
 * them per worker process. Call setup is latency-sensitive — the greeting is the first
 * thing the caller hears — and re-translating identical text on every dial would add a
 * network round trip before the agent can speak.
 */
const cache = new Map();
const MAX_CACHE = 200;

function cacheKey(text, language, gender) {
  return `${language}::${gender}::${text}`;
}

function remember(key, value) {
  if (cache.size >= MAX_CACHE) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
}

/**
 * Decide whether a greeting needs translating, without doing any work.
 * Exported so callers (and tests) can assert routing without a network call.
 */
export function greetingLanguageMismatch(greeting, language) {
  const target = normalizeLanguage(language);
  const source = detectScriptLanguage(greeting);
  if (!source) return null;
  if (source === target) return null;
  return { source, target };
}

/**
 * Greeting text in the language the call is spoken in.
 *
 * Never throws and never returns empty when a greeting exists: if translation is
 * unavailable the original text is returned, which is the pre-existing behaviour.
 */
export async function resolveGreeting({ agent, customer = {}, language, speakerGender } = {}) {
  const rendered = renderGreeting(agent, customer) || agent?.greeting || "";
  const text = String(rendered || "").trim();
  if (!text) return { text: "", translated: false, source: null, target: null };

  const target = normalizeLanguage(language);
  const mismatch = greetingLanguageMismatch(text, target);
  if (!mismatch) return { text, translated: false, source: mismatch?.source ?? null, target };

  const gender = speakerGender === "male" ? "male" : "female";
  const key = cacheKey(text, target, gender);
  if (cache.has(key)) {
    return { text: cache.get(key), translated: true, source: mismatch.source, target };
  }

  try {
    const translated = String(
      await translateText({ text, from: mismatch.source, to: target, speakerGender: gender })
    ).trim();
    // A translator that echoes the input has not solved the mismatch; keep the original
    // rather than caching a false success.
    if (translated && translated !== text) {
      remember(key, translated);
      return { text: translated, translated: true, source: mismatch.source, target };
    }
  } catch (error) {
    console.warn(
      `Greeting translation failed (${mismatch.source} -> ${target}): ${error.message}`
    );
  }

  return { text, translated: false, source: mismatch.source, target };
}
