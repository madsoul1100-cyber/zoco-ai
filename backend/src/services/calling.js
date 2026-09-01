import { v4 as uuid } from "uuid";
import { recordTurn } from "../infra/events.js";
import { enqueueDial, enqueueRecall, queueState } from "../infra/queue.js";
import { countLiveCampaignCalls, getCall, getCallAgent, getCampaign, saveCall } from "../store.js";
import { inCallingWindow, msUntilWindow } from "../engine/window.js";
import { agentUsesLiveKit, dispatchLiveKitOutboundCall, livekitSipReady } from "./livekit.js";
import { agentUsesPipecat, dispatchPipecatOutboundCall, pipecatDialReady } from "./pipecat.js";
import { placeExotelCall, resolveTelephony } from "../telephony/index.js";

export async function attachTurn(call, message, source) {
  const tagged = { ...message, source: source || inferSource(call) };
  call.messages = call.messages || [];
  call.messages.push(tagged);
  await recordTurn({ call, message: tagged, source: tagged.source });
  return tagged;
}

export function inferSource(call) {
  if (call.channel === "telephony") return "telephony";
  if (call.channel === "whatsapp") return "whatsapp";
  if (call.channel === "widget") return "widget";
  if (call.channel === "voice") return "voice";
  return "chat";
}

export async function scheduleFollowUp(call) {
  if (call.recall?.needed && call.recall.scheduledAt) {
    const delayMs = Date.parse(call.recall.scheduledAt) - Date.now();
    await enqueueRecall(call.id, { delayMs });
  }
  if (call.status === "queued" && call.scheduledAt) {
    const delayMs = Date.parse(call.scheduledAt) - Date.now();
    await enqueueDial(call.id, { delayMs, jobId: `scheduled-${call.id}` });
  }
}

async function dialExotelCall(call, agent) {
  const tel = await resolveTelephony();
  const result = await placeExotelCall({ call, tel });
  call.channel = "telephony";
  call.runtime = "exotel";
  call.exotelSid = result.sid;
  call.status = "ringing";
  call.nudgeIndex = 0;
  if (!call.startedAt) call.startedAt = new Date().toISOString();
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `Exotel call: ${tel.fromNumber} → ${call.customer?.phone} (${result.sid || "queued"})`,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
  }, "exotel");
  return saveCall(call);
}

async function dialLiveKitCall(call, agent) {
  const tel = await resolveTelephony();
  const result = await dispatchLiveKitOutboundCall(call, agent);
  call.channel = "telephony";
  call.runtime = result.runtime;
  call.livekit = {
    roomName: result.roomName,
    participantId: result.participantId,
    sipCallId: result.sipCallId,
  };
  call.status = "ringing";
  call.nudgeIndex = 0;
  if (!call.startedAt) call.startedAt = new Date().toISOString();
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `LiveKit: ${tel.fromNumber || "SIP"} → ${call.customer?.phone} (${result.roomName})`,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
  }, "livekit");
  return saveCall(call);
}

async function dialPipecatCall(call, agent) {
  const result = await dispatchPipecatOutboundCall(call, agent);
  call.channel = "telephony";
  call.runtime = result.runtime;
  call.pipecat = {
    sessionId: result.sessionId,
    roomUrl: result.roomUrl,
    channel: "telephony",
  };
  call.status = "ringing";
  call.nudgeIndex = 0;
  if (!call.startedAt) call.startedAt = new Date().toISOString();
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `Pipecat: Daily PSTN → ${call.customer?.phone} (${result.sessionId || result.roomUrl || "started"})`,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
  }, "pipecat");
  return saveCall(call);
}

