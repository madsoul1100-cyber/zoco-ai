import {
  GetBucketLocationCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const s3State = { ready: false, bucket: "", region: "", error: null };
let client;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const LOCAL_DIR = path.join(root, "data", "recordings");

function credentials() {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID || process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY || process.env.S3_SECRET_KEY;
  if (accessKeyId && secretAccessKey) return { accessKeyId, secretAccessKey };
  return undefined;
}

function makeClient(region) {
  const config = { region };
  const creds = credentials();
  if (creds) config.credentials = creds;
  return new S3Client(config);
}

export async function connectS3() {
  let region = process.env.AWS_REGION || process.env.S3_REGION || "ap-south-1";
  s3State.bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || "zoco-recordings";
  client = makeClient(region);
  try {
    const loc = await client.send(new GetBucketLocationCommand({ Bucket: s3State.bucket }));
    const actual = loc.LocationConstraint || "us-east-1";
    if (actual !== region) {
      region = actual;
      client = makeClient(region);
    }
  } catch {
    /* HeadBucket below will surface a real error */
  }
  s3State.region = region;
  await client.send(new HeadBucketCommand({ Bucket: s3State.bucket }));
  s3State.ready = true;
  s3State.error = null;
  return client;
}

export async function uploadRecording({ callId, buffer, contentType = "audio/webm", ext = "webm" }) {
  const key = `calls/${callId}/${Date.now()}.${ext}`;
  if (s3State.ready && client) {
    await client.send(
      new PutObjectCommand({
        Bucket: s3State.bucket,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    return { key, bucket: s3State.bucket, storage: "s3" };
  }
  await mkdir(LOCAL_DIR, { recursive: true });
  const filePath = path.join(LOCAL_DIR, `${callId}.${ext}`);
  await writeFile(filePath, buffer);
  return { key, path: filePath, storage: "local" };
}

export async function getRecordingStream({ key, filePath }) {
  if (s3State.ready && client && key) {
    const response = await client.send(
      new GetObjectCommand({ Bucket: s3State.bucket, Key: key })
    );
    return { stream: response.Body, contentType: response.ContentType || "audio/webm" };
  }
  if (filePath) {
    const buffer = await readFile(filePath);
    return { stream: buffer, contentType: "audio/webm" };
  }
  return null;
}
