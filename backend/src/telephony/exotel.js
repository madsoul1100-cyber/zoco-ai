import { getLanguage, spokenForTts } from "../languages.js";
import { normalizePhone } from "../phone.js";
import { getTelephony } from "../store.js";

const DEFAULT_REGION = "mumbai";

function exotelBaseUrl(region = DEFAULT_REGION) {
  const configured = String(process.env.EXOTEL_REGION || region).toLowerCase();
  if (configured === "singapore") return "https://api.exotel.com";
  return "https://api.in.exotel.com";
}

export async function detectPublicUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  try {
    const response = await fetch("http://127.0.0.1:4040/api/tunnels");
    if (!response.ok) return "";
    const data = await response.json();
    const https = (data.tunnels || []).find((tunnel) => String(tunnel.public_url || "").startsWith("https://"));
    return https?.public_url?.replace(/\/$/, "") || "";
  } catch {
    return "";
  }
}

export async function resolveTelephony() {
  const stored = await getTelephony();
  const accountSid = process.env.EXOTEL_ACCOUNT_SID || stored.accountSid || "";
  const apiKey = process.env.EXOTEL_API_KEY || stored.apiKey || "";
  const apiToken = process.env.EXOTEL_API_TOKEN || stored.apiToken || stored.authToken || "";
  const fromNumber = normalizePhone(process.env.EXOTEL_EXOPHONE || stored.fromNumber || "");
  const detected = await detectPublicUrl();
  const publicBaseUrl = (
    detected ||
    process.env.PUBLIC_BASE_URL ||
    stored.publicBaseUrl ||
    ""
  ).replace(/\/$/, "");
  const exotelReady = Boolean(accountSid && apiKey && apiToken && fromNumber && publicBaseUrl);
  return {
    ...stored,
    provider: exotelReady ? "exotel" : stored.provider || "browser",
    accountSid,
    apiKey,
    apiToken,
    fromNumber,
    publicBaseUrl,
    exotelReady,
    // Legacy UI field — maps to Exotel readiness.
    twilioReady: exotelReady,
    region: process.env.EXOTEL_REGION || stored.region || DEFAULT_REGION,
  };
}

export function publicTelephony(config) {
  return {
    workspaceName: config.workspaceName || "",
    workspacePhone: config.workspacePhone || "",
    provider: config.provider || "browser",
    fromNumber: config.fromNumber || "",
    publicBaseUrl: config.publicBaseUrl || "",
    accountSid: config.accountSid || "",
    apiKeySet: Boolean(config.apiKey),
    apiTokenSet: Boolean(config.apiToken),
    authTokenSet: Boolean(config.apiToken || config.authToken),
    exotelReady: Boolean(config.exotelReady),
    twilioReady: Boolean(config.exotelReady),
    updatedAt: config.updatedAt || null,
  };
}

function exotelAuth(tel) {
  return `Basic ${Buffer.from(`${tel.apiKey}:${tel.apiToken}`).toString("base64")}`;
}

function exophoneForCallerId(fromNumber) {
  const digits = String(fromNumber || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("91") && digits.length === 12) return `0${digits.slice(2)}`;
  if (digits.length === 10) return `0${digits}`;
  return digits.startsWith("0") ? digits : `0${digits}`;
}

export function exotelStreamUrl(tel, callId, sampleRate = 16000) {
  const base = String(tel.publicBaseUrl || "").replace(/^http:/, "https:");
  const wsBase = base.replace(/^https:/, "wss:").replace(/^http:/, "ws:");
  return `${wsBase}/api/exotel/stream?callId=${encodeURIComponent(callId)}&sample-rate=${sampleRate}`;
}

export function exotelStatusCallbackUrl(tel, callId) {
  return `${tel.publicBaseUrl}/webhooks/exotel/status?callId=${encodeURIComponent(callId)}`;
}

