import { normalizePhone } from "../phone.js";
import { normalizeVoiceRuntime } from "./livekit.js";
import {
  PipecatCloudError,
  pipecatCloudConfig,
  pipecatCloudConfigured,
  pipecatCloudPrivateReady,
  publicPipecatCloudStatus,
  startSession,
  stopSession,
} from "./pipecatCloud.js";

function isPlaceholder(value) {
  const raw = String(value || "").trim();
  return !raw || raw === "..." || /^<.*>$/.test(raw);
}

export function pipecatConfig() {
  const explicitUrl = String(process.env.PIPECAT_URL || process.env.PIPECAT_PUBLIC_URL || "").replace(/\/$/, "");
  const url = explicitUrl || "http://127.0.0.1:7860";
  const publicUrl = String(process.env.PIPECAT_PUBLIC_URL || url).replace(/\/$/, "");
  const transport = String(process.env.PIPECAT_TRANSPORT || "webrtc").trim().toLowerCase() === "daily"
    ? "daily"
    : "webrtc";
  const dailyApiKey = isPlaceholder(process.env.DAILY_API_KEY) ? "" : String(process.env.DAILY_API_KEY || "").trim();
  const fromNumber = isPlaceholder(process.env.PIPECAT_FROM_NUMBER)
    ? ""
    : String(process.env.PIPECAT_FROM_NUMBER || process.env.DAILY_PHONE_NUMBER || "").trim();
  const cloud = pipecatCloudConfig();
  return {
    url,
    publicUrl,
    transport: pipecatCloudConfigured() ? "daily" : transport,
    dailyApiKey,
    fromNumber,
    bridgeToken: resolvedPipecatBridgeToken(),
    explicitUrl,
    mode: pipecatMode(),
    agentName: cloud.agentName,
  };
}

export function resolvedPipecatBridgeToken() {
  const raw = String(process.env.PIPECAT_BRIDGE_TOKEN || process.env.LIVEKIT_BRIDGE_TOKEN || "").trim();
  if (!isPlaceholder(raw)) return raw;
  const secret = String(process.env.LIVEKIT_API_SECRET || process.env.PIPECAT_API_SECRET || "").trim();
  return secret ? `zoco-${secret.slice(0, 24)}` : "";
}

export function pipecatMode() {
  if (pipecatCloudConfigured()) return "cloud";
  if (pipecatLocalConfigured()) return "local";
  return "off";
}

function enabledFlag() {
  return String(process.env.PIPECAT_ENABLED || "").trim().toLowerCase();
}

function pipecatLocalConfigured() {
  const enabled = enabledFlag();
  if (enabled === "true" || enabled === "1" || enabled === "on") return true;
  return Boolean(String(process.env.PIPECAT_URL || process.env.PIPECAT_PUBLIC_URL || "").replace(/\/$/, ""));
}

export function pipecatConfigured() {
  return pipecatCloudConfigured() || pipecatLocalConfigured();
}

export function pipecatReady() {
  return pipecatConfigured() && Boolean(pipecatConfig().bridgeToken);
}

export function pipecatEnabled() {
  const raw = enabledFlag();
  if (raw === "false" || raw === "0" || raw === "off") return false;
  return pipecatReady();
}

export function pipecatDialReady() {
  if (!pipecatEnabled()) return false;
  if (pipecatCloudConfigured()) return true;
  return Boolean(pipecatConfig().dailyApiKey);
}

export function agentUsesPipecat(agent = {}) {
  return pipecatEnabled() && normalizeVoiceRuntime(agent.voiceRuntime) === "pipecat";
}

export function pipecatBridgeAuthorized(req) {
  const cfg = pipecatConfig();
  if (!cfg.bridgeToken) return false;
  const header = String(req.headers.authorization || "");
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const alt = String(req.headers["x-pipecat-bridge-token"] || req.headers["x-livekit-bridge-token"] || "").trim();
  return bearer === cfg.bridgeToken || alt === cfg.bridgeToken;
}

