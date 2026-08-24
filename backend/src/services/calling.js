import { v4 as uuid } from "uuid";
import { recordTurn } from "../infra/events.js";
import { enqueueDial, enqueueRecall, queueState } from "../infra/queue.js";
import { getAgent, getCall, saveCall } from "../store.js";
import { placeTwilioCall, resolveTelephony } from "../telephony/twilio.js";

export async function attachTurn(call, message, source) {
  const tagged = { ...message, source: source || inferSource(call) };
  call.messages = call.messages || [];
  call.messages.push(tagged);
  await recordTurn({ call, message: tagged, source: tagged.source });
  return tagged;
}

export function inferSource(call) {
  if (call.channel === "telephony") return "telephony";
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

export async function dialLiveCall(call) {
  const tel = await resolveTelephony();
  if (!tel.twilioReady) {
    const missing = [
      !tel.accountSid && "Twilio Account SID",
      !tel.authToken && "Twilio Auth Token",
      !tel.fromNumber && "Twilio From number",
      !tel.publicBaseUrl && "public webhook URL (start ngrok on port 8787)",
    ].filter(Boolean);
    throw new Error(`Live phone calling is not ready. Add: ${missing.join(", ")}`);
  }
  const result = await placeTwilioCall({ call, tel });
  call.channel = "telephony";
  call.twilioSid = result.sid;
  call.status = "ringing";
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `Live call: ${tel.fromNumber} → ${call.customer?.phone} (${result.sid})`,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
  }, "telephony");
  return saveCall(call);
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
  const agent = await getAgent(previous.agentId);
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
  if (tel.twilioReady) saved = await queueOrDial(saved);
  return saved;
}

export async function handleCallJob(job) {
  if (job.name === "dial") {
    const call = await getCall(job.data.callId);
    if (!call) return;
    if (["completed", "busy", "no_answer", "failed", "dropped"].includes(call.status) && !call.recall?.needed) {
      return;
    }
    if (call.twilioSid) return;
    await dialLiveCall(call);
    return;
  }
  if (job.name === "recall") {
    await performRecall(job.data.callId);
  }
}
