export type TurnReply = {
  text: string;
  endCall?: boolean;
  disposition?: string | null;
  transfer?: string | null;
  provider?: string | null;
  model?: string | null;
};

export type ToolReply = {
  ok: boolean;
  result?: string;
  endCall?: boolean;
  disposition?: string | null;
  transfer?: string | null;
  say?: string;
  duplicate?: boolean;
};

export type SessionSnapshot = {
  callId: string;
  greeting: string;
  instructions?: string;
  knowledge?: string;
  language: string;
  agent: {
    id: string;
    name: string;
    language: string;
    ttsVoice?: string;
    ttsModel?: string;
    ttsProvider?: string;
    transferNumber?: string;
    callSettings?: Record<string, unknown>;
    voiceRuntime?: string;
    gender?: "male" | "female" | string;
    customTools?: Array<{ id?: string; name: string; description?: string }>;
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

function isPlaceholder(value: string) {
  const raw = String(value || "").trim();
  return !raw || raw === "..." || /^<.*>$/.test(raw);
}

function resolvedBridgeToken() {
  const raw = String(process.env.LIVEKIT_BRIDGE_TOKEN || "").trim();
  if (!isPlaceholder(raw)) return raw;
  const secret = String(process.env.LIVEKIT_API_SECRET || "").trim();
  if (!secret) throw new Error("LIVEKIT_BRIDGE_TOKEN is not configured");
  return `zoco-${secret.slice(0, 24)}`;
}

function bridgeConfig() {
  const baseUrl = String(process.env.ZOCO_BRIDGE_URL || process.env.PUBLIC_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
  const token = resolvedBridgeToken();
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

export async function postTool(callId: string, payload: {
  eventId: string;
  name: string;
  args?: Record<string, unknown>;
}): Promise<ToolReply> {
  const { baseUrl, token } = bridgeConfig();
  const response = await fetch(`${baseUrl}/api/livekit/sessions/${encodeURIComponent(callId)}/tools`, {
    method: "POST",
    headers: headers(token),
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Tool failed (${response.status})`);
  }
  return data as ToolReply;
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