function bridgeUrl() {
  const raw = String(process.env.ZOCO_BRIDGE_URL || process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return raw || undefined;
}

export function pipecatSessionBody(call, agent, extras = {}) {
  return {
    callId: call.id,
    agentId: agent.id,
    channel: extras.channel || "web",
    ...(extras.phone ? { phone: extras.phone } : {}),
    ...(extras.fromNumber ? { fromNumber: extras.fromNumber } : {}),
    ...(bridgeUrl() ? { bridgeUrl: bridgeUrl() } : {}),
  };
}

function notReadyError() {
  if (pipecatCloudConfigured()) {
    return new Error("Pipecat Cloud is not ready. Set PIPECAT_CLOUD_PUBLIC_KEY and a bridge token.");
  }
  return new Error("Pipecat is not ready. Set PIPECAT_CLOUD_PUBLIC_KEY (Cloud) or PIPECAT_URL and run `npm run dev:pipecat`.");
}

function cloudServiceMissing(error) {
  const code = String(error?.code || "").toUpperCase();
  const message = String(error?.message || "").toLowerCase();
  return error?.status === 404
    || code === "404"
    || code === "NOT_FOUND"
    || message.includes("service not found");
}

function localWebSession(call, agent) {
  const cfg = pipecatConfig();
  const transport = String(process.env.PIPECAT_TRANSPORT || "webrtc").trim().toLowerCase() === "daily"
    ? "daily"
    : "webrtc";
  return {
    mode: "local",
    runtime: "pipecat",
    url: cfg.publicUrl,
    startUrl: `${cfg.publicUrl}/start`,
    transport,
    callId: call.id,
    agentId: agent.id,
    enableDefaultIceServers: true,
  };
}

export async function startPipecatWebSession(call, agent) {
  if (!pipecatReady()) throw notReadyError();

  if (pipecatCloudConfigured()) {
    try {
      const data = await startSession(pipecatCloudConfig().agentName, {
        createDailyRoom: true,
        enableDefaultIceServers: true,
        transport: "daily",
        body: pipecatSessionBody(call, agent, { channel: "web" }),
      });
      return {
        mode: "cloud",
        runtime: "pipecat",
        transport: "daily",
        callId: call.id,
        agentId: agent.id,
        sessionId: data.sessionId || data.session_id || "",
        dailyRoom: data.dailyRoom || data.room_url || "",
        dailyToken: data.dailyToken || data.token || "",
        iceConfig: data.iceConfig || null,
      };
    } catch (error) {
      if (cloudServiceMissing(error) && pipecatLocalConfigured()) {
        return localWebSession(call, agent);
      }
      if (cloudServiceMissing(error)) {
        throw new Error(
          `Pipecat Cloud agent "${pipecatCloudConfig().agentName}" was not found. Deploy that agent, or set PIPECAT_URL and run \`npm run dev:pipecat\`.`
        );
      }
      throw error;
    }
  }

  return localWebSession(call, agent);
}

export async function dispatchPipecatOutboundCall(call, agent) {
  if (!pipecatDialReady()) {
    throw new Error(
      pipecatCloudConfigured()
        ? "Pipecat Cloud dial-out is not ready."
        : "Pipecat Daily dial-out is not configured. Set DAILY_API_KEY (and optionally PIPECAT_FROM_NUMBER)."
    );
  }
  if (!pipecatReady()) throw notReadyError();

  const phone = normalizePhone(call.customer?.phone);
  if (!phone) throw new Error("Customer phone is missing");
  const cfg = pipecatConfig();
  const body = pipecatSessionBody(call, agent, {
    channel: "telephony",
    phone,
    fromNumber: cfg.fromNumber,
  });

  if (pipecatCloudConfigured()) {
    try {
      const data = await startSession(pipecatCloudConfig().agentName, {
        createDailyRoom: true,
        enableDefaultIceServers: true,
        transport: "daily",
        dailyRoomProperties: { enable_dialout: true },
        body,
      });
      return {
        runtime: "pipecat",
        mode: "cloud",
        sessionId: data.sessionId || data.session_id || "",
        roomUrl: data.dailyRoom || data.room_url || "",
        phone,
      };
    } catch (error) {
      if (!cloudServiceMissing(error) || !pipecatLocalConfigured()) throw error;
    }
  }

  const response = await fetch(`${cfg.url}/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      transport: "daily",
      createDailyRoom: true,
      body,
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || `Pipecat start failed (${response.status})`);
  }

  return {
    runtime: "pipecat",
    mode: "local",
    sessionId: data.sessionId || data.session_id || "",
    roomUrl: data.dailyRoom || data.room_url || "",
    phone,
  };
}

export async function stopPipecatSession(call) {
  const sessionId = String(call?.pipecat?.sessionId || "").trim();
  if (!sessionId) return { ok: true, skipped: true };
  if (!pipecatCloudPrivateReady()) return { ok: true, skipped: true, reason: "private_key" };
  try {
    const result = await stopSession(pipecatCloudConfig().agentName, sessionId);
    return result && typeof result === "object" ? { ok: true, ...result } : { ok: true };
  } catch (error) {
    if (error.status === 404) return { ok: true, skipped: true };
    throw error;
  }
}

export function publicPipecatStatus() {
  const cfg = pipecatConfig();
  const cloud = publicPipecatCloudStatus();
  return {
    enabled: pipecatEnabled(),
    ready: pipecatReady(),
    configured: pipecatConfigured(),
    dialReady: pipecatDialReady(),
    mode: cfg.mode,
    transport: cfg.transport,
    url: cfg.mode === "local" && pipecatConfigured() ? (cfg.publicUrl || "") : "",
    agentName: cfg.agentName,
    cloud,
  };
}
