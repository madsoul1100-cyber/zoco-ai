import { connectMongo, mongoState, pingMongo } from "./mongo.js";
import { connectQueue, queueCounts, queueState } from "./queue.js";
import { connectRedis, redisState } from "./redis.js";
import { connectS3, s3State } from "./s3.js";

export async function connectInfra() {
  const result = { mongo: false, redis: false, s3: false, queue: false };
  try {
    await connectMongo();
    result.mongo = true;
  } catch (error) {
    mongoState.error = error.message;
    throw new Error(`MongoDB required: ${error.message}. Run npm run infra`);
  }
  try {
    await connectRedis();
    result.redis = true;
    await connectQueue();
    result.queue = queueState.ready;
  } catch (error) {
    redisState.error = error.message;
    console.warn("Redis unavailable — cache/queue disabled:", error.message);
  }
  try {
    await connectS3();
    result.s3 = true;
  } catch (error) {
    s3State.error = error.message;
    console.warn("AWS S3 unavailable — recordings stay on disk:", error.message);
  }
  return result;
}

export async function infraHealth() {
  let mongo = false;
  try {
    mongo = await pingMongo();
  } catch {
    mongo = false;
  }
  const counts = await queueCounts().catch(() => ({ waiting: 0, delayed: 0, active: 0 }));
  return {
    mongo: { ready: mongo, error: mongoState.error },
    redis: { ready: redisState.ready, error: redisState.error },
    s3: { ready: s3State.ready, bucket: s3State.bucket, region: s3State.region, error: s3State.error },
    queue: { ready: queueState.ready, ...counts },
  };
}
