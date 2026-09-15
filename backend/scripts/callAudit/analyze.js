/**
 * Step 4: turn the diarized transcripts into conversation-quality metrics.
 *
 * Speaker attribution does not rely on diarization alone — on mixed-mono recordings
 * Deepgram often collapses TTS and caller into one speaker. Instead each utterance is
 * matched against the agent lines already stored in Mongo, which are known exactly.
 *
 * Usage (from backend/): node --env-file=../.env scripts/callAudit/analyze.js
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { MongoClient } from "mongodb";
import { TRANSCRIPT_DIR, WORK_DIR } from "./paths.js";

const DEAD_AIR_SEC = 3;
const LONG_DEAD_AIR_SEC = 8;
const OVERLAP_SEC = 0.35;

function norm(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(text) {
  return norm(text).split(" ").filter((t) => t.length > 2);
}

/** Fraction of the utterance's words that appear in the candidate agent line. */
function coverage(utterance, candidate) {
  const a = tokens(utterance);
  if (!a.length) return 0;
  const b = new Set(tokens(candidate));
  if (!b.size) return 0;
  let hit = 0;
  for (const token of a) if (b.has(token)) hit += 1;
  return hit / a.length;
}

function attribute(utterances, agentLines, userLines) {
  return utterances.map((u) => {
    let bestAgent = 0;
    for (const line of agentLines) bestAgent = Math.max(bestAgent, coverage(u.transcript, line));
    let bestUser = 0;
    for (const line of userLines) bestUser = Math.max(bestUser, coverage(u.transcript, line));

    let role;
    if (bestAgent >= 0.6 && bestAgent > bestUser) role = "agent";
    else if (bestUser >= 0.6 && bestUser > bestAgent) role = "caller";
    else role = null;
    return { ...u, role, agentScore: Number(bestAgent.toFixed(2)), userScore: Number(bestUser.toFixed(2)) };
  });
}

/**
 * Fill unmatched utterances using diarization clusters: whichever speaker id is
 * dominated by confirmed-agent utterances is treated as the agent.
 */
function fillByDiarization(labelled) {
  const tally = new Map();
  for (const u of labelled) {
    if (u.role === null) continue;
    const key = u.speaker ?? -1;
    const entry = tally.get(key) || { agent: 0, caller: 0 };
    entry[u.role] += 1;
    tally.set(key, entry);
  }
  const speakerRole = new Map();
  for (const [speaker, entry] of tally) {
    if (entry.agent === entry.caller) continue;
    speakerRole.set(speaker, entry.agent > entry.caller ? "agent" : "caller");
  }
  return labelled.map((u) =>
    u.role ? u : { ...u, role: speakerRole.get(u.speaker ?? -1) || "unknown", inferred: true }
  );
}

