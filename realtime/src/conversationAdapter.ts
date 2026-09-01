import { randomUUID } from "node:crypto";
import { fetchSnapshot, postEvent, postTool, type SessionSnapshot, type ToolReply } from "./zocoBridge.js";

export function eventId(prefix: string) {
  return `${prefix}_${randomUUID().slice(0, 12)}`;
}

export async function loadSession(callId: string): Promise<SessionSnapshot> {
  return fetchSnapshot(callId);
}

export async function callTool(callId: string, name: string, args: Record<string, unknown> = {}): Promise<ToolReply> {
  return postTool(callId, { eventId: eventId("tool"), name, args });
}

export async function recordTranscript(callId: string, role: "user" | "assistant" | "system", text: string, extra: Record<string, string> = {}) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return;
  await postEvent(callId, {
    eventId: eventId(role === "user" ? "usr" : role === "assistant" ? "asst" : "sys"),
    type: "transcript",
    role,
    text: trimmed,
    ...extra,
  });
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

export async function recordDisposition(callId: string, disposition: string, reason?: string) {
  await postEvent(callId, {
    eventId: eventId("disp"),
    type: "disposition",
    disposition,
    reason,
  });
}
