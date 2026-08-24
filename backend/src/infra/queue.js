import { Queue, Worker } from "bullmq";
import { createQueueConnection, redisState } from "./redis.js";

const QUEUE_NAME = "zoco-calls";
let queue;
let worker;
let connection;
export const queueState = { ready: false, waiting: 0 };

export async function connectQueue() {
  if (!redisState.ready) return null;
  connection = createQueueConnection();
  queue = new Queue(QUEUE_NAME, { connection });
  queueState.ready = true;
  return queue;
}

export async function enqueueDial(callId, { delayMs = 0, jobId } = {}) {
  if (!queue) return { inline: true };
  const id = (jobId || `dial-${callId}`).replaceAll(":", "-");
  const existing = await queue.getJob(id);
  if (existing) {
    const state = await existing.getState();
    if (delayMs <= 0 && (state === "delayed" || state === "waiting")) {
      await existing.promote().catch(() => {});
    }
    return { queued: true, existing: true };
  }
  await queue.add(
    "dial",
    { callId },
    {
      delay: Math.max(0, delayMs),
      jobId: id,
      attempts: 3,
      backoff: { type: "exponential", delay: 4000 },
      removeOnComplete: 200,
      removeOnFail: 200,
    }
  );
  return { queued: true };
}

export async function enqueueRecall(callId, { delayMs = 0 } = {}) {
  if (!queue) return { inline: false, skipped: true };
  await queue.add(
    "recall",
    { callId },
    {
      delay: Math.max(0, delayMs),
      jobId: `recall-${callId}`.replaceAll(":", "-"),
      attempts: 3,
      backoff: { type: "exponential", delay: 8000 },
      removeOnComplete: 200,
      removeOnFail: 200,
    }
  );
  return { queued: true };
}

export async function queueCounts() {
  if (!queue) return { waiting: 0, delayed: 0, active: 0 };
  const counts = await queue.getJobCounts("waiting", "delayed", "active");
  queueState.waiting = (counts.waiting || 0) + (counts.delayed || 0);
  return counts;
}

export function startCallWorker(handler) {
  if (!connection || worker) return null;
  worker = new Worker(QUEUE_NAME, handler, {
    connection,
    concurrency: Number(process.env.ZOCO_DIAL_CONCURRENCY || 4),
  });
  worker.on("failed", (job, error) => {
    console.error(`Call job ${job?.name} ${job?.id} failed:`, error.message);
  });
  return worker;
}
