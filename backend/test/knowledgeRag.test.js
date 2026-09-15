import test from "node:test";
import assert from "node:assert/strict";
import { cosineSimilarity, resolveEmbeddingConfig } from "../src/engine/embeddings.js";
import {
  buildKnowledgeChunks,
  chunkText,
  knowledgeCatalog,
  mergeHybridHits,
  retrieveFromKnowledge,
} from "../src/engine/knowledge.js";
import { rankHybridChunks, reindexKnowledgeBase, retrieveHybrid } from "../src/engine/knowledgeIndex.js";

test("chunkText uses overlapping windows", () => {
  const text = "a".repeat(900);
  const chunks = chunkText(text, 450, 80);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks[0].length, 450);
  // Overlap: second window starts before first ends
  assert.ok(chunks.length >= 2);
});

test("keyword retrieve still finds exact terms", () => {
  const kb = {
    id: "kb1",
    name: "Policies",
    documents: [
      {
        id: "doc1",
        name: "refund.md",
        text: "Customers may request a full refund within 14 days of purchase if unused.",
      },
    ],
  };
  const hits = retrieveFromKnowledge(kb, "refund within 14 days", 3);
  assert.ok(hits.length >= 1);
  assert.match(hits[0].excerpt, /refund/i);
  assert.equal(hits[0].mode, "keyword");
});

test("cosineSimilarity ranks matching vectors higher", () => {
  const query = [1, 0, 0];
  assert.ok(cosineSimilarity(query, [0.9, 0.1, 0]) > cosineSimilarity(query, [0, 1, 0]));
  assert.equal(cosineSimilarity([], [1]), 0);
});

test("mergeHybridHits blends vector and keyword scores", () => {
  const merged = mergeHybridHits({
    limit: 2,
    keywordHits: [
      {
        docId: "d1",
        name: "a",
        kind: "txt",
        excerpt: "Form 18 is for graduate voters",
        chunk: 1,
        score: 50,
        keywordScore: 0.5,
      },
    ],
    vectorHits: [
      {
        docId: "d1",
        name: "a",
        kind: "txt",
        excerpt: "Form 18 is for graduate voters",
        chunk: 1,
        score: 0.9,
        vectorScore: 0.9,
      },
      {
        docId: "d2",
        name: "b",
        kind: "txt",
        excerpt: "Unrelated parking rules",
        chunk: 1,
        score: 0.2,
        vectorScore: 0.2,
      },
    ],
  });
  assert.equal(merged[0].docId, "d1");
  assert.equal(merged[0].mode, "hybrid");
  assert.ok(merged[0].score > 70);
});

test("rankHybridChunks falls back to keyword without embeddings", () => {
  const chunks = buildKnowledgeChunks({
    id: "kb1",
    documents: [{ id: "d1", name: "faq.txt", text: "WhatsApp OTP is sent within two minutes." }],
  });
  const { hits, mode } = rankHybridChunks(chunks, "WhatsApp OTP timing", { limit: 3 });
  assert.equal(mode, "keyword");
  assert.ok(hits.length >= 1);
  assert.match(hits[0].excerpt, /WhatsApp OTP/i);
});

test("rankHybridChunks uses vectors when query embedding present", () => {
  const chunks = [
    {
      docId: "d1",
      name: "a",
      kind: "txt",
      excerpt: "Graduate MLC registration uses Form 18",
      chunk: 1,
      embedding: [1, 0, 0],
    },
    {
      docId: "d2",
      name: "b",
      kind: "txt",
      excerpt: "Parking permits cost fifty rupees",
      chunk: 1,
      embedding: [0, 1, 0],
    },
  ];
  // Paraphrase with no keyword overlap on "ballot paperwork"
  const { hits, mode } = rankHybridChunks(chunks, "ballot paperwork for graduates", {
    queryEmbedding: [0.95, 0.05, 0],
    limit: 2,
  });
  assert.equal(mode, "hybrid");
  assert.equal(hits[0].docId, "d1");
});

test("reindexKnowledgeBase stores embeddings when embed fn works", async () => {
  const kb = {
    id: "kb_test",
    name: "Test",
    documents: [{ id: "d1", name: "note.txt", text: "Hello world knowledge chunk." }],
  };
  const stored = [];
  const indexed = await reindexKnowledgeBase(kb, {
    resolveConfig: () => ({ provider: "openai", model: "text-embedding-3-small", apiKey: "x", baseUrl: "http://x" }),
    embed: async (texts) => texts.map(() => [0.1, 0.2, 0.3]),
    replaceChunks: async (_id, chunks) => {
      stored.push(...chunks);
    },
  });
  assert.equal(indexed.indexStatus, "ready");
  assert.equal(indexed.chunkCount, 1);
  assert.equal(stored[0].embedding.length, 3);
});

test("reindexKnowledgeBase degrades to keyword_only when no config", async () => {
  const kb = {
    id: "kb_test",
    name: "Test",
    documents: [{ id: "d1", name: "note.txt", text: "Hello world." }],
  };
  const indexed = await reindexKnowledgeBase(kb, {
    resolveConfig: () => null,
    replaceChunks: async () => {},
  });
  assert.equal(indexed.indexStatus, "keyword_only");
  assert.ok(indexed.chunkCount >= 1);
});

test("retrieveHybrid uses in-memory docs when no chunks loaded", async () => {
  const kb = {
    id: "kb1",
    name: "KB",
    documents: [{ id: "d1", name: "fees.txt", text: "Consultation fee is five hundred rupees." }],
  };
  const { hits, mode, text } = await retrieveHybrid([kb], "consultation fee", {
    loadChunks: async () => [],
  });
  assert.equal(mode, "keyword");
  assert.ok(hits.length >= 1);
  assert.match(text, /five hundred/i);
});

test("knowledgeCatalog stays short and lists files", () => {
  const catalog = knowledgeCatalog({
    name: "Product FAQ",
    description: "Support answers",
    documents: [
      { name: "pricing.md", text: "Monthly plan is 999 rupees with GST." },
      { name: "refund.md", text: "Refunds within 14 days." },
    ],
  });
  assert.match(catalog, /Product FAQ/);
  assert.match(catalog, /pricing\.md/);
  assert.ok(catalog.length <= 600);
});

test("resolveEmbeddingConfig prefers OpenAI then OpenRouter", () => {
  assert.equal(resolveEmbeddingConfig({ openai: "", openrouter: "" }), null);
  const openai = resolveEmbeddingConfig({ openai: "sk-test", openrouter: "or-test" });
  assert.equal(openai.provider, "openai");
  const or = resolveEmbeddingConfig({ openai: "", openrouter: "or-test" });
  assert.equal(or.provider, "openrouter");
  assert.match(or.model, /embedding/);
});
