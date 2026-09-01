import { AccessToken, AgentDispatchClient, RoomServiceClient, SipClient } from "livekit-server-sdk";
import { normalizePhone } from "../phone.js";
import { resolveTelephony } from "../telephony/index.js";

function isPlaceholder(value) {
  const raw = String(value || "").trim();
  return !raw || raw === "..." || /^<.*>$/.test(raw);
}

export function livekitConfig() {
  const url = String(process.env.LIVEKIT_URL || "").replace(/\/$/, "");
  const apiKey = String(process.env.LIVEKIT_API_KEY || "").trim();
  const apiSecret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  const outboundTrunkId = isPlaceholder(process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID)
    ? ""
    : String(process.env.LIVEKIT_SIP_OUTBOUND_TRUNK_ID || "").trim();
  const agentName = String(process.env.LIVEKIT_AGENT_NAME || "zoco-voice").trim();
  const bridgeToken = resolvedBridgeToken();
  return { url, apiKey, apiSecret, outboundTrunkId, agentName, bridgeToken };
}

export function resolvedBridgeToken() {
  const raw = String(process.env.LIVEKIT_BRIDGE_TOKEN || "").trim();
  if (!isPlaceholder(raw)) return raw;
  const secret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  return secret ? `zoco-${secret.slice(0, 24)}` : "";
}

export function livekitConfigured() {
  const cfg = livekitConfig();
  return Boolean(cfg.url && cfg.apiKey && cfg.apiSecret);
}

export function livekitSipReady() {
  return livekitConfigured() && Boolean(livekitConfig().outboundTrunkId);
}

export function livekitReady() {
  const cfg = livekitConfig();
  return livekitConfigured() && Boolean(cfg.bridgeToken);
}

export function livekitEnabled() {
  const raw = String(process.env.LIVEKIT_ENABLED || "").trim().toLowerCase();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  if (raw === "true" || raw === "1" || raw === "on") return livekitReady();
  const pilot = String(process.env.LIVEKIT_PILOT_ENABLED || "").trim().toLowerCase();
  if (pilot === "false" || pilot === "0" || pilot === "off") return false;
  return livekitReady();
}

export function pilotEnabled() {
  return livekitEnabled();
}

export function pilotAgentId() {
  return String(process.env.LIVEKIT_PILOT_AGENT_ID || "agt_priya_mlc_outbound").trim();
}

export function livekitPilotOnly() {
  return String(process.env.LIVEKIT_PILOT_ONLY || "").trim().toLowerCase() === "true";
}

export function isPilotAgent(agentId) {
  return String(agentId || "").trim() === pilotAgentId();
}

export function usesLiveKitVoice(agentId) {
  if (!livekitEnabled()) return false;
  if (livekitPilotOnly()) return isPilotAgent(agentId);
  return true;
}

export function normalizeVoiceRuntime(value) {
  const raw = String(value || "").toLowerCase().trim();
  if (raw === "personalized" || raw === "sarvam" || raw === "zoco") return "personalized";
  if (raw === "pipecat") return "pipecat";
  if (raw === "livekit") return "livekit";
  return "";
}

export function persistVoiceRuntime(value, fallback = "livekit") {
  return normalizeVoiceRuntime(value) || fallback;
}

export function agentVoiceRuntime(agent = {}) {
  const chosen = normalizeVoiceRuntime(agent.voiceRuntime);
  if (chosen) return chosen;
  return usesLiveKitVoice(agent.id) ? "livekit" : "personalized";
}

export function agentUsesLiveKit(agent = {}) {
  return livekitEnabled() && agentVoiceRuntime(agent) === "livekit";
}

export function livekitInferenceUrl() {
  const override = String(process.env.LIVEKIT_INFERENCE_URL || "").replace(/\/$/, "");
  if (override) return override;
  const url = String(livekitConfig().url || "");
  if (url.includes(".staging.livekit.cloud")) {
    return "https://agent-gateway.staging.livekit.cloud/v1";
  }
  return "https://agent-gateway.livekit.cloud/v1";
}

