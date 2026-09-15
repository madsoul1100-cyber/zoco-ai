import { v4 as uuid } from "uuid";
import { renderGreeting } from "../engine/template.js";
import { normalizeLanguage } from "../languages.js";
import { normalizePhone } from "../phone.js";
import { attachTurn } from "../services/calling.js";
import { getAgent, getCallByExotelSid, saveCall } from "../store.js";
import { exotelStreamUrl } from "./exotel.js";

function mergeParams(query = {}, body = {}) {
  return { ...query, ...body };
}

function pickExotelSid(params) {
  return String(
    params.CallSid ||
    params.Callsid ||
    params.call_sid ||
    params.CallSid ||
    ""
  ).trim() || null;
}

function pickDirection(params) {
  return String(params.Direction || params.direction || "").toLowerCase();
}

export function isExotelStreamMetadataRequest(params) {
  return Boolean(
    params["Stream[Status]"] ||
    params["Stream[StreamSID]"] ||
    params.StreamSid ||
    params.StreamSID
  );
}

export async function prepareExotelInboundStream({ params, inbound, tel, sampleRate = 16000 }) {
  const from = normalizePhone(params.From || params.from);
  const to = normalizePhone(params.To || params.to);
  const exotelSid = pickExotelSid(params);
  const direction = pickDirection(params);

  if (direction && direction !== "inbound") {
    throw new Error("This endpoint handles inbound calls only");
  }

  const enabled = inbound?.enabled || inbound?.status === "live";
  const agent = enabled && inbound?.agentId
    ? await getAgent(inbound.agentId, inbound.agentVersion)
    : null;

  if (!agent) {
    throw new Error("No inbound agent is live on this number. Turn on an inbound deployment in Zoco first.");
  }

  if (exotelSid) {
    const existing = await getCallByExotelSid(exotelSid);
    if (existing) {
      return {
        call: existing,
        url: exotelStreamUrl(tel, existing.id, sampleRate),
        reused: true,
      };
    }
  }

  const now = new Date().toISOString();
  const language = normalizeLanguage(agent.language);
  const call = {
    id: `call_${uuid().slice(0, 10)}`,
    agentId: agent.id,
    agentName: agent.name,
    agentVersion: inbound.agentVersion || agent.version || 1,
    inboundId: inbound.inboundId || inbound.id || "",
    toNumber: to || inbound.phoneNumber || tel.fromNumber || "",
    direction: "inbound",
    channel: "telephony",
    runtime: "exotel",
    exotelSid,
    customer: { name: from || "Caller", phone: from },
    status: "ringing",
    disposition: "in_progress",
    attempt: 1,
    scheduledAt: null,
    startedAt: now,
    endedAt: null,
    durationSeconds: 0,
    recordingUrl: null,
    gathered: {},
    language,
    outcomeReason: null,
    recall: { needed: false, reason: null, scheduledAt: null, attempt: 1, maxAttempts: 3 },
    createdAt: now,
    messages: [],
    nudgeIndex: 0,
  };

  const greeting =
    inbound.greeting ||
    renderGreeting(agent, { name: from || "Caller", phone: from }) ||
    agent.greeting ||
    "Thank you for calling. How can I help?";

  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "assistant",
    text: greeting,
    timestamp: now,
    audioOffsetMs: null,
  }, "exotel");

  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `Inbound Exotel ${from || "unknown"} → ${to || inbound.phoneNumber || tel.fromNumber || "Zoco"}`,
    timestamp: now,
    audioOffsetMs: null,
  }, "exotel");

  await saveCall(call);

  return {
    call,
    url: exotelStreamUrl(tel, call.id, sampleRate),
    reused: false,
  };
}

export async function applyExotelStreamMetadata(call, params) {
  if (!call) return null;

  const recordingUrl =
    params["Stream[RecordingUrl]"] ||
    params.RecordingUrl ||
    params.recordingurl ||
    null;
  const streamStatus = String(
    params["Stream[Status]"] ||
    params.StreamStatus ||
    params.status ||
    ""
  ).toLowerCase();

  if (recordingUrl) call.recordingUrl = recordingUrl;
  if (streamStatus === "completed" && !call.endedAt && call.status === "in_progress") {
    call.status = "completed";
    call.disposition = call.disposition || "success";
    call.endedAt = new Date().toISOString();
  }

  return saveCall(call);
}

export function parseExotelWebhookParams(req) {
  return mergeParams(req.query || {}, req.body || {});
}