export async function dialLiveCall(call) {
  const agent = await getCallAgent(call);
  if (agentUsesPipecat(agent) && pipecatDialReady()) {
    try {
      return await dialPipecatCall(call, agent);
    } catch (error) {
      console.warn("Pipecat Daily dial-out failed, falling back to Exotel:", error.message);
      await attachTurn(call, {
        id: `msg_${uuid().slice(0, 8)}`,
        role: "system",
        text: `Pipecat unavailable (${error.message}). Falling back to Exotel.`,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
      }, "system");
    }
  }
  if (agentUsesLiveKit(agent) && livekitSipReady()) {
    try {
      return await dialLiveKitCall(call, agent);
    } catch (error) {
      console.warn("LiveKit SIP dispatch failed, falling back to Exotel:", error.message);
      await attachTurn(call, {
        id: `msg_${uuid().slice(0, 8)}`,
        role: "system",
        text: `LiveKit unavailable (${error.message}). Falling back to Exotel.`,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
      }, "system");
    }
  }
  const tel = await resolveTelephony();
  if (!tel.exotelReady) {
    const missing = [
      !tel.accountSid && "Exotel Account SID",
      !tel.apiKey && "Exotel API key",
      !tel.apiToken && "Exotel API token",
      !tel.fromNumber && "Exotel Exophone",
      !tel.publicBaseUrl && "public webhook URL (HTTPS, e.g. ngrok on 8787)",
    ].filter(Boolean);
    throw new Error(`Live phone calling is not ready. Add: ${missing.join(", ")}`);
  }
  return dialExotelCall(call, agent);
}

export async function queueOrDial(call) {
  if (queueState.ready) {
    await enqueueDial(call.id);
    call.status = call.status === "queued" ? "queued" : "ringing";
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "system",
      text: "Queued for live dial",
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
    }, "telephony");
    return saveCall(call);
  }
  return dialLiveCall(call);
}

export async function performRecall(previousId) {
  const previous = await getCall(previousId);
  if (!previous) throw new Error("Call not found");
  const agent = await getCallAgent(previous);
  if (!agent) throw new Error("Agent missing");

  previous.recall = { ...previous.recall, needed: false, reason: "recalled" };
  await saveCall(previous);

  const now = new Date().toISOString();
  const next = {
    ...previous,
    id: `call_${uuid().slice(0, 10)}`,
    attempt: Number(previous.attempt || 1) + 1,
    status: "ringing",
    disposition: "in_progress",
    startedAt: now,
    endedAt: null,
    durationSeconds: 0,
    recordingUrl: null,
    recordingKey: null,
    twilioSid: null,
    exotelSid: null,
    livekit: null,
    pipecat: null,
    runtime: null,
    parentCallId: previous.id,
    createdAt: now,
    messages: [],
    recall: {
      needed: false,
      reason: null,
      scheduledAt: null,
      attempt: Number(previous.attempt || 1) + 1,
      maxAttempts: 3,
    },
  };
  await attachTurn(next, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `Recall of ${previous.id} (attempt ${next.attempt})`,
    timestamp: now,
    audioOffsetMs: 0,
  }, "telephony");
  let saved = await saveCall(next);
  const tel = await resolveTelephony();
  if (tel.exotelReady) saved = await queueOrDial(saved);
  return saved;
}

export async function handleCallJob(job) {
  if (job.name === "dial") {
    const call = await getCall(job.data.callId);
    if (!call) return;
    if (["completed", "busy", "no_answer", "failed", "dropped"].includes(call.status) && !call.recall?.needed) {
      return;
    }
    if (call.twilioSid || call.livekit?.roomName || call.exotelSid || call.pipecat?.sessionId) return;
    if (call.campaignId) {
      const campaign = await getCampaign(call.campaignId);
      if (!campaign || campaign.status === "paused") return;
      if (!inCallingWindow(campaign.schedule)) {
        await enqueueDial(call.id, { delayMs: msUntilWindow(campaign.schedule), jobId: `dial-${call.id}-win-${Date.now()}` });
        return;
      }
      const live = await countLiveCampaignCalls(campaign.id);
      if (live >= Number(campaign.concurrency || 1)) {
        await enqueueDial(call.id, { delayMs: 15000, jobId: `dial-${call.id}-slot-${Date.now()}` });
        return;
      }
    }
    await dialLiveCall(call);
    return;
  }
  if (job.name === "recall") {
    await performRecall(job.data.callId);
  }
}
