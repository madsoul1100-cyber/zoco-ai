/**
 * Step 1 of the call audit: pull recordings out of S3 to a local scratch dir and
 * probe each one so we know duration / channel layout before transcribing.
 *
 * Usage (from backend/):
 *   node --env-file=../.env scripts/callAudit/fetchRecordings.js [minBytes]
 */
import { execFile } from "node:child_process";
import { mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  GetBucketLocationCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { AUDIO_DIR, WORK_DIR } from "./paths.js";

const execFileAsync = promisify(execFile);
const minBytes = Number(process.argv[2] || 150 * 1024);
const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || "zoco-recordings";

async function makeClient() {
  let region = process.env.AWS_REGION || process.env.S3_REGION || "ap-south-1";
  try {
    const probe = new S3Client({ region: "us-east-1" });
    const loc = await probe.send(new GetBucketLocationCommand({ Bucket: bucket }));
    region = loc.LocationConstraint || "us-east-1";
  } catch {
    /* keep configured region */
  }
  return { client: new S3Client({ region }), region };
}

async function probe(file) {
  const { stdout } = await execFileAsync("ffprobe", [
    "-v",
    "error",
    "-show_entries",
    "format=duration:stream=channels,codec_name,sample_rate",
    "-of",
    "json",
    file,
  ]);
  const info = JSON.parse(stdout);
  const stream = info.streams?.[0] || {};
  return {
    durationSec: Number(info.format?.duration || 0),
    channels: stream.channels ?? null,
    codec: stream.codec_name ?? null,
    sampleRate: stream.sample_rate ? Number(stream.sample_rate) : null,
  };
}

async function main() {
  await mkdir(AUDIO_DIR, { recursive: true });
  const { client, region } = await makeClient();

  const objects = [];
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "calls/", ContinuationToken: token })
    );
    for (const item of page.Contents || []) objects.push(item);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  const candidates = objects
    .filter((item) => (item.Size || 0) >= minBytes)
    .sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));

  console.log(`bucket ${bucket} (${region}) — ${objects.length} objects, ${candidates.length} >= ${Math.round(minBytes / 1024)}KB`);

  const manifest = [];
  for (const [index, item] of candidates.entries()) {
    const callId = item.Key.split("/")[1] || `unknown_${index}`;
    const file = path.join(AUDIO_DIR, `${callId}.webm`);

    let cached = false;
    try {
      const existing = await stat(file);
      cached = existing.size === item.Size;
    } catch {
      /* not downloaded yet */
    }

    if (!cached) {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: item.Key }));
      await writeFile(file, Buffer.from(await response.Body.transformToByteArray()));
    }

    let audio = {};
    try {
      audio = await probe(file);
    } catch (error) {
      console.log(`  ! ffprobe failed for ${callId}: ${error.message.split("\n")[0]}`);
    }

    manifest.push({
      callId,
      key: item.Key,
      bytes: item.Size,
      lastModified: item.LastModified,
      file,
      ...audio,
    });
    console.log(
      `[${index + 1}/${candidates.length}] ${callId} ${Math.round((item.Size || 0) / 1024)}KB ` +
        `${audio.durationSec ? audio.durationSec.toFixed(1) + "s" : "?"} ` +
        `${audio.channels ?? "?"}ch ${audio.codec ?? "?"}${cached ? " (cached)" : ""}`
    );
  }

  await mkdir(WORK_DIR, { recursive: true });
  await writeFile(path.join(WORK_DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`\nmanifest: ${path.join(WORK_DIR, "manifest.json")}`);
}

main().catch((error) => {
  console.error(`FAILED: ${error.name}: ${error.message}`);
  process.exit(1);
});
