/**
 * Step 5: aggregate the per-call analysis into a prioritised findings report.
 * Usage (from backend/): node scripts/callAudit/report.js
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { WORK_DIR } from "./paths.js";

const p = (arr, q) => {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((q / 100) * s.length))];
};

const calls = JSON.parse(await readFile(path.join(WORK_DIR, "analysis.json"), "utf8"));

// Substantive = long enough that a real conversation could have happened.
const real = calls.filter((c) => c.durationSec >= 20);
const empty = calls.filter((c) => c.utterances === 0);

console.log(`=== CORPUS ===`);
console.log(`recordings analysed: ${calls.length}`);
console.log(`>=20s: ${real.length}`);
console.log(`zero speech detected: ${empty.length}  ${empty.map((c) => c.callId).join(", ")}`);
console.log("");

const allLat = real.flatMap((c) => c.replyLatencies);
console.log(`=== REPLY LATENCY (caller stops -> agent starts, measured from audio) ===`);
console.log(`samples: ${allLat.length}`);
console.log(`p50 ${p(allLat, 50)}s   p75 ${p(allLat, 75)}s   p90 ${p(allLat, 90)}s   max ${allLat.length ? Math.max(...allLat) : "-"}s`);
console.log(`turns over 3s: ${allLat.filter((x) => x > 3).length} (${Math.round((allLat.filter((x) => x > 3).length / (allLat.length || 1)) * 100)}%)`);
console.log(`turns over 5s: ${allLat.filter((x) => x > 5).length}`);
console.log("");

const silences = real.map((c) => c.silencePct).filter((x) => x !== null);
console.log(`=== DEAD AIR ===`);
console.log(`median share of call that is silence: ${p(silences, 50)}%`);
const allDead = real.flatMap((c) => c.deadAir.map((d) => d.gap));
console.log(`gaps >=3s: ${allDead.length} across ${real.filter((c) => c.deadAir.length).length} calls`);
console.log(`gaps >=8s: ${allDead.filter((g) => g >= 8).length}`);
console.log(`longest single gap: ${allDead.length ? Math.max(...allDead) : "-"}s`);
console.log("");

console.log(`=== WORST DEAD-AIR CALLS ===`);
for (const c of [...real].sort((a, b) => b.longestDeadAir - a.longestDeadAir).slice(0, 8)) {
  console.log(
    `${c.callId}  dur=${c.durationSec}s silence=${c.silencePct}% longestGap=${c.longestDeadAir}s gaps>=3s=${c.deadAir.length} lang=${c.language}`
  );
}
console.log("");

const overlapCalls = real.filter((c) => c.overlaps.length);
const agentInterrupts = real.flatMap((c) =>
  c.overlaps.filter((o) => o.interrupter === "agent").map((o) => ({ ...o, callId: c.callId }))
);
console.log(`=== AGENT TALKING OVER THE CALLER ===`);
console.log(`calls with any overlap: ${overlapCalls.length}/${real.length}`);
console.log(`agent-interrupts-caller events: ${agentInterrupts.length}`);
for (const o of agentInterrupts.slice(0, 10)) {
  console.log(`  ${o.callId} @${o.at}s overlap=${o.overlap}s cut: ${JSON.stringify(o.cutText)}`);
}
console.log("");

console.log(`=== GREETING DELIVERY (share of intended greeting actually spoken) ===`);
const greet = real.filter((c) => c.greetingDeliveredPct !== null);
const truncated = greet.filter((c) => c.greetingDeliveredPct < 0.5);
console.log(`measurable: ${greet.length}`);
console.log(`delivered <50% of greeting: ${truncated.length}`);
for (const c of truncated.slice(0, 10)) {
  console.log(`  ${c.callId} delivered=${Math.round(c.greetingDeliveredPct * 100)}% firstAudio=${c.firstAgentAudioSec}s`);
}
console.log("");

console.log(`=== CALLER SPOKE, AGENT NEVER ANSWERED (>=8s, caller spoke again) ===`);
const un = real.flatMap((c) => c.unanswered.map((u) => ({ ...u, callId: c.callId })));
console.log(`events: ${un.length} across ${real.filter((c) => c.unanswered.length).length} calls`);
for (const u of un.slice(0, 10)) {
  console.log(`  ${u.callId} @${u.at}s waited ${u.gap}s after: ${JSON.stringify(u.text)}`);
}
console.log("");

console.log(`=== TALK BALANCE ===`);
const agentTalk = real.reduce((s, c) => s + c.agentSpeechSec, 0);
const callerTalk = real.reduce((s, c) => s + c.callerSpeechSec, 0);
console.log(`agent speech: ${Math.round(agentTalk)}s   caller speech: ${Math.round(callerTalk)}s`);
console.log(`agent share of speech: ${Math.round((agentTalk / (agentTalk + callerTalk || 1)) * 100)}%`);
const unknown = real.reduce((s, c) => s + c.unknownRole, 0);
const totalUtt = real.reduce((s, c) => s + c.utterances, 0);
console.log(`utterances with unresolved speaker: ${unknown}/${totalUtt} (attribution confidence caveat)`);
