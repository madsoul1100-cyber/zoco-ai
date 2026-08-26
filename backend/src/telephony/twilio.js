import { getLanguage, spokenForTts } from "../languages.js";
import { normalizePhone } from "../phone.js";
import { getTelephony } from "../store.js";

function xmlEscape(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function detectPublicUrl() {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, "");
  try {
    const response = await fetch("44.205.191.134:4040/api/tunnels");
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
  const accountSid = process.env.TWILIO_ACCOUNT_SID || stored.accountSid || "";
  const authToken = process.env.TWILIO_AUTH_TOKEN || stored.authToken || "";
  const fromNumber = normalizePhone(process.env.TWILIO_FROM_NUMBER || stored.fromNumber || "");
  const detected = await detectPublicUrl();
  const publicBaseUrl = (
    detected ||
    process.env.PUBLIC_BASE_URL ||
    stored.publicBaseUrl ||
    ""
  ).replace(/\/$/, "");
  const twilioReady = Boolean(accountSid && authToken && fromNumber && publicBaseUrl);
  return {
    ...stored,
    accountSid,
    authToken,
    fromNumber,
    publicBaseUrl,
    twilioReady,
    provider: twilioReady ? "twilio" : stored.provider || "browser",
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
    authTokenSet: Boolean(config.authToken),
    twilioReady: Boolean(config.twilioReady),
    updatedAt: config.updatedAt || null,
  };
}

function twilioAuth(tel) {
  return `Basic ${Buffer.from(`${tel.accountSid}:${tel.authToken}`).toString("base64")}`;
}

export async function sendSms({ tel, to, body }) {
  if (!tel?.accountSid || !tel?.authToken || !tel?.fromNumber) {
    throw new Error("Twilio SMS is not connected");
  }
  const data = await twilioJson(
    `https://api.twilio.com/2010-04-01/Accounts/${tel.accountSid}/Messages.json`,
    {
      tel,
      method: "POST",
      body: new URLSearchParams({ To: to, From: tel.fromNumber, Body: body }),
    }
  );
  return data;
}

export async function sendVerifySms(tel, to) {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid) return null;
  const response = await fetch(`https://verify.twilio.com/v2/Services/${sid}/Verifications`, {
    method: "POST",
    headers: {
      Authorization: twilioAuth(tel),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, Channel: "sms" }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || "Could not send the verification SMS");
  return data;
}

export async function checkVerifySms(tel, to, code) {
  const sid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!sid) return null;
  const response = await fetch(`https://verify.twilio.com/v2/Services/${sid}/VerificationCheck`, {
    method: "POST",
    headers: {
      Authorization: twilioAuth(tel),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, Code: String(code || "") }),
  });
  const data = await response.json().catch(() => ({}));
  return data.status === "approved";
}

function sameUrl(left, right) {
  const a = String(left || "").replace(/\/$/, "");
  const b = String(right || "").replace(/\/$/, "");
  return Boolean(a && b && a === b);
}

let lineStatusCache = { key: "", at: 0, value: null };

function lineCacheKey(tel) {
  return `${tel.accountSid}|${tel.fromNumber}|${tel.publicBaseUrl}`;
}

function rememberLineStatus(tel, value) {
  lineStatusCache = { key: lineCacheKey(tel), at: Date.now(), value };
  return value;
}

export function inboundWebhookUrl(tel) {
  return tel.publicBaseUrl ? `${tel.publicBaseUrl}/webhooks/twilio/inbound` : "";
}

async function twilioJson(url, { tel, method = "GET", body } = {}) {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: twilioAuth(tel),
      ...(body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    body,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || data.error_message || `Twilio request failed (${response.status})`);
  }
  return data;
}

export async function findIncomingPhoneNumber(tel) {
  if (!tel.accountSid || !tel.authToken || !tel.fromNumber) return null;
  const data = await twilioJson(
    `https://api.twilio.com/2010-04-01/Accounts/${tel.accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(tel.fromNumber)}`,
    { tel }
  );
  return data.incoming_phone_numbers?.[0] || null;
}

export async function probePublicApi(tel) {
  const webhook = inboundWebhookUrl(tel);
  if (!webhook) return false;
  try {
    const response = await fetch(webhook, { method: "GET", signal: AbortSignal.timeout(5000) });
    const text = await response.text();
    return Boolean(response.ok && text.includes("<Response>"));
  } catch {
    return false;
  }
}

