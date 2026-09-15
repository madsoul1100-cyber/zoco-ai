/**
 * List call recordings stored in S3 (keys + s3:// URIs + optional presigned URLs).
 * Usage (from backend/):
 *   node --env-file=../.env scripts/listRecordings.js          # list keys
 *   node --env-file=../.env scripts/listRecordings.js --sign   # 24h presigned https URLs
 */
import {
  GetBucketLocationCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const bucket = process.env.AWS_S3_BUCKET || process.env.S3_BUCKET || "zoco-recordings";
let region = process.env.AWS_REGION || process.env.S3_REGION || "ap-south-1";
const wantSigned = process.argv.includes("--sign");

let client = new S3Client({ region });

// The bucket may not live in the configured region — resolve it like connectS3() does.
try {
  const probe = new S3Client({ region: "us-east-1" });
  const loc = await probe.send(new GetBucketLocationCommand({ Bucket: bucket }));
  const actual = loc.LocationConstraint || "us-east-1";
  if (actual !== region) {
    region = actual;
    client = new S3Client({ region });
  }
} catch {
  /* fall through with configured region */
}

async function main() {
  const objects = [];
  let token;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: "calls/", ContinuationToken: token })
    );
    for (const item of page.Contents || []) objects.push(item);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);

  objects.sort((a, b) => new Date(b.LastModified) - new Date(a.LastModified));

  console.log(`bucket: ${bucket}`);
  console.log(`region: ${region}`);
  console.log(`recordings: ${objects.length}`);
  console.log("");

  for (const item of objects) {
    const callId = item.Key.split("/")[1] || "";
    const kb = Math.round((item.Size || 0) / 1024);
    console.log(`${item.LastModified.toISOString()}  ${kb}KB  ${callId}`);
    console.log(`  s3://${bucket}/${item.Key}`);
    if (wantSigned) {
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const url = await getSignedUrl(
        client,
        new GetObjectCommand({ Bucket: bucket, Key: item.Key }),
        { expiresIn: 86400 }
      );
      console.log(`  ${url}`);
    }
  }
}

main().catch((error) => {
  console.error(`FAILED: ${error.name}: ${error.message}`);
  process.exit(1);
});
