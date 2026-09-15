/**
 * Step 6: how often does the caller ask the agent to change language, and does the
 * agent actually comply? Script detection is done on the audio transcript, so it does
 * not depend on speaker attribution being perfect.
 *
 * Usage (from backend/): node --env-file=../.env scripts/callAudit/languageAudit.js
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { WORK_DIR } from "./paths.js";

const TELUGU = /[\u0C00-\u0C7F]/;
const DEVANAGARI = /[\u0900-\u097F]/;

/** Caller explicitly asking for another language, in Hindi / English / romanised. */
const SWITCH_REQUEST =
  /(समझ नहीं|समझ में नहीं|हिंदी में बात|हिंदी बात|मेरी भाषा|हिंदी बोल|हिंदी में बोल|तेलुगु समझ|तमिल समझ|samajh nahi|hindi mein|speak hindi|in hindi|don't understand|dont understand|not understand|another language|change the language)/i;

const calls = JSON.parse(await readFile(path.join(WORK_DIR, "analysis.json"), "utf8"));

const client = new MongoClient(process.env.MONGODB_URI);
await client.connect();
const db = client.db(process.env.MONGODB_DB || "zoco");
const docs = await db
  .collection("calls")
  .find({ _id: { $in: calls.map((c) => c.callId) } })
  .toArray();
const byId = new Map(docs.map((d) => [String(d._id), d]));
await client.close();

let mismatchConfig = 0;
let requestCalls = 0;
let compliedCalls = 0;
const rows = [];

for (const call of calls) {
  const doc = byId.get(call.callId);
  if (!doc) continue;

  const configured = doc.language || "-";
  const greeting = (doc.messages || []).find((m) => m.role === "assistant")?.text || "";
  const greetingScript = TELUGU.test(greeting) ? "te" : DEVANAGARI.test(greeting) ? "hi" : "en";
  const configuredLang = configured.startsWith("te") ? "te" : configured.startsWith("hi") ? "hi" : "en";
  const configMismatch = greeting && greetingScript !== configuredLang;
  if (configMismatch) mismatchConfig += 1;

  // Find the first moment the caller asks for a different language.
  const request = call.transcript.find((t) => SWITCH_REQUEST.test(t.text));
  if (!request) continue;
  requestCalls += 1;

  // Did any Telugu-script audio still occur after the request?
  const after = call.transcript.filter((t) => t.t > request.t);
  const teluguAfter = after.filter((t) => TELUGU.test(t.text)).length;
  const hindiAfter = after.filter((t) => DEVANAGARI.test(t.text)).length;
  const complied = teluguAfter === 0 && hindiAfter > 0;
  if (complied) compliedCalls += 1;

  rows.push({
    callId: call.callId,
    configured,
    greetingScript,
    configMismatch,
    askedAt: request.t,
    ask: request.text.slice(0, 70),
    teluguAfter,
    hindiAfter,
    complied,
  });
}

console.log(`=== CONFIGURED LANGUAGE vs GREETING SCRIPT ===`);
console.log(`calls where the greeting is in a different language than call.language: ${mismatchConfig}/${byId.size}`);
console.log("");
const dist = {};
for (const d of byId.values()) {
  const greeting = (d.messages || []).find((m) => m.role === "assistant")?.text || "";
  if (!greeting) continue;
  const script = TELUGU.test(greeting) ? "te" : DEVANAGARI.test(greeting) ? "hi" : "en";
  const key = `call.language=${d.language || "-"} -> greeting=${script}`;
  dist[key] = (dist[key] || 0) + 1;
}
for (const [k, v] of Object.entries(dist).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);

console.log("");
console.log(`=== CALLER ASKED TO CHANGE LANGUAGE ===`);
console.log(`calls with an explicit request: ${requestCalls}`);
console.log(`agent complied (no further Telugu): ${compliedCalls}`);
console.log("");
for (const r of rows) {
  console.log(`${r.callId}  cfg=${r.configured} greeting=${r.greetingScript}${r.configMismatch ? " MISMATCH" : ""}`);
  console.log(`   @${r.askedAt}s caller: ${JSON.stringify(r.ask)}`);
  console.log(`   after: telugu-utterances=${r.teluguAfter} hindi-utterances=${r.hindiAfter} complied=${r.complied}`);
}
