import { col } from "./mongo.js";
import { getRedis } from "./redis.js";

const STREAM = "zoco.transcripts";

export async function recordTurn({ call, message, source }) {
  const turn = {
    _id: message.id,
    callId: call.id,
    agentId: call.agentId,
    customerPhone: call.customer?.phone || "",
    source: source || call.channel || "chat",
    role: message.role,
    text: message.text,
    timestamp: message.timestamp,
    audioOffsetMs: message.audioOffsetMs ?? null,
    provider: message.provider || null,
    createdAt: new Date().toISOString(),
  };
  await col("turns").insertOne(turn).catch(() => {});
  const redis = getRedis();
  if (redis) {
    await redis.xadd(
      STREAM,
      "*",
      "callId",
      call.id,
      "role",
      String(turn.role),
      "source",
      String(turn.source),
      "text",
      String(turn.text || "").slice(0, 2000)
    );
  }
  return turn;
}

export async function listTurns(callId) {
  return col("turns")
    .find({ callId })
    .sort({ timestamp: 1 })
    .toArray();
}