async function exotelJson(url, { tel, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: exotelAuth(tel),
      ...(body instanceof URLSearchParams
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : body
          ? { "Content-Type": "application/json" }
          : {}),
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error || data.RestException?.Message || `Exotel request failed (${response.status})`);
  }
  return data;
}

export async function placeExotelCall({ call, tel, sampleRate = 16000 }) {
  const to = normalizePhone(call.customer?.phone);
  if (!to) throw new Error("Customer phone is missing");
  const callerId = exophoneForCallerId(tel.fromNumber);
  if (!callerId) throw new Error("Exotel Exophone (caller ID) is missing");

  const url = `${exotelBaseUrl(tel.region)}/v1/Accounts/${tel.accountSid}/Calls/connect.json`;
  const body = new URLSearchParams({
    from: to,
    callerid: callerId,
    streamurl: exotelStreamUrl(tel, call.id, sampleRate),
    streamtype: "bidirectional",
    record: "true",
    customfield: String(call.id).slice(0, 128),
    statuscallback: exotelStatusCallbackUrl(tel, call.id),
  });
  body.append("statuscallbackevents", "terminal");
  body.append("statuscallbackevents", "answered");

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: exotelAuth(tel),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.RestException?.Message || JSON.stringify(data).slice(0, 240));
  }
  const sid = data?.Call?.Sid || data?.call?.sid || data?.Sid || "";
  return { sid, raw: data };
}

export function mapExotelStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "queued") return { status: "queued", disposition: "in_progress" };
  if (value === "ringing") return { status: "ringing", disposition: "in_progress" };
  if (value === "in-progress" || value === "answered") return { status: "in_progress", disposition: "in_progress" };
  if (value === "busy") return { status: "busy", disposition: "busy" };
  if (value === "no-answer" || value === "no_answer") return { status: "no_answer", disposition: "no_answer" };
  if (value === "failed") return { status: "failed", disposition: "failed" };
  if (value === "completed") return { status: "completed", disposition: null };
  return null;
}

export async function inboundLineStatus(tel) {
  const expectedUrl = tel.publicBaseUrl
    ? `${tel.publicBaseUrl}/webhooks/exotel/inbound`
    : "";
  return {
    expectedUrl,
    wired: Boolean(tel.exotelReady),
    publicReachable: Boolean(tel.publicBaseUrl),
    exotelReady: Boolean(tel.exotelReady),
    fromNumber: tel.fromNumber || "",
    error: tel.exotelReady
      ? null
      : "Connect Exotel API key, token, Exophone, and a public HTTPS URL.",
  };
}

export async function syncInboundWebhook(_tel) {
  return {
    wired: false,
    error: "Inbound Exotel calls are configured in the Exotel dashboard (VoiceBot applet → your stream URL).",
  };
}

export function inboundWebhookUrl(tel) {
  return tel.publicBaseUrl ? `${tel.publicBaseUrl}/webhooks/exotel/inbound` : "";
}

/** SMS OTP is not wired for Exotel in this build. */
export async function sendSms() {
  throw new Error("SMS login is not configured. Use Google sign-in or email.");
}

export async function sendVerifySms() {
  return null;
}

export async function checkVerifySms() {
  return false;
}

/** Exotel voice-only integration — WhatsApp is not enabled here. */
export async function sendWhatsApp() {
  throw new Error("WhatsApp is not configured. Use Exotel for voice calling only.");
}

export function whatsappFromNumber(from) {
  return normalizePhone(String(from || "").replace(/^whatsapp:/i, ""));
}

export function hangupTwiml({ say, language = "en-IN" }) {
  const voice = getLanguage(language);
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="${voice.sayLanguage}">${spokenForTts(say || "")}</Say><Hangup/></Response>`;
}

export function gatherTwiml() {
  return hangupTwiml({ say: "This line uses Exotel streaming. Please update the call flow." });
}

export function recordListenTwiml() {
  return gatherTwiml();
}

export function transferTwiml() {
  return hangupTwiml({ say: "Transfer is not available on this Exotel stream yet." });
}
