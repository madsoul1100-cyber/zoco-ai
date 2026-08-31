export type TurnReply = {
  text: string;
  endCall?: boolean;
  disposition?: string | null;
  transfer?: string | null;
  provider?: string | null;
  model?: string | null;
};

export type SessionSnapshot = {
  callId: string;
  greeting: string;
  language: string;
  agent: {
    id: string;
    name: string;
    language: string;
    ttsVoice?: string;
    ttsModel?: string;
    ttsProvider?: string;
    callSettings?: Record<string, unknown>;
  };
  llm: {
    provider: string;
    model: string;
    baseUrl: string;
    apiKey: string;
  } | null;
  customer: { name?: string; phone?: string };
};

export type SessionEventPayload = {
  eventId: string;
  type: "transcript" | "status" | "metric" | "recording" | "disposition";
  role?: "user" | "assistant" | "system";
  text?: string;
  status?: string;
  disposition?: string;
  reason?: string;
  metrics?: Record<string, number | string>;
  recordingUrl?: string;
  duplicate?: boolean;
};

function bridgeConfig() {
  const baseUrl = String(process.env.ZOCO_BRIDGE_URL || process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const token = String(process.env.LIVEKIT_BRIDGE_TOKEN || "").trim();
  if (!token) throw new Error("LIVEKIT_BRIDGE_TOKEN is not configured");
  return { baseUrl, token };
}

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

export async function fetchSnapshot(callId: string): Promise<SessionSnapshot> {
  const { baseUrl, token } = bridgeConfig();
  const response = await fetch(`${baseUrl}/api/livekit/sessions/${encodeURIComponent(callId)}/snapshot`, {
    headers: headers(token),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Snapshot failed (${response.status})`);
  }
  return data as SessionSnapshot;
}

export async function postTurn(callId: string, payload: {
  eventId: string;
  userText: string;
  sttLanguage?: string | null;
}): Promise<TurnReply> {
  const { baseUrl, token } = bridgeConfig();
  const response = await fetch(`${baseUrl}/api/livekit/sessions/${encodeURIComponent(callId)}/turn`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Turn failed (${response.status})`);
  }
  return data as TurnReply;
}

export async function postEvent(callId: string, payload: SessionEventPayload): Promise<{ ok: boolean; duplicate?: boolean }> {
  const { baseUrl, token } = bridgeConfig();
  const response = await fetch(`${baseUrl}/api/livekit/sessions/${encodeURIComponent(callId)}/events`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Event failed (${response.status})`);
  }
  return data as { ok: boolean; duplicate?: boolean };
}