export async function livekitInferenceLlm() {
  const cfg = livekitConfig();
  if (!cfg.apiKey || !cfg.apiSecret) return null;
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, { identity: "zoco-chat", ttl: 600 });
  token.addInferenceGrant({ perform: true });
  return {
    provider: "livekit",
    label: "LiveKit Inference",
    apiKey: await token.toJwt(),
    baseUrl: livekitInferenceUrl(),
    model: String(process.env.LIVEKIT_LLM_MODEL || "google/gemma-4-31b-it").trim(),
    headerStyle: "livekit",
  };
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
  return String(wsUrl || "").replace(/^wss:/, "https:").replace(/^ws:/, "http:");
}

async function ensureRoom(roomName, metadata) {
  const cfg = livekitConfig();
  const rooms = new RoomServiceClient(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret);
  try {
    await rooms.createRoom({
      name: roomName,
      emptyTimeout: 300,
      maxParticipants: 8,
      metadata: typeof metadata === "string" ? metadata : JSON.stringify(metadata || {}),
    });
  } catch (error) {
    const message = String(error?.message || error);
    if (!/already exists|conflict/i.test(message)) throw error;
  }
  return rooms;
}

async function dispatchAgent(roomName, metadata) {
  const cfg = livekitConfig();
  const dispatch = new AgentDispatchClient(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret);
  return dispatch.createDispatch(roomName, cfg.agentName, {
    metadata: typeof metadata === "string" ? metadata : JSON.stringify(metadata || {}),
  });
}

export async function createJoinToken({ roomName, identity, name, metadata, canPublish = true }) {
  const cfg = livekitConfig();
  if (!livekitConfigured()) {
    throw new Error("LiveKit is not configured. Set LIVEKIT_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET.");
  }
  const token = new AccessToken(cfg.apiKey, cfg.apiSecret, {
    identity,
    name: name || identity,
    metadata: typeof metadata === "string" ? metadata : JSON.stringify(metadata || {}),
    ttl: "2h",
  });
  token.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish,
    canSubscribe: true,
    canPublishData: true,
  });
  if (token.roomConfig !== undefined) {
    token.roomConfig = {
      agents: [{ agentName: cfg.agentName, metadata: typeof metadata === "string" ? metadata : JSON.stringify(metadata || {}) }],
    };
  }
  return token.toJwt();
}

export async function startLiveKitWebSession(call, agent) {
  if (!livekitReady()) {
    throw new Error("LiveKit is not ready. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and start the voice worker.");
  }
  const roomName = roomNameForCall(call.id);
  const metadata = { callId: call.id, agentId: agent.id, channel: "web" };
  await ensureRoom(roomName, metadata);
  await dispatchAgent(roomName, metadata);
  const token = await createJoinToken({
    roomName,
    identity: `user-${call.id}`,
    name: call.customer?.name || "Caller",
    metadata,
  });
  return {
    url: livekitConfig().url,
    token,
    roomName,
    agentName: livekitConfig().agentName,
    runtime: "livekit",
  };
}

export async function dispatchLiveKitOutboundCall(call, agent) {
  const cfg = livekitConfig();
  if (!livekitSipReady()) {
    throw new Error("LiveKit SIP is not configured. Set LIVEKIT_SIP_OUTBOUND_TRUNK_ID.");
  }
  if (!livekitReady()) {
    throw new Error("LiveKit is not ready. Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET.");
  }

  const phone = normalizePhone(call.customer?.phone);
  if (!phone) throw new Error("Customer phone is missing");

  const tel = await resolveTelephony();
  const roomName = roomNameForCall(call.id);
  const metadata = { callId: call.id, agentId: agent.id, phone, channel: "telephony" };

  await ensureRoom(roomName, metadata);
  await dispatchAgent(roomName, metadata);

  const sip = new SipClient(livekitHttpUrl(cfg.url), cfg.apiKey, cfg.apiSecret);
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
    enabled: livekitEnabled(),
    ready: livekitReady(),
    configured: livekitConfigured(),
    sipReady: livekitSipReady(),
    agentName: cfg.agentName,
    url: cfg.url || "",
    pilotEnabled: livekitEnabled(),
    pilotAgentId: pilotAgentId() || null,
  };
}
