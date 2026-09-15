/**
 * Latency + quality report for recent voice calls, built from stored turns.
 * Usage (from backend/): node --env-file=../.env scripts/analyzeCalls.js [limit]
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "zoco";
const limit = Number(process.argv[2] || 12);

if (!uri) {
  console.error("MONGODB_URI missing");
  process.exit(1);
}

const OPEN_TAIL =
  /(का|की|के|में|से|पर|को|ने|और|तो|या|कि)$|\b(of|to|the|and|is|are|that|my|your|a|an|for|i|we|you)$/i;

function pct(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const calls = await db
  .collection("calls")
  .find({ "messages.0": { $exists: true } })
  .sort({ updatedAt: -1 })
  .limit(limit)
  .toArray();

const allGaps = [];
const summary = [];

for (const call of calls) {
  const messages = (call.messages || []).filter((m) => m.role === "user" || m.role === "assistant");
  const gaps = [];
  let truncated = 0;
  let assistantTurns = 0;
  let userTurns = 0;

  for (let i = 1; i < messages.length; i += 1) {
    const prev = messages[i - 1];
    const curr = messages[i];
    if (prev.role === "user" && curr.role === "assistant") {
      const ms = new Date(curr.timestamp) - new Date(prev.timestamp);
      if (Number.isFinite(ms) && ms >= 0 && ms < 120000) {
        gaps.push(ms);
        allGaps.push(ms);
      }
    }
  }

  for (const message of messages) {
    if (message.role === "assistant") assistantTurns += 1;
    if (message.role === "user") {
      userTurns += 1;
      const text = String(message.text || "").trim();
      if (text && !/[.!?।]$/.test(text) && OPEN_TAIL.test(text)) truncated += 1;
    }
  }

  summary.push({
    id: call.id || String(call._id),
    runtime: call.voiceRuntime || call.runtime || "-",
    language: call.language || "-",
    status: call.status,
    disposition: call.disposition || "-",
    userTurns,
    assistantTurns,
    medianReplyMs: gaps.length ? pct(gaps, 50) : null,
    maxReplyMs: gaps.length ? Math.max(...gaps) : null,
    truncatedUserTurns: truncated,
    hasRecording: Boolean(call.recordingKey),
  });
}

console.log(`calls analysed: ${summary.length}`);
console.log("");
console.log(
  "callId".padEnd(20),
  "lang".padEnd(7),
  "disp".padEnd(15),
  "u/a".padEnd(7),
  "medRepl".padEnd(9),
  "maxRepl".padEnd(9),
  "cutUser"
);
for (const row of summary) {
  console.log(
    String(row.id).padEnd(20),
    String(row.language).padEnd(7),
    String(row.disposition).padEnd(15),
    `${row.userTurns}/${row.assistantTurns}`.padEnd(7),
    `${row.medianReplyMs ?? "-"}`.padEnd(9),
    `${row.maxReplyMs ?? "-"}`.padEnd(9),
    String(row.truncatedUserTurns)
  );
}

console.log("");
console.log("=== reply latency across all analysed turns (user turn -> assistant turn) ===");
console.log(`samples: ${allGaps.length}`);
console.log(`p50: ${pct(allGaps, 50)}ms`);
console.log(`p75: ${pct(allGaps, 75)}ms`);
console.log(`p90: ${pct(allGaps, 90)}ms`);
console.log(`p95: ${pct(allGaps, 95)}ms`);
console.log(`max: ${allGaps.length ? Math.max(...allGaps) : 0}ms`);

const dispositions = {};
for (const row of summary) dispositions[row.disposition] = (dispositions[row.disposition] || 0) + 1;
console.log("");
console.log("=== dispositions ===");
for (const [key, value] of Object.entries(dispositions).sort((a, b) => b[1] - a[1])) {
  console.log(`${key}: ${value}`);
}

await client.close();
