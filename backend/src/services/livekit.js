import { AccessToken, AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import { normalizePhone } from "../phone.js";
import { resolveTelephony } from "../telephony/index.js";

export function pilotEnabled() {
  return String(process.env.LIVEKIT_PILOT_ENABLED || "").toLowerCase() === "true";
}

export function pilotAgentId() {
  return String(process.env.LIVEKIT_PILOT_AGENT_ID || "agt_priya_mlc_outbound").trim();
}

export function isPilotAgent(agentId) {
  return pilotEnabled() && String(agentId || "").trim() === pilotAgentId();
}

export function livekitConfig() {
  const url = String(process.env.LIVEKIT_URL || "").replace(/\/$/, "");
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  const outboundTrunkId = String(process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID || "").trim();
  const agentName = String(process.env.LIVEKIT_AGENT_NAME || "zoco-priya-pilot").trim();
  const bridgeToken = String(process.env.LIVEKIT_BRIDGE_TOKEN || "").trim();
  return { url, apiKey, apiSecret, outboundTrunkId, agentName, bridgeToken };
}

export function livekitReady() {
  const cfg = livekitConfig();
  return Boolean(cfg.url && cfg.apiKey && cfg.apiSecret && cfg.outboundTrunkId && cfg.bridgeToken);
}

export function bridgeAuthorized(req) {
  const cfg = livekitConfig();
  if (!cfg.bridgeToken) return false;
  const header = String(req.headers.authorization || "");
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = String(req.headers["x-livekit-bridge-token"] || "").trim();
  return bearer === cfg.bridgeToken || alt === cfg.bridgeToken;
}

export function roomNameForCall(callId) {
  return `zoco-${String(callId).replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

export function mapLiveKitDisconnect(reason) {
  const value = String(reason || "").toLowerCase();
  if (["completed", "success", "hangup", "client_initiated"].includes(value)) {
    return { status: "completed", disposition: "success", reason: value };
  }
  if (["no_answer", "no-answer", "unanswered"].includes(value)) {
    return { status: "no_answer", disposition: "no_answer", reason: value };
  }
  if (["busy", "user_busy"].includes(value)) {
    return { status: "busy", disposition: "busy", reason: value };
  }
  if (["voicemail", "machine", "amd"].includes(value)) {
    return { status: "voicemail", disposition: "voicemail", reason: value };
  }
  if (["failed", "error", "sip_trunk_failure"].includes(value)) {
    return { status: "failed", disposition: "failed", reason: value };
  }
  if (["dropped", "room_disconnected", "room_deleted", "client_disconnected"].includes(value)) {
    return { status: "dropped", disposition: "dropped", reason: value };
  }
  if (value === "in_progress") {
    return { status: "in_progress", disposition: "in_progress", reason: value };
  }
  return { status: "completed", disposition: null, reason: value || "completed" };
}

function livekitHttpUrl(wsUrl) {
  return wsUrl.replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

export async function dispatchLiveKitOutboundCall(call, agent) {
  const cfg = livekitConfig();
  if (!livekitReady()) {
    throw new Error("LiveKit pilot is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_SIP_OUTBOUND_TRUNK_ID, and LIVEKIT_BRIDGE_TOKEN.");
  }

  const phone = normalizePhone(call.customer?.phone);
  if (!phone) throw new Error("Customer phone is missing");

  const tel = await resolveTelephony();
  const roomName = roomNameForCall(call.id);
  const httpUrl = livekitHttpUrl(cfg.url);

  const rooms = new RoomServiceClient(httpUrl, cfg.apiKey, cfg.apiSecret);
  await rooms.createRoom({
    name: roomName,
    emptyTimeout: 120,
    maxParticipants: 4,
    metadata: JSON.stringify({ callId: call.id, agentId: agent.id }),
  });

  const dispatch = new AgentDispatchClient(httpUrl, cfg.apiKey, cfg.apiSecret);
  await dispatch.createDispatch(roomName, cfg.agentName, {
    metadata: JSON.stringify({ callId: call.id, phone, agentId: agent.id }),
  });

  const sip = new SipClient(httpUrl, cfg.apiKey, cfg.apiSecret);
  const participant = await sip.createSipParticipant(cfg.outboundTrunkId, phone, roomName, {
    participantIdentity: `caller-${call.id}`,
    participantName: call.customer?.name || phone,
    waitUntilAnswered: true,
    playDialtone: false,
    hidePhoneNumber: false,
    krispEnabled: true,
    fromNumber: tel.fromNumber || undefined,
  });

  return {
    roomName,
    participantId: participant.participantId || participant.participantIdentity || "",
    sipCallId: participant.sipCallId || "",
    runtime: "livekit",
  };
}

export function createWorkerToken(roomName, identity = "zoco-bridge") {
  const cfg = livekitConfig();
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity });
  token.addGrant({ roomJoin: true, room: roomName, canPublish: false, canSubscribe: true });
  return token.toJwt();
}

export function publicLiveKitStatus() {
  const cfg = livekitConfig();
  return {
    pilotEnabled: pilotEnabled(),
    pilotAgentId: pilotAgentId(),
    ready: livekitReady(),
    agentName: cfg.agentName,
    configured: Boolean(cfg.url && cfg.apiKey && cfg.apiSecret),
  };
}
