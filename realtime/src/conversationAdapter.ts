import { randomUUID } from "node:crypto";
import { fetchSnapshot, postEvent, postTurn, type SessionSnapshot, type TurnReply } from "./zocoBridge.js";

export function eventId(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

export async function loadSession(callId: string): Promise<SessionSnapshot> {
  return fetchSnapshot(callId);
}

export async function handleUserTurn(callId: string, userText: string, sttLanguage?: string | null): Promise<TurnReply> {
  const trimmed = String(userText || "").trim();
  if (!trimmed) return { text: "", endCall: false, disposition: null };
  await postEvent(callId, {
    eventId: eventId("usr"),
    type: "transcript",
    role: "user",
    text: trimmed,
  });
  const reply = await postTurn(callId, {
    eventId: eventId("turn"),
    userText: trimmed,
    sttLanguage: sttLanguage || null,
  });
  if (reply.text) {
    await postEvent(callId, {
      eventId: eventId("asst"),
      type: "transcript",
      role: "assistant",
      text: reply.text,
      disposition: reply.disposition || undefined,
    });
  }
  if (reply.endCall && reply.disposition) {
    await postEvent(callId, {
      eventId: eventId("disp"),
      type: "disposition",
      disposition: reply.disposition,
      reason: "agent_end",
    });
  }
  return reply;
}

export async function recordMetric(callId: string, name: string, value: number | string, extra: Record<string, number | string> = {}) {
  await postEvent(callId, {
    eventId: eventId("metric"),
    type: "metric",
    metrics: { name, value, ...extra },
  });
}

export async function recordStatus(callId: string, status: string, reason?: string) {
  await postEvent(callId, {
    eventId: eventId("status"),
    type: "status",
    status,
    reason,
  });
}
