/**
 * Step 2: validate + normalise recordings for transcription.
 *
 * Checks which files actually decode, measures true duration, and reports whether
 * stereo files carry two independent speakers (caller vs agent) or just duplicated
 * mono. Emits 16k wav copies that Deepgram can consume reliably.
 *
 * Usage (from backend/): node scripts/callAudit/prepareAudio.js
 */
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { AUDIO_DIR, WORK_DIR } from "./paths.js";

const execFileAsync = promisify(execFile);
const WAV_DIR = path.join(WORK_DIR, "wav");

async function run(bin, args) {
  return execFileAsync(bin, args, { maxBuffer: 32 * 1024 * 1024 });
}

/** Decode fully — the only trustworthy duration for MediaRecorder WebM. */
async function decodeInfo(file) {
  try {
    const { stderr } = await run("ffmpeg", ["-i", file, "-f", "null", "-"]);
    const times = [...stderr.matchAll(/time=(\d+):(\d+):([\d.]+)/g)];
    const last = times.at(-1);
    const durationSec = last
      ? Number(last[1]) * 3600 + Number(last[2]) * 60 + Number(last[3])
      : 0;
    const channels = /Audio:.*?, (mono|stereo)/.exec(stderr)?.[1] || null;
    const corruptHints = (stderr.match(/Invalid data|corrupt|EBML|non-monotonous|Error/gi) || []).length;
    return { ok: durationSec > 0, durationSec, channels, corruptHints };
  } catch (error) {
    return { ok: false, durationSec: 0, channels: null, error: String(error.stderr || error.message).split("\n").slice(-4).join(" ").slice(0, 200) };
  }
}

/**
 * Per-channel RMS. If the two channels differ materially the recording carries
 * caller and agent separately, which makes turn analysis exact rather than inferred.
 */
async function channelStats(file) {
  try {
    const { stderr } = await run("ffmpeg", [
      "-i", file,
      "-af", "astats=metadata=1:reset=0",
      "-f", "null", "-",
    ]);
    const rms = [...stderr.matchAll(/RMS level dB:\s*(-?[\d.]+|-inf)/g)].map((m) => m[1]);
    return rms.slice(0, 2);
  } catch {
    return [];
  }
}

async function main() {
  await mkdir(WAV_DIR, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(WORK_DIR, "manifest.json"), "utf8"));

  const results = [];
  for (const [index, entry] of manifest.entries()) {
    const info = await decodeInfo(entry.file);
    let rms = [];
    let wav = null;

    if (info.ok) {
      rms = await channelStats(entry.file);
      wav = path.join(WAV_DIR, `${entry.callId}.wav`);
      try {
        await run("ffmpeg", ["-y", "-i", entry.file, "-ac", "1", "-ar", "16000", wav]);
      } catch {
        wav = null;
      }
    }

    results.push({ ...entry, ...info, rms, wav });
    console.log(
      `[${index + 1}/${manifest.length}] ${entry.callId} ` +
        `${info.ok ? info.durationSec.toFixed(1) + "s" : "DECODE-FAIL"} ` +
        `${info.channels || "-"} rms=[${rms.join(", ")}]`
    );
  }

  await writeFile(path.join(WORK_DIR, "prepared.json"), JSON.stringify(results, null, 2));

  const ok = results.filter((r) => r.ok);
  const bad = results.filter((r) => !r.ok);
  const totalSec = ok.reduce((sum, r) => sum + r.durationSec, 0);
  console.log("");
  console.log(`decodable: ${ok.length}/${results.length}`);
  console.log(`corrupt / unreadable: ${bad.length}`);
  if (bad.length) console.log(`  ${bad.map((r) => r.callId).join(", ")}`);
  console.log(`total audio: ${(totalSec / 60).toFixed(1)} min`);
  const stereo = ok.filter((r) => r.channels === "stereo");
  console.log(`stereo: ${stereo.length}, mono: ${ok.length - stereo.length}`);
}

main().catch((error) => {
  console.error(`FAILED: ${error.message}`);
  process.exit(1);
});
