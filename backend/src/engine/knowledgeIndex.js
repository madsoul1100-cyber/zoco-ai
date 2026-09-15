import { cosineSimilarity, embedQuery, embedTexts, embeddingsAvailable, resolveEmbeddingConfig } from "./embeddings.js";
import {
  buildKnowledgeChunks,
  keywordScoreForChunk,
  mergeHybridHits,
  retrieveFromKnowledge,
} from "./knowledge.js";

/**
 * Pure hybrid ranking over in-memory chunk records (used by tests + retrieveHybrid).
 * Each chunk may include `{ excerpt, embedding, docId, name, kind, chunk }`.
 */
export function rankHybridChunks(chunks, question, { queryEmbedding = null, limit = 5 } = {}) {
  const keywordHits = [];
  const vectorHits = [];

  for (const chunk of chunks || []) {
    const keywordScore = keywordScoreForChunk(question, chunk.excerpt);
    if (keywordScore > 0) {
      keywordHits.push({
        docId: chunk.docId,
        name: chunk.name,
        kind: chunk.kind,
        excerpt: chunk.excerpt,
        chunk: chunk.chunk,
        score: Math.round(keywordScore * 100),
        keywordScore,
      });
    }
    if (queryEmbedding && Array.isArray(chunk.embedding) && chunk.embedding.length) {
      const vectorScore = cosineSimilarity(queryEmbedding, chunk.embedding);
      if (vectorScore > 0.15) {
        vectorHits.push({
          docId: chunk.docId,
          name: chunk.name,
          kind: chunk.kind,
          excerpt: chunk.excerpt,
          chunk: chunk.chunk,
          score: vectorScore,
          vectorScore,
        });
      }
    }
  }

  return {
    hits: mergeHybridHits({ vectorHits, keywordHits, limit }),
    mode: vectorHits.length ? "hybrid" : "keyword",
  };
}

export async function reindexKnowledgeBase(kb, {
  replaceChunks,
  embed = embedTexts,
  resolveConfig = resolveEmbeddingConfig,
} = {}) {
  if (!kb?.id) throw new Error("Knowledge base required");
  const records = buildKnowledgeChunks(kb);
  const config = resolveConfig();
  let embeddingModel = "";
  let indexStatus = "keyword_only";

  if (config && records.length) {
    try {
      const vectors = await embed(
        records.map((item) => item.excerpt),
        { config }
      );
      records.forEach((item, index) => {
        item.embedding = vectors[index] || [];
      });
      embeddingModel = config.model;
      indexStatus = records.every((item) => item.embedding?.length) ? "ready" : "partial";
    } catch (error) {
      console.warn(`Knowledge reindex embeddings failed for ${kb.id}:`, error.message || error);
      records.forEach((item) => {
        item.embedding = [];
      });
      indexStatus = "keyword_only";
    }
  } else if (!records.length) {
    indexStatus = "empty";
  }

  const now = new Date().toISOString();
  if (typeof replaceChunks === "function") {
    await replaceChunks(kb.id, records.map((item) => ({
      ...item,
      updatedAt: now,
    })));
  }

  return {
    ...kb,
    indexStatus,
    chunkCount: records.length,
    embeddingModel,
    lastIndexedAt: now,
  };
}

export async function retrieveHybrid(kbList, question, {
  limit = 5,
  loadChunks,
  embedQuestion = embedQuery,
} = {}) {
  const bases = (Array.isArray(kbList) ? kbList : [kbList]).filter(Boolean);
  const q = String(question || "").trim();
  if (!bases.length || !q) {
    return { hits: [], mode: "keyword", text: "" };
  }

  const kbIds = bases.map((kb) => kb.id);
  let chunks = [];
  if (typeof loadChunks === "function") {
    chunks = await loadChunks(kbIds);
  }

  let queryEmbedding = null;
  const hasAnyEmbedding = chunks.some((chunk) => Array.isArray(chunk.embedding) && chunk.embedding.length);
  if (hasAnyEmbedding && embeddingsAvailable()) {
    try {
      queryEmbedding = await embedQuestion(q);
    } catch (error) {
      console.warn("Query embedding failed, falling back to keyword:", error.message || error);
    }
  }

  let ranked;
  if (chunks.length) {
    ranked = rankHybridChunks(chunks, q, { queryEmbedding, limit });
  } else {
    const keywordHits = bases.flatMap((kb) =>
      retrieveFromKnowledge(kb, q, limit).map((hit) => ({
        ...hit,
        kbId: kb.id,
        kbName: kb.name,
      }))
    );
    ranked = {
      hits: mergeHybridHits({ keywordHits, vectorHits: [], limit }),
      mode: "keyword",
    };
  }

  const nameByKb = new Map(bases.map((kb) => [kb.id, kb.name]));
  const hits = ranked.hits.map((hit) => {
    const chunk = chunks.find(
      (item) => item.docId === hit.docId && item.chunk === hit.chunk && item.excerpt === hit.excerpt
    );
    const kbId = chunk?.kbId || hit.kbId;
    return {
      ...hit,
      kbId,
      kbName: hit.kbName || nameByKb.get(kbId) || "",
    };
  });

  const text = hits
    .map((hit) => {
      const label = hit.kbName ? `${hit.kbName} / ${hit.name}` : hit.name;
      return `${label}:\n${hit.excerpt}`;
    })
    .join("\n\n");

  return { hits, mode: ranked.mode, text };
}