export async function syncInboundWebhook(tel) {
  if (!tel.twilioReady) {
    return { wired: false, error: "Connect Twilio and keep the public URL (ngrok) running first." };
  }
  const number = await findIncomingPhoneNumber(tel);
  if (!number?.sid) {
    return rememberLineStatus(tel, { wired: false, error: `Twilio does not have ${tel.fromNumber} on this account.` });
  }
  const voiceUrl = inboundWebhookUrl(tel);
  const statusUrl = `${tel.publicBaseUrl}/webhooks/twilio/status`;
  await twilioJson(
    `https://api.twilio.com/2010-04-01/Accounts/${tel.accountSid}/IncomingPhoneNumbers/${number.sid}.json`,
    {
      tel,
      method: "POST",
      body: new URLSearchParams({
        VoiceUrl: voiceUrl,
        VoiceMethod: "POST",
        StatusCallback: statusUrl,
        StatusCallbackMethod: "POST",
      }),
    }
  );
  lineStatusCache = { key: "", at: 0, value: null };
  return {
    wired: true,
    voiceUrl,
    twilioVoiceUrl: voiceUrl,
    numberSid: number.sid,
    phoneNumber: number.phone_number || tel.fromNumber,
    error: null,
  };
}

export async function inboundLineStatus(tel) {
  const cached = lineStatusCache.value;
  if (cached && lineStatusCache.key === lineCacheKey(tel) && Date.now() - lineStatusCache.at < 8000) {
    return cached;
  }
  const expectedUrl = inboundWebhookUrl(tel);
  const publicReachable = await probePublicApi(tel);
  const base = {
    expectedUrl,
    twilioVoiceUrl: "",
    wired: false,
    publicReachable,
    twilioReady: Boolean(tel.twilioReady),
    fromNumber: tel.fromNumber || "",
    numberSid: "",
    error: null,
  };
  if (!tel.twilioReady) return rememberLineStatus(tel, base);
  try {
    const number = await findIncomingPhoneNumber(tel);
    if (!number) {
      return rememberLineStatus(tel, { ...base, error: `Twilio does not have ${tel.fromNumber} on this account.` });
    }
    return rememberLineStatus(tel, {
      ...base,
      twilioVoiceUrl: number.voice_url || "",
      wired: sameUrl(number.voice_url, expectedUrl),
      numberSid: number.sid || "",
      fromNumber: number.phone_number || tel.fromNumber,
    });
  } catch (error) {
    return rememberLineStatus(tel, { ...base, error: error.message });
  }
}

function sayVoice(language = "en-IN") {
  const lang = getLanguage(language);
  return { language: lang.sayLanguage, voice: lang.sayVoice };
}

export function gatherTwiml({ say, actionUrl, language = "en-IN", audioUrl, recordingCallbackUrl, silenceTimeout = 6 }) {
  const lang = getLanguage(language);
  const voice = sayVoice(language);
  const timeout = Math.min(20, Math.max(3, Number(silenceTimeout) || 6));
  const prompt = audioUrl
    ? `<Play>${xmlEscape(audioUrl)}</Play>`
    : `<Say language="${voice.language}" voice="${voice.voice}">${xmlEscape(spokenForTts(say))}</Say>`;
  const start = recordingCallbackUrl
    ? `<Start><Recording recordingStatusCallback="${xmlEscape(recordingCallbackUrl)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" /></Start>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${start}
  <Gather input="speech" timeout="${timeout}" speechTimeout="auto" language="${xmlEscape(lang.gather)}" action="${xmlEscape(actionUrl)}" method="POST">
    ${prompt}
  </Gather>
  <Redirect method="POST">${xmlEscape(actionUrl)}</Redirect>
</Response>`;
}

export function recordListenTwiml({ say, actionUrl, language = "en-IN", audioUrl, recordingCallbackUrl, silenceTimeout = 6 }) {
  const voice = sayVoice(language);
  const timeout = Math.min(10, Math.max(2, Number(silenceTimeout) || 6));
  const prompt = audioUrl
    ? `<Play>${xmlEscape(audioUrl)}</Play>`
    : `<Say language="${voice.language}" voice="${voice.voice}">${xmlEscape(spokenForTts(say))}</Say>`;
  const start = recordingCallbackUrl
    ? `<Start><Recording recordingStatusCallback="${xmlEscape(recordingCallbackUrl)}" recordingStatusCallbackMethod="POST" recordingStatusCallbackEvent="completed" /></Start>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${start}
  ${prompt}
  <Record action="${xmlEscape(actionUrl)}" method="POST" maxLength="12" timeout="${timeout}" playBeep="false" transcribe="false" />
</Response>`;
}

