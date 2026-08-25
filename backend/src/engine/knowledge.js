function tokenize(text) {
  return String(text || "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length > 1);
}

function chunkText(text, size = 420) {
  const raw = String(text || "").replace(/\s+/g, " ").trim();
  if (!raw) return [];
  const chunks = [];
  for (let i = 0; i < raw.length; i += size) {
    chunks.push(raw.slice(i, i + size));
  }
  return chunks;
}

function overlap(queryTokens, chunkTokens) {
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
  return {
    files: documents.length,
    bytes,
    status: documents.length ? "synced" : "empty",
  };
}

export function retrieveFromKnowledge(kb, question, limit = 5) {
  const queryTokens = tokenize(question);
  if (!queryTokens.length) return [];
  const hits = [];
  for (const doc of kb?.documents || []) {
    const chunks = chunkText(doc.text || "");
    chunks.forEach((excerpt, index) => {
      const score = overlap(queryTokens, tokenize(excerpt));
      if (score <= 0) return;
      hits.push({
        docId: doc.id,
        name: doc.name,
        kind: fileKind(doc.name),
        excerpt,
        score: Math.round(score * 100),
        chunk: index + 1,
      });
    });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}
