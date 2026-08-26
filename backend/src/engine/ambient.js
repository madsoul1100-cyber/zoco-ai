import { spawn } from "node:child_process";
import { access, mkdir, readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const QUIET_OFFICE_PATH = path.join(ROOT, "data", "audio", "quiet-office.mp3");

export function ambientEnabled(settings = {}) {
  const sound = String(settings.backgroundSound || "off").toLowerCase();
  return sound === "quiet_office" || sound === "quiet-office" || sound === "office";
}

export function ambientVolume(settings = {}) {
  const n = Number(settings.backgroundVolume);
  if (!Number.isFinite(n)) return 0.12;
  return Math.min(0.4, Math.max(0.02, n));
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (chunk) => {
      err += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim() || `ffmpeg exited ${code}`));
    });
  });
}

export async function ensureQuietOfficeAudio() {
  try {
    await access(QUIET_OFFICE_PATH);
    return QUIET_OFFICE_PATH;
  } catch {
    /* create */
  }
  await mkdir(path.dirname(QUIET_OFFICE_PATH), { recursive: true });
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    "anoisesrc=color=pink:amplitude=0.015:sample_rate=24000,lowpass=f=1200,highpass=f=120,volume=0.35",
    "-t",
    "20",
    "-c:a",
    "libmp3lame",
    "-b:a",
    "64k",
    QUIET_OFFICE_PATH,
  ]);
  return QUIET_OFFICE_PATH;
}

export async function getQuietOfficeBuffer() {
  await ensureQuietOfficeAudio();
  return readFile(QUIET_OFFICE_PATH);
}

export async function mixAmbientIntoSpeech(speechBuffer, { volume = 0.12, ext = "mp3" } = {}) {
  if (!speechBuffer?.length) return speechBuffer;
  try {
    await ensureQuietOfficeAudio();
  } catch (error) {
    console.warn("Ambient audio unavailable:", error.message);
    return speechBuffer;
  }
  const dir = await mkdtemp(path.join(tmpdir(), "zoco-amb-"));
  const inSpeech = path.join(dir, `speech.${ext === "wav" ? "wav" : "mp3"}`);
  const outFile = path.join(dir, "mixed.mp3");
  try {
    await writeFile(inSpeech, speechBuffer);
    const vol = ambientVolume({ backgroundVolume: volume });
    await runFfmpeg([
      "-y",
      "-i",
      inSpeech,
      "-stream_loop",
      "-1",
      "-i",
      QUIET_OFFICE_PATH,
      "-filter_complex",
      `[1:a]volume=${vol}[amb];[0:a][amb]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[out]`,
      "-map",
      "[out]",
      "-c:a",
      "libmp3lame",
      "-b:a",
      "96k",
      outFile,
    ]);
    return readFile(outFile);
  } catch (error) {
    console.warn("Ambient mix skipped:", error.message);
    return speechBuffer;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
