import { envKeys } from "./providers.js";

export const DEFAULT_EMBEDDING_MODEL = "text-embedding-3-small";
export const OPENROUTER_EMBEDDING_MODEL = "openai/text-embedding-3-small";

/**
 * Resolve an OpenAI-compatible embeddings endpoint.
 * Prefers OPENAI_API_KEY; falls back to OpenRouter.
 */
export function resolveEmbeddingConfig(keys = envKeys()) {
  const openai = String(keys.openai || "").trim();
  if (openai) {
    return {
      provider: "openai",
      apiKey: openai,
      baseUrl: "https://api.openai.com/v1",
      model: process.env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL,
    };
  }
  const openrouter = String(keys.openrouter || "").trim();
  if (openrouter) {
    return {
      provider: "openrouter",
      apiKey: openrouter,
      baseUrl: (process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1").replace(/\/$/, ""),
      model: process.env.EMBEDDING_MODEL || OPENROUTER_EMBEDDING_MODEL,
    };
  }
  return null;
}

export function embeddingsAvailable(keys = envKeys()) {
  return Boolean(resolveEmbeddingConfig(keys));
}

export function cosineSimilarity(a = [], b = []) {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = Number(a[i]) || 0;
    const y = Number(b[i]) || 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

async function postEmbeddings({ baseUrl, apiKey, model, inputs, provider }) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${apiKey}`,
  };
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = process.env.PUBLIC_APP_URL || "https://zoco.ai";
    headers["X-Title"] = "Zoco AI";
  }
  const response = await fetch(`${baseUrl}/embeddings`, {
    method: "POST",
    headers,
    body: JSON.stringify({ model, input: inputs }),
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Embeddings failed (${response.status}): ${body.slice(0, 240)}`);
  }
  const data = await response.json();
  const items = Array.isArray(data?.data) ? data.data : [];
  return items
    .sort((left, right) => (left.index ?? 0) - (right.index ?? 0))
    .map((item) => item.embedding || []);
}

/**
 * Embed one or more texts. Returns [] when no embedding key is configured.
 */
export async function embedTexts(texts = [], { keys = envKeys(), config = null } = {}) {
  const list = (Array.isArray(texts) ? texts : [texts])
    .map((text) => String(text || "").trim())
    .filter(Boolean);
  if (!list.length) return [];
  const resolved = config || resolveEmbeddingConfig(keys);
  if (!resolved) return [];

  const batchSize = 32;
  const vectors = [];
  for (let i = 0; i < list.length; i += batchSize) {
    const batch = list.slice(i, i + batchSize);
    const batchVectors = await postEmbeddings({
      baseUrl: resolved.baseUrl,
      apiKey: resolved.apiKey,
      model: resolved.model,
      inputs: batch,
      provider: resolved.provider,
    });
    vectors.push(...batchVectors);
  }
  return vectors;
}

export async function embedQuery(question, options = {}) {
  const [vector] = await embedTexts([question], options);
  return vector || null;
}
