/**
 * Step 3: transcribe every decodable recording with Deepgram, keeping word-level
 * timings and speaker labels. Those timings are what let us measure real pauses,
 * real reply latency and agent/caller overlap from the audio itself.
 *
 * Recordings are mixed mono (stereo channels are identical), so speaker separation
 * relies on diarization rather than channel routing.
 *
 * Usage (from backend/): node --env-file=../.env scripts/callAudit/transcribe.js
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { TRANSCRIPT_DIR, WORK_DIR } from "./paths.js";

const apiKey = process.env.DEEPGRAM_API_KEY;
if (!apiKey) {
  console.error("DEEPGRAM_API_KEY missing");
  process.exit(1);
}

const CONCURRENCY = 4;
const params = new URLSearchParams({
  model: "nova-3",
  language: "multi",
  diarize: "true",
  utterances: "true",
  punctuate: "true",
  smart_format: "true",
});

async function transcribeOne(entry) {
  const out = path.join(TRANSCRIPT_DIR, `${entry.callId}.json`);
  try {
    await stat(out);
    return { callId: entry.callId, cached: true };
  } catch {
    /* not transcribed yet */
  }

  const audio = await readFile(entry.wav || entry.file);
  const response = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
    method: "POST",
    headers: { Authorization: `Token ${apiKey}`, "Content-Type": "audio/wav" },
    body: audio,
  });

  if (!response.ok) {
    const body = await response.text();
    return { callId: entry.callId, error: `${response.status} ${body.slice(0, 200)}` };
  }

  const json = await response.json();
  await writeFile(out, JSON.stringify(json));
  const words = json.results?.channels?.[0]?.alternatives?.[0]?.words?.length || 0;
  const utterances = json.results?.utterances?.length || 0;
  return { callId: entry.callId, words, utterances };
}

async function main() {
  await mkdir(TRANSCRIPT_DIR, { recursive: true });
  const prepared = JSON.parse(await readFile(path.join(WORK_DIR, "prepared.json"), "utf8"));
  const targets = prepared.filter((entry) => entry.ok && (entry.wav || entry.file));

  console.log(`transcribing ${targets.length} recordings (nova-3, multi, diarized)`);

  const queue = [...targets];
  let done = 0;
  const failures = [];

  async function worker() {
    while (queue.length) {
      const entry = queue.shift();
      try {
        const result = await transcribeOne(entry);
        done += 1;
        if (result.error) {
          failures.push(result);
          console.log(`[${done}/${targets.length}] ${result.callId} ERROR ${result.error}`);
        } else if (result.cached) {
          console.log(`[${done}/${targets.length}] ${result.callId} (cached)`);
        } else {
          console.log(
            `[${done}/${targets.length}] ${result.callId} words=${result.words} utterances=${result.utterances}`
          );
        }
      } catch (error) {
        done += 1;
        failures.push({ callId: entry.callId, error: error.message });
        console.log(`[${done}/${targets.length}] ${entry.callId} THREW ${error.message}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  console.log("");
  console.log(`transcribed: ${targets.length - failures.length}/${targets.length}`);
  if (failures.length) {
    console.log("failures:");
    for (const f of failures) console.log(`  ${f.callId}: ${f.error}`);
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
