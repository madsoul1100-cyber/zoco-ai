import Redis from "ioredis";

let redis;
export const redisState = { ready: false, error: null };

export function redisOptions() {
  const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
  return {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: false,
  };
}

export async function connectRedis() {
  redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
    connectTimeout: 2500,
    retryStrategy: () => null,
  });
  redis.on("error", (error) => {
    redisState.error = error.message;
    redisState.ready = false;
  });
  await redis.ping();
  redisState.ready = true;
  redisState.error = null;
  return redis;
}

export function getRedis() {
  return redisState.ready ? redis : null;
}

export function createQueueConnection() {
  return new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379", {
    maxRetriesPerRequest: null,
  });
}
