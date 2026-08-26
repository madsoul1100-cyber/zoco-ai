import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LANG_ALIASES = {
  Telugu: "te-IN",
  English: "en-IN",
  Hindi: "hi-IN",
  te: "te-IN",
  hi: "hi-IN",
  en: "en-IN",
};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const PRIYA_DICT_PATH = path.join(ROOT, "data", "priya-tts-dictionary.json");

const dictIdCache = new Map();

export function normalizeLangCode(code) {
  const raw = String(code || "").trim();
  if (!raw) return "en-IN";
  if (LANG_ALIASES[raw]) return LANG_ALIASES[raw];
  if (/^[a-z]{2}-[A-Z]{2}$/.test(raw)) return raw;
  const prefix = raw.split(/[-_]/)[0].toLowerCase();
  return LANG_ALIASES[prefix] || raw;
}

export function normalizePronunciations(input) {
  const src = input?.pronunciations && typeof input.pronunciations === "object" ? input.pronunciations : input;
  if (!src || typeof src !== "object") return {};
  const out = {};
  for (const [lang, map] of Object.entries(src)) {
    if (!map || typeof map !== "object") continue;
    const code = normalizeLangCode(lang);
    out[code] = { ...(out[code] || {}) };
    for (const [word, spoken] of Object.entries(map)) {
      const w = String(word || "").trim();
      const s = String(spoken || "").replace(/^\/+|\/+$/g, "").trim();
      if (w && s) out[code][w] = s;
    }
  }
  return out;
}

export function pronunciationCount(pronunciations) {
  return Object.values(normalizePronunciations(pronunciations)).reduce((n, map) => n + Object.keys(map).length, 0);
}

export function applyPronunciations(text, language, pronunciations) {
  const spoken = String(text || "");
  if (!spoken) return spoken;
  const maps = normalizePronunciations(pronunciations);
  const code = normalizeLangCode(language);
  const table = code === "en-IN"
    ? { ...(maps["en-IN"] || {}) }
    : { ...(maps["en-IN"] || {}), ...(maps[code] || {}) };
  const words = Object.keys(table).sort((a, b) => b.length - a.length);
  let out = spoken;
  for (const word of words) {
    const replacement = table[word];
    if (!replacement || word === replacement) continue;
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "giu");
    out = out.replace(re, replacement);
  }
  return out;
}

export async function loadPriyaDictionary() {
  const raw = JSON.parse(await readFile(PRIYA_DICT_PATH, "utf8"));
  return normalizePronunciations(raw);
}

function fingerprint(pronunciations) {
  return createHash("sha1").update(JSON.stringify(normalizePronunciations(pronunciations))).digest("hex").slice(0, 16);
}

export async function ensureSarvamDictId(apiKey, pronunciations) {
  const maps = normalizePronunciations(pronunciations);
  if (!apiKey || !Object.keys(maps).length) return "";
  const key = fingerprint(maps);
  if (dictIdCache.has(key)) return dictIdCache.get(key);

  const body = JSON.stringify({ pronunciations: maps });
  const form = new FormData();
  form.append("file", new Blob([body], { type: "application/json" }), "pronunciations.json");

  const response = await fetch("https://api.sarvam.ai/text-to-speech/pronunciation-dictionary", {
    method: "POST",
    headers: {
      "api-subscription-key": apiKey,
      Authorization: `Bearer ${apiKey}`,
    },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error?.message || data.message || `Sarvam dictionary upload failed (${response.status})`);
  }
  const id = data.dictionary_id || data.dict_id || "";
  if (id) dictIdCache.set(key, id);
  return id;
}