function analyseCall(entry, transcript, call) {
  const utterances = transcript.results?.utterances || [];
  const messages = call?.messages || [];
  const agentLines = messages.filter((m) => m.role === "assistant").map((m) => m.text);
  const userLines = messages.filter((m) => m.role === "user").map((m) => m.text);

  const labelled = fillByDiarization(attribute(utterances, agentLines, userLines));

  const replyLatencies = [];
  const deadAir = [];
  const overlaps = [];
  const unanswered = [];
  let agentSpeech = 0;
  let callerSpeech = 0;
  // Total voiced time must count unattributed utterances too, otherwise calls where
  // diarization collapsed look like 100% silence.
  let voicedSpeech = 0;
  let lastEnd = 0;

  for (const u of labelled) {
    const dur = u.end - u.start;
    if (u.role === "agent") agentSpeech += dur;
    else if (u.role === "caller") callerSpeech += dur;
    // Union of intervals — utterances can overlap slightly.
    voicedSpeech += Math.max(0, u.end - Math.max(u.start, lastEnd));
    lastEnd = Math.max(lastEnd, u.end);
  }

  for (let i = 0; i < labelled.length; i += 1) {
    const curr = labelled[i];
    const next = labelled[i + 1];
    if (!next) continue;
    const gap = next.start - curr.end;

    if (gap >= DEAD_AIR_SEC) {
      deadAir.push({ at: Number(curr.end.toFixed(2)), gap: Number(gap.toFixed(2)), after: curr.role, before: next.role });
    }
    if (gap < -OVERLAP_SEC) {
      overlaps.push({
        at: Number(next.start.toFixed(2)),
        overlap: Number(Math.abs(gap).toFixed(2)),
        interrupter: next.role,
        interrupted: curr.role,
        cutText: curr.transcript.slice(-45),
      });
    }
    // Caller finished, agent answered next — this is the lag a caller actually feels.
    if (curr.role === "caller" && next.role === "agent" && gap >= 0) {
      replyLatencies.push(Number(gap.toFixed(2)));
    }
    // Caller spoke, then caller spoke again after a long gap with no agent in between.
    if (curr.role === "caller" && next.role === "caller" && gap >= LONG_DEAD_AIR_SEC) {
      unanswered.push({ at: Number(curr.end.toFixed(2)), gap: Number(gap.toFixed(2)), text: curr.transcript.slice(0, 60) });
    }
  }

  /*
   * Greeting truncation. Deepgram splits the greeting across several utterances, so
   * compare the intended greeting against everything spoken before the caller's first
   * word (plus a short grace window) rather than only the first utterance.
   */
  const firstCallerAt = labelled.find((u) => u.role === "caller")?.start ?? Infinity;
  const intendedGreeting = agentLines[0] || "";
  let greetingDelivered = null;
  if (intendedGreeting && labelled.length) {
    const openingText = labelled
      .filter((u) => u.start < Math.min(firstCallerAt, labelled[0].start + 30) && u.role !== "caller")
      .map((u) => u.transcript)
      .join(" ");
    const spokenTokens = new Set(tokens(openingText));
    const intendedTokens = tokens(intendedGreeting);
    const hit = intendedTokens.filter((t) => spokenTokens.has(t)).length;
    greetingDelivered = intendedTokens.length ? Number((hit / intendedTokens.length).toFixed(2)) : null;
  }

  const sorted = [...replyLatencies].sort((a, b) => a - b);
  const total = entry.durationSec || (labelled.at(-1)?.end ?? 0);

  return {
    callId: entry.callId,
    durationSec: Number(total.toFixed(1)),
    language: call?.language || "-",
    disposition: call?.disposition || call?.status || "-",
    utterances: labelled.length,
    unknownRole: labelled.filter((u) => u.role === "unknown").length,
    agentSpeechSec: Number(agentSpeech.toFixed(1)),
    callerSpeechSec: Number(callerSpeech.toFixed(1)),
    voicedSec: Number(voicedSpeech.toFixed(1)),
    silenceSec: Number(Math.max(0, total - voicedSpeech).toFixed(1)),
    silencePct: total ? Number((((total - voicedSpeech) / total) * 100).toFixed(0)) : null,
    firstAgentAudioSec: labelled.length ? Number((labelled[0].start).toFixed(2)) : null,
    greetingDeliveredPct: greetingDelivered,
    replyLatencies,
    medianReplyLatency: sorted.length ? sorted[Math.floor(sorted.length / 2)] : null,
    maxReplyLatency: sorted.length ? sorted.at(-1) : null,
    deadAir,
    longestDeadAir: deadAir.length ? Math.max(...deadAir.map((d) => d.gap)) : 0,
    overlaps,
    unanswered,
    transcript: labelled.map((u) => ({
      t: Number(u.start.toFixed(2)),
      end: Number(u.end.toFixed(2)),
      role: u.role,
      text: u.transcript,
    })),
  };
}

async function main() {
  const prepared = JSON.parse(await readFile(path.join(WORK_DIR, "prepared.json"), "utf8"));
  const decodable = prepared.filter((entry) => entry.ok);

  const client = new MongoClient(process.env.MONGODB_URI);
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || "zoco");
  const ids = decodable.map((entry) => entry.callId);
  const calls = await db.collection("calls").find({ _id: { $in: ids } }).toArray();
  const callById = new Map(calls.map((c) => [String(c._id), c]));
  await client.close();

  const results = [];
  for (const entry of decodable) {
    let transcript;
    try {
      transcript = JSON.parse(await readFile(path.join(TRANSCRIPT_DIR, `${entry.callId}.json`), "utf8"));
    } catch {
      continue;
    }
    results.push(analyseCall(entry, transcript, callById.get(entry.callId)));
  }

  await writeFile(path.join(WORK_DIR, "analysis.json"), JSON.stringify(results, null, 2));
  console.log(`analysed ${results.length} calls -> ${path.join(WORK_DIR, "analysis.json")}`);
  console.log(`matched to db records: ${results.filter((r) => r.language !== "-").length}`);
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
