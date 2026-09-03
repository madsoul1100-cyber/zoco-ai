import { v4 as uuid } from "uuid";
import { liveKitInstructions, streamReply } from "../engine/conversation.js";
import { applyOutcome } from "../engine/rules.js";
import { renderGreeting } from "../engine/template.js";
import { resolveLlmConfig, speakerGender } from "../engine/providers.js";
import { runToolCall, toolName } from "../engine/tools.js";
import { scheduleFollowUp } from "../services/calling.js";
import { attachTurn } from "../services/calling.js";
import {
  getAiSettings,
  getCall,
  getCallAgent,
  getRules,
  knowledgeContextForAgent,
  saveCall,
} from "../store.js";
import { agentVoiceRuntime, mapLiveKitDisconnect } from "../services/livekit.js";

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

export function transcriptRelation(previous, next, { consecutive = true } = {}) {
  const a = String(previous || "").trim();
  const b = String(next || "").trim();
  if (!a || !b) return "new";
  if (a === b) return "same";
  if (b.startsWith(a) || (b.includes(a) && b.length > a.length)) return "extend";
  if (a.startsWith(b) || (a.includes(b) && a.length > b.length)) return "shorter";
  if (consecutive && b.length <= 8 && !/[.।!?]$/.test(a) && !/^[A-Z]/.test(b)) return "join";
  return "new";
}

export async function buildSessionSnapshot(callId) {
  const call = await getCall(callId);
  if (!call) throw new Error("Call not found");
  const agent = await getCallAgent(call);
  if (!agent) throw new Error("Agent not found");
  const settings = await getAiSettings();
  const llm = resolveLlmConfig(agent, settings);
  const greeting = renderGreeting(agent, call.customer) || agent.greeting || "";
  const knowledge = await knowledgeContextForAgent(agent, "", { limit: 6, maxChars: 3500 });
  const instructions = liveKitInstructions({
    agent,
    knowledge,
    slots: call.gathered || {},
    customer: call.customer || {},
  });
  return {
    callId: call.id,
    greeting,
    instructions,
    knowledge,
    language: call.language || agent.language || "te-IN",
    agent: {
      id: agent.id,
      name: agent.name,
      language: agent.language,
      ttsVoice: agent.ttsVoice,
      ttsModel: agent.ttsModel,
      ttsProvider: agent.ttsProvider,
      transferNumber: agent.transferNumber || "",
      callSettings: agent.callSettings || {},
      voiceRuntime: agentVoiceRuntime(agent),
      gender: speakerGender(agent),
      customTools: (agent.customTools || []).map((tool) => ({
        id: tool.id,
        name: toolName(tool),
        description: tool.description || `Call the ${tool.name} HTTP API`,
      })),
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
    runtime: call.runtime || agentVoiceRuntime(agent),
  };
}

function turnSource(call) {
  return String(call?.runtime || "").toLowerCase() === "pipecat" ? "pipecat" : "livekit";
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
      turnSource(call)
    );
  }

  const reply = await streamReply({
    agent,
    call,
    userText,
    knowledge: await knowledgeContextForAgent(agent, userText),
    knowledgeFn: (ag, q) => knowledgeContextForAgent(ag, q),
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
    turnSource(call)
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

export async function handleSessionTool(callId, { eventId, name, args = {} }) {
  if (eventId && rememberEvent(eventId)) {
    return { ok: true, duplicate: true, result: "Already handled." };
  }
  const call = await getCall(callId);
  if (!call) throw new Error("Call not found");
  const agent = await getCallAgent(call);
  if (!agent) throw new Error("Agent not found");
  const result = await runToolCall({
    name,
    args: args || {},
    agent,
    call,
    slots: call.gathered || {},
    knowledgeFn: (ag, q) => knowledgeContextForAgent(ag, q),
  });
  if (result.endCall) {
    // Defer hangup for tools that still need to speak a goodbye over LiveKit.
    // Applying disposition here made the studio poll disconnect mid-TTS ("assistant - speaking"
    // in transcript but no audio).
    const deferHangup = name === "end_interaction" || name === "transfer_to_human";
    if (!deferHangup) {
      const rules = await getRules();
      const mapped = mapLiveKitDisconnect(result.disposition || "completed");
      mapped.disposition = result.disposition || mapped.disposition;
      const next = applyOutcome(call, mapped, rules);
      await saveCall(next);
      await scheduleFollowUp(next);
    }
  }
  return {
    ok: Boolean(result.ok),
    result: result.result || result.say || "",
    endCall: Boolean(result.endCall),
    disposition: result.disposition || null,
    transfer: result.transfer || null,
    say: result.say || "",
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
    const role = payload.role || "system";
    const text = String(payload.text).trim();
    const messages = call.messages || [];
    let lastIdx = -1;
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      if (messages[i].role === role) {
        lastIdx = i;
        break;
      }
    }
    const relation = lastIdx >= 0
      ? transcriptRelation(messages[lastIdx].text, text, {
          consecutive: messages[messages.length - 1]?.role === role,
        })
      : "new";
    if (relation === "same" || relation === "shorter") {
      return { ok: true, duplicate: true };
    }
    if (relation === "extend" || relation === "join") {
      const merged = relation === "join"
        ? `${String(messages[lastIdx].text || "").trim()} ${text}`.trim()
        : text;
      messages[lastIdx] = { ...messages[lastIdx], text: merged };
      call.messages = messages;
      await saveCall(call);
      return { ok: true, updated: true };
    }
    await attachTurn(
      call,
      {
        id: `msg_${uuid().slice(0, 8)}`,
        role,
        text,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
      },
      turnSource(call)
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
    if (payload.disposition) mapped.disposition = payload.disposition;
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