export function transferTwiml({ say, language = "en-IN", audioUrl, toNumber, callerId }) {
  const voice = sayVoice(language);
  const prompt = audioUrl
    ? `<Play>${xmlEscape(audioUrl)}</Play>`
    : say
      ? `<Say language="${voice.language}" voice="${voice.voice}">${xmlEscape(spokenForTts(say))}</Say>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${prompt}
  <Dial callerId="${xmlEscape(callerId || "")}" timeout="30">
    <Number>${xmlEscape(toNumber)}</Number>
  </Dial>
  <Hangup/>
</Response>`;
}

export function hangupTwiml({ say, language = "en-IN", audioUrl }) {
  const voice = sayVoice(language);
  const prompt = audioUrl
    ? `<Play>${xmlEscape(audioUrl)}</Play>`
    : say
      ? `<Say language="${voice.language}" voice="${voice.voice}">${xmlEscape(spokenForTts(say))}</Say>`
      : "";
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  ${prompt}
  <Hangup/>
</Response>`;
}

export async function placeTwilioCall({ call, tel, detectVoicemail = false }) {
  const to = normalizePhone(call.customer?.phone);
  if (!to) throw new Error("Customer phone is missing");
  const voiceUrl = `${tel.publicBaseUrl}/webhooks/twilio/voice?callId=${encodeURIComponent(call.id)}`;
  const statusUrl = `${tel.publicBaseUrl}/webhooks/twilio/status?callId=${encodeURIComponent(call.id)}`;
  const body = new URLSearchParams({
    To: to,
    From: tel.fromNumber,
    Url: voiceUrl,
    Method: "POST",
    StatusCallback: statusUrl,
    StatusCallbackMethod: "POST",
    RecordingStatusCallback: `${tel.publicBaseUrl}/webhooks/twilio/recording?callId=${encodeURIComponent(call.id)}`,
    RecordingStatusCallbackMethod: "POST",
    Record: "true",
  });
  if (detectVoicemail) {
    body.set("MachineDetection", "Enable");
    body.set("AsyncAmd", "true");
    body.set("AsyncAmdStatusCallback", `${tel.publicBaseUrl}/webhooks/twilio/amd?callId=${encodeURIComponent(call.id)}`);
    body.set("AsyncAmdStatusCallbackMethod", "POST");
  }
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tel.accountSid}/Calls.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${tel.accountSid}:${tel.authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });
  const data = await response.json();
  if (!response.ok) {
    const detail = data.message || data.error_message || JSON.stringify(data);
    throw new Error(detail);
  }
  return data;
}

export async function redirectTwilioCall({ tel, callSid, url }) {
  if (!tel?.accountSid || !tel?.authToken || !callSid || !url) return null;
  return twilioJson(`https://api.twilio.com/2010-04-01/Accounts/${tel.accountSid}/Calls/${callSid}.json`, {
    tel,
    method: "POST",
    body: new URLSearchParams({ Url: url, Method: "POST" }),
  });
}

export function mapTwilioStatus(status) {
  const value = String(status || "").toLowerCase();
  if (value === "queued" || value === "initiated") return { status: "queued", disposition: "in_progress" };
  if (value === "ringing") return { status: "ringing", disposition: "in_progress" };
  if (value === "in-progress" || value === "answered") return { status: "in_progress", disposition: "in_progress" };
  if (value === "busy") return { status: "busy", disposition: "busy" };
  if (value === "no-answer") return { status: "no_answer", disposition: "no_answer" };
  if (value === "failed" || value === "canceled") return { status: "failed", disposition: "failed" };
  if (value === "completed") return { status: "completed", disposition: null };
  return null;
}

export async function sendWhatsApp({ tel, to, body }) {
  const dest = String(to || "").startsWith("whatsapp:") ? to : `whatsapp:${normalizePhone(to)}`;
  const from = process.env.TWILIO_WHATSAPP_FROM || `whatsapp:${tel.fromNumber}`;
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${tel.accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: twilioAuth(tel),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: dest, From: from, Body: body }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `WhatsApp send failed (${response.status})`);
  return data;
}

export function whatsappFromNumber(from) {
  return normalizePhone(String(from || "").replace(/^whatsapp:/i, ""));
}
