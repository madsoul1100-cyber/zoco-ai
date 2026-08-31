import { v4 as uuid } from "uuid";
import { streamReply } from "../engine/conversation.js";
import { applyOutcome } from "../engine/rules.js";
import { renderGreeting } from "../engine/template.js";
import { resolveLlmConfig } from "../engine/providers.js";
import { scheduleFollowUp } from "../services/calling.js";
import { attachTurn } from "../services/calling.js";
import {
  getAiSettings,
  getCall,
  getCallAgent,
  getRules,
  saveCall,
} from "../store.js";
import { mapLiveKitDisconnect, pilotAgentId, pilotEnabled } from "../services/livekit.js";

const processedEvents = new Map();
const EVENT_TTL_MS = 6 * 60 * 60 * 1000;

function pruneEvents() {
  const cutoff = Date.now() - EVENT_TTL_MS;
  for (const [key, at] of processedEvents.entries()) {
    if (at < cutoff) processedEvents.delete(key);
  }
}

export function rememberEvent(eventId) {
  pruneEvents();
  const id = String(eventId || "").trim();
  if (!id) return false;
  if (processedEvents.has(id)) return true;
  processedEvents.set(id, Date.now());
  return false;
}

export async function buildSessionSnapshot(callId) {
  const call = await getCall(callId);
  if (!call) throw new Error("Call not found");
  const agent = await getCallAgent(call);
  if (!agent) throw new Error("Agent not found");
  const settings = await getAiSettings();
  const llm = resolveLlmConfig(agent, settings);
  const greeting = renderGreeting(agent, call.customer) || agent.greeting || "";
  return {
    callId: call.id,
    greeting,
    language: call.language || agent.language || "te-IN",
    agent: {
      id: agent.id,
      name: agent.name,
      language: agent.language,
      ttsVoice: agent.ttsVoice,
      ttsModel: agent.ttsModel,
      ttsProvider: agent.ttsProvider,
      callSettings: agent.callSettings || {},
    },
    llm: llm
      ? {
          provider: llm.provider,
          model: llm.model,
          baseUrl: llm.baseUrl,
          apiKey: llm.apiKey,
        }
      : null,
    customer: call.customer || {},
    runtime: call.runtime || null,
    pilot: pilotEnabled() && call.agentId === pilotAgentId(),
  };
}

export async function handleSessionTurn(callId, { eventId, userText, sttLanguage }) {
  if (rememberEvent(eventId)) {
    const call = await getCall(callId);
    const lastAssistant = [...(call?.messages || [])].reverse().find((m) => m.role === "assistant");
    return {
      text: lastAssistant?.text || "",
      endCall: false,
      disposition: null,
      duplicate: true,
    };
  }

  const call = await getCall(callId);
  if (!call) throw new Error("Call not found");
  const agent = await getCallAgent(call);
  if (!agent) throw new Error("Agent not found");

  if (sttLanguage && /^(te|hi|en)-IN$/.test(String(sttLanguage))) {
    call._sttLanguageHint = sttLanguage;
  }

  if (call.status !== "in_progress") {
    call.status = "in_progress";
    call.disposition = "in_progress";
    if (!call.startedAt) call.startedAt = new Date().toISOString();
  }

  const trimmed = String(userText || "").trim();
  const lastUser = [...(call.messages || [])].reverse().find((m) => m.role === "user");
  if (!lastUser || lastUser.text !== trimmed) {
    await attachTurn(
      call,
      {
        id: `msg_${uuid().slice(0, 8)}`,
        role: "user",
        text: trimmed,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
      },
      "livekit"
    );
  }

  const reply = await streamReply({
    agent,
    call,
    userText,
    onToken: () => {},
  });

  if (reply.slots && typeof reply.slots === "object") {
    call.gathered = { ...(call.gathered || {}), ...reply.slots };
  }

  await attachTurn(
    call,
    {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "assistant",
      text: reply.text || "",
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
      provider: reply.provider || null,
    },
    "livekit"
  );

  await saveCall(call);

  return {
    text: reply.text || "",
    endCall: Boolean(reply.endCall),
    disposition: reply.disposition || null,
    transfer: reply.transfer || null,
    provider: reply.provider || null,
    model: reply.model || null,
  };
}

export async function handleSessionEvent(callId, payload) {
  if (rememberEvent(payload.eventId)) {
    return { ok: true, duplicate: true };
  }

  const call = await getCall(callId);
  if (!call) throw new Error("Call not found");
  const rules = await getRules();

  if (payload.type === "transcript" && payload.text) {
    await attachTurn(
      call,
      {
        id: `msg_${uuid().slice(0, 8)}`,
        role: payload.role || "system",
        text: payload.text,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
      },
      "livekit"
    );
    await saveCall(call);
    return { ok: true };
  }

  if (payload.type === "metric") {
    call.telemetry = call.telemetry || { events: [] };
    call.telemetry.events.push({
      at: new Date().toISOString(),
      ...(payload.metrics || {}),
    });
    await saveCall(call);
    return { ok: true };
  }

  if (payload.type === "recording" && payload.recordingUrl) {
    call.recordingUrl = payload.recordingUrl;
    await saveCall(call);
    return { ok: true };
  }

  if (payload.type === "disposition") {
    const mapped = mapLiveKitDisconnect(payload.disposition || payload.reason || "completed");
    const next = applyOutcome(call, mapped, rules);
    await saveCall(next);
    await scheduleFollowUp(next);
    return { ok: true };
  }

  if (payload.type === "status") {
    const mapped = mapLiveKitDisconnect(payload.status || payload.reason || "in_progress");
    if (mapped.status === "in_progress") {
      call.status = "in_progress";
      call.disposition = "in_progress";
      if (!call.startedAt) call.startedAt = new Date().toISOString();
      await saveCall(call);
      return { ok: true };
    }
    const next = applyOutcome(call, mapped, rules);
    await saveCall(next);
    if (next.status !== "in_progress") await scheduleFollowUp(next);
    return { ok: true };
  }

  return { ok: true };
}
