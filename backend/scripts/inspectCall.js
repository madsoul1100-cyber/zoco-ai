/**
 * Turn-by-turn dump of one call: timing gaps, telemetry, and transcript-quality flags.
 *
 * Usage (from backend/):
 *   node --env-file=../.env scripts/inspectCall.js            # most recent call
 *   node --env-file=../.env scripts/inspectCall.js <callId>
 */
import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || "zoco";
const wanted = process.argv[2];

if (!uri) {
  console.error("MONGODB_URI missing");
  process.exit(1);
}

const OPEN_TAIL =
  /(का|की|के|में|से|पर|को|ने|और|तो|या|कि|वाला|वाली)$|\b(of|to|the|and|is|are|that|my|your|a|an|for|i|we|you|but|so|because)$/i;

const client = new MongoClient(uri);
await client.connect();
const db = client.db(dbName);

const query = wanted ? { $or: [{ id: wanted }, { _id: wanted }] } : { "messages.0": { $exists: true } };
const call = await db.collection("calls").findOne(query, { sort: { updatedAt: -1 } });

if (!call) {
  console.error("no call found");
  await client.close();
  process.exit(1);
}

const callId = call.id || String(call._id);
const messages = (call.messages || []).filter((m) => m.role === "user" || m.role === "assistant");

console.log("=".repeat(100));
console.log(`call        ${callId}`);
console.log(`runtime     ${call.voiceRuntime || call.runtime || "-"}`);
console.log(`language    ${call.language || "-"}   agent=${call.agentId || "-"}`);
console.log(`status      ${call.status}   disposition=${call.disposition || "-"}`);
console.log(`started     ${call.createdAt ? new Date(call.createdAt).toISOString() : "-"}`);
console.log(`recording   ${call.recordingKey || "(none)"}`);
console.log("=".repeat(100));

// ---- telemetry -------------------------------------------------------------
// Metrics are appended to call.telemetry.events by the /events ingest, not a collection.
const metrics = call.telemetry?.events || [];

console.log("\n--- telemetry ---");
if (!metrics.length) {
  console.log("none recorded");
} else {
  const byName = {};
  for (const m of metrics) {
    const name = m.name || m.metric || "?";
    (byName[name] ||= []).push(Number(m.value));
  }
  for (const [name, values] of Object.entries(byName)) {
    const list = values.filter(Number.isFinite);
    if (!list.length) continue;
    const avg = Math.round(list.reduce((a, b) => a + b, 0) / list.length);
    console.log(
      `${name.padEnd(28)} n=${String(list.length).padEnd(3)} avg=${String(avg).padEnd(7)}ms  values=[${list.join(", ")}]`
    );
  }
}

// ---- transcript ------------------------------------------------------------
console.log("\n--- transcript (gap = time since previous turn) ---\n");

const replyGaps = [];
const userWaitGaps = [];
const flags = [];
let prev = null;

const t0 = messages.length ? new Date(messages[0].timestamp).getTime() : 0;

for (const [i, m] of messages.entries()) {
  const at = new Date(m.timestamp).getTime();
  const offset = Number.isFinite(at - t0) ? ((at - t0) / 1000).toFixed(1) : "?";
  const gap = prev ? at - new Date(prev.timestamp).getTime() : 0;
  const text = String(m.text || "").trim();
  const words = text.split(/\s+/).filter(Boolean).length;

  if (prev?.role === "user" && m.role === "assistant" && gap >= 0 && gap < 120000) {
    replyGaps.push({ ms: gap, at: offset, i });
  }
  if (prev?.role === "assistant" && m.role === "user" && gap >= 0 && gap < 300000) {
    userWaitGaps.push({ ms: gap, at: offset, i });
  }

  const note = [];
  // The agent replied while the caller was plainly mid-thought.
  if (m.role === "user" && text && !/[.!?।]$/.test(text) && OPEN_TAIL.test(text)) {
    note.push("CUT-OFF?");
    flags.push({ i, kind: "cutoff", text });
  }
  // Over-capture: one "user turn" that is really several sentences merged together.
  if (m.role === "user" && words >= 28) {
    note.push("OVER-CAPTURE?");
    flags.push({ i, kind: "overcapture", text, words });
  }
  // Agent's own words showing up as caller speech.
  if (m.role === "user" && prev?.role === "assistant") {
    const prevText = String(prev.text || "").toLowerCase();
    const norm = text.toLowerCase();
    if (norm.length > 12 && prevText.includes(norm.slice(0, Math.min(30, norm.length)))) {
      note.push("ECHO?");
      flags.push({ i, kind: "echo", text });
    }
  }
  if (m.role === "assistant" && prev?.role === "assistant") {
    note.push("BACK-TO-BACK AGENT");
    flags.push({ i, kind: "double_agent", text });
  }

  const gapLabel = prev ? `+${(gap / 1000).toFixed(1)}s` : "start";
  const slow = m.role === "assistant" && gap > 3000 ? "  <== SLOW REPLY" : "";
  console.log(
    `[${String(i).padStart(2)}] t=${String(offset).padStart(6)}s ${gapLabel.padStart(7)}  ${m.role === "user" ? "user     " : "assistant"}: ${text}${note.length ? `   [${note.join(" ")}]` : ""}${slow}`
  );

  prev = m;
}

// ---- summary ---------------------------------------------------------------
function pct(list, p) {
  if (!list.length) return 0;
  const sorted = [...list].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

const replyMs = replyGaps.map((g) => g.ms);
console.log("\n--- reply latency (caller finished -> agent line saved) ---");
console.log(`samples ${replyMs.length}`);
if (replyMs.length) {
  console.log(`p50 ${pct(replyMs, 50)}ms   p90 ${pct(replyMs, 90)}ms   max ${Math.max(...replyMs)}ms`);
  const slowest = [...replyGaps].sort((a, b) => b.ms - a.ms).slice(0, 5);
  for (const s of slowest) console.log(`  turn ${s.i} at t=${s.at}s -> ${s.ms}ms`);
}

const waitMs = userWaitGaps.map((g) => g.ms);
console.log("\n--- caller silence after the agent spoke (thinking / dead air) ---");
if (waitMs.length) {
  console.log(`p50 ${pct(waitMs, 50)}ms   max ${Math.max(...waitMs)}ms`);
  const longest = [...userWaitGaps].sort((a, b) => b.ms - a.ms).slice(0, 5);
  for (const s of longest) console.log(`  before turn ${s.i} at t=${s.at}s -> ${s.ms}ms`);
}

console.log("\n--- transcript quality flags ---");
if (!flags.length) {
  console.log("none");
} else {
  const grouped = {};
  for (const f of flags) (grouped[f.kind] ||= []).push(f);
  for (const [kind, list] of Object.entries(grouped)) {
    console.log(`\n${kind} (${list.length}):`);
    for (const f of list) console.log(`  [${f.i}] ${f.text.slice(0, 150)}${f.words ? `  (${f.words} words)` : ""}`);
  }
}

const userTurns = messages.filter((m) => m.role === "user").length;
const agentTurns = messages.filter((m) => m.role === "assistant").length;
console.log("\n--- totals ---");
console.log(`user turns ${userTurns}   agent turns ${agentTurns}`);
const durationS = messages.length
  ? (new Date(messages.at(-1).timestamp).getTime() - t0) / 1000
  : 0;
console.log(`conversation span ${durationS.toFixed(1)}s`);

await client.close();
