function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

/** ~450-char windows with ~80-char overlap for better RAG recall. */
export function chunkText(text, size = 450, overlap = 80) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const step = Math.max(40, size - Math.min(overlap, size - 40));
  const chunks = [];
  for (let i = 0; i < raw.length; i += step) {
    const excerpt = raw.slice(i, i + size).trim();
    if (excerpt) chunks.push(excerpt);
    if (i + size >= raw.length) break;
  }
  return chunks;
}

function overlapScore(queryTokens, chunkTokens) {
  if (!queryTokens.length || !chunkTokens.length) return 0;
  const bag = new Set(chunkTokens);
  let hits = 0;
  for (const token of queryTokens) {
    if (bag.has(token)) hits += 1;
  }
  return hits / queryTokens.length;
}

export function fileKind(name = "") {
  const lower = String(name).toLowerCase();
  if (lower.endsWith(".md")) return "md";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".txt")) return "txt";
  return "note";
}

export function documentBytes(doc) {
  if (Number(doc?.bytes) > 0) return Number(doc.bytes);
  return Buffer.byteLength(String(doc?.text || ""), "utf8");
}

export function knowledgeStats(kb) {
  const documents = kb?.documents || [];
  const bytes = documents.reduce((sum, doc) => sum + documentBytes(doc), 0);
  const indexStatus = kb?.indexStatus || (documents.length ? "pending" : "empty");
  return {
    files: documents.length,
    bytes,
    status: documents.length ? "synced" : "empty",
    indexStatus,
    chunkCount: Number(kb?.chunkCount) || 0,
    embeddingModel: kb?.embeddingModel || "",
    lastIndexedAt: kb?.lastIndexedAt || null,
  };
}

/** Build chunk records for a knowledge base (no embeddings yet). */
export function buildKnowledgeChunks(kb) {
  const chunks = [];
  for (const doc of kb?.documents || []) {
    const excerpts = chunkText(doc.text || "");
    excerpts.forEach((excerpt, index) => {
      chunks.push({
        id: `${kb.id}:${doc.id}:${index}`,
        kbId: kb.id,
        docId: doc.id,
        name: doc.name || "note",
        kind: fileKind(doc.name),
        excerpt,
        chunk: index + 1,
      });
    });
  }
  return chunks;
}

export function keywordScoreForChunk(question, excerpt) {
  return overlapScore(tokenize(question), tokenize(excerpt));
}

export function retrieveFromKnowledge(kb, question, limit = 5) {
  const queryTokens = tokenize(question);
  if (!queryTokens.length) return [];
  const hits = [];
  for (const doc of kb?.documents || []) {
    const chunks = chunkText(doc.text || "");
    chunks.forEach((excerpt, index) => {
      const score = overlapScore(queryTokens, tokenize(excerpt));
      if (score <= 0) return;
      hits.push({
        docId: doc.id,
        name: doc.name,
        kind: fileKind(doc.name),
        excerpt,
        score: Math.round(score * 100),
        keywordScore: score,
        vectorScore: 0,
        chunk: index + 1,
        mode: "keyword",
      });
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/**
 * Merge vector + keyword scores.
 * Hybrid: 0.7 * vector + 0.3 * keyword when both exist.
 */
export function mergeHybridHits({ vectorHits = [], keywordHits = [], limit = 5 } = {}) {
  const byKey = new Map();

  for (const hit of keywordHits) {
    const key = `${hit.docId}:${hit.chunk}:${hit.excerpt}`;
    byKey.set(key, {
      ...hit,
      keywordScore: hit.keywordScore ?? hit.score / 100,
      vectorScore: 0,
    });
  }

  for (const hit of vectorHits) {
    const key = `${hit.docId}:${hit.chunk}:${hit.excerpt}`;
    const existing = byKey.get(key);
    if (existing) {
      existing.vectorScore = hit.vectorScore ?? hit.score;
      byKey.set(key, existing);
    } else {
      byKey.set(key, {
        ...hit,
        keywordScore: 0,
        vectorScore: hit.vectorScore ?? hit.score,
      });
    }
  }

  const hasVector = vectorHits.length > 0;
  const merged = [...byKey.values()].map((hit) => {
    const keyword = Number(hit.keywordScore) || 0;
    const vector = Number(hit.vectorScore) || 0;
    let combined;
    let mode;
    if (hasVector && (vector > 0 || keyword > 0)) {
      combined = vector > 0 && keyword > 0 ? 0.7 * vector + 0.3 * keyword : vector || keyword;
      mode = vector > 0 && keyword > 0 ? "hybrid" : vector > 0 ? "vector" : "keyword";
    } else {
      combined = keyword;
      mode = "keyword";
    }
    return {
      docId: hit.docId,
      name: hit.name,
      kind: hit.kind,
      excerpt: hit.excerpt,
      chunk: hit.chunk,
      keywordScore: Math.round(keyword * 1000) / 1000,
      vectorScore: Math.round(vector * 1000) / 1000,
      score: Math.round(combined * 100),
      mode,
    };
  });

  return merged.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Short catalog for system prompts when we should not dump the full KB. */
export function knowledgeCatalog(kb, { maxDocs = 8, maxChars = 600 } = {}) {
  if (!kb) return "";
  const docs = (kb.documents || []).slice(0, maxDocs);
  if (!docs.length) return `${kb.name}: (empty)`;
  const lines = docs.map((doc) => {
    const preview = String(doc.text || "").replace(/\s+/g, " ").trim().slice(0, 80);
    return `- ${doc.name}${preview ? `: ${preview}…` : ""}`;
  });
  const body = [`${kb.name}${kb.description ? ` — ${kb.description}` : ""}`, ...lines].join("\n");
  return body.slice(0, maxChars);
}
