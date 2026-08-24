import { v4 as uuid } from "uuid";
import { connectInfra } from "./infra/connect.js";
import { mongoState } from "./infra/mongo.js";
import { loadEnv } from "./loadEnv.js";
import { ensureStore, saveAgent, saveCall, saveRules, defaultRules } from "./store.js";

loadEnv();
if (!mongoState.ready) await connectInfra();
await ensureStore();

const now = Date.now();
const iso = (offsetMs = 0) => new Date(now + offsetMs).toISOString();

const leadAgent = {
  id: "agt_lead_qualify",
  name: "Lead Qualifier",
  direction: "outbound",
  useCase: "Screen inbound form fills for purchase intent and book a callback.",
  persona: "Confident, short sentences, never oversell.",
  greeting: "Hi, this is Maya from Zoco. You requested a demo — do you have two minutes?",
  qualifyPrompt: "Are you evaluating this for your team this month, or should I recall you later?",
  closingPrompt: "I can mark you as qualified and send the next slot to our closer.",
  successPrompt: "Locked in. You are marked qualified. Someone from Zoco will follow up today.",
  successCriteria: "Confirm intent, company size, and a callback window.",
  defaultSuccessDisposition: "qualified",
  language: "en-IN",
  voice: "Serena",
  createdAt: iso(-86400000 * 3),
  updatedAt: iso(-3600000),
};

const supportAgent = {
  id: "agt_inbound_support",
  name: "Support Concierge",
  direction: "inbound",
  useCase: "Answer product questions and close with a ticket or a recall.",
  persona: "Calm, precise, empathetic.",
  greeting: "Thank you for calling Zoco. I am Aria. How can I help you today?",
  qualifyPrompt: "Is this about an active call campaign, billing, or something else?",
  closingPrompt: "I can close this as resolved, or schedule a specialist to recall you.",
  successPrompt: "Done. I have marked this as successful and logged the transcript.",
  successCriteria: "Resolve the issue or schedule a human recall.",
  defaultSuccessDisposition: "success",
  language: "en-IN",
  voice: "Aria",
  createdAt: iso(-86400000 * 2),
  updatedAt: iso(-7200000),
};

function message(role, text, at) {
  return {
    id: `msg_${uuid().slice(0, 8)}`,
    role,
    text,
    timestamp: at,
    audioOffsetMs: null,
  };
}

const sampleCalls = [
  {
    id: "call_success_01",
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    direction: "outbound",
    channel: "chat",
    customer: { name: "Riya Shah", phone: "+919876543210", company: "Northbeam" },
    status: "completed",
    disposition: "qualified",
    attempt: 1,
    startedAt: iso(-5400000),
    endedAt: iso(-5100000),
    durationSeconds: 300,
    recordingUrl: null,
    gathered: { name: "Riya Shah", intent: "this month" },
    outcomeReason: "Lead confirmed evaluation this month",
    recall: { needed: false, reason: null, scheduledAt: null, attempt: 1, maxAttempts: 3 },
    createdAt: iso(-5400000),
    messages: [
      message("assistant", leadAgent.greeting, iso(-5400000)),
      message("user", "Yes, I filled the form this morning.", iso(-5380000)),
      message("assistant", "Are you evaluating this for your team this month?", iso(-5360000)),
      message("user", "Yes, for a 12 person sales team. Let's book it.", iso(-5340000)),
      message("assistant", leadAgent.successPrompt, iso(-5320000)),
    ],
  },
  {
    id: "call_recall_01",
    agentId: leadAgent.id,
    agentName: leadAgent.name,
    direction: "outbound",
    channel: "voice",
    customer: { name: "Arjun Mehta", phone: "+918888111222", company: "Harbor Labs" },
    status: "no_answer",
    disposition: "no_answer",
    attempt: 1,
    startedAt: iso(-1800000),
    endedAt: iso(-1788000),
    durationSeconds: 12,
    recordingUrl: null,
    gathered: {},
    outcomeReason: "Rang out",
    recall: {
      needed: true,
      reason: "no_answer",
      scheduledAt: iso(-60000),
      attempt: 1,
      maxAttempts: 3,
      delayMinutes: 60,
    },
    createdAt: iso(-1800000),
    messages: [
      message("system", "Call ringing", iso(-1800000)),
      message("system", "No answer after 12s. Recall scheduled.", iso(-1788000)),
    ],
  },
  {
    id: "call_dropped_01",
    agentId: supportAgent.id,
    agentName: supportAgent.name,
    direction: "inbound",
    channel: "voice",
    customer: { name: "Neha Kapoor", phone: "+917777000111", company: "Kite Retail" },
    status: "dropped",
    disposition: "dropped",
    attempt: 1,
    startedAt: iso(-900000),
    endedAt: iso(-780000),
    durationSeconds: 120,
    recordingUrl: null,
    gathered: { name: "Neha Kapoor" },
    outcomeReason: "Customer disconnected mid-call",
    recall: {
      needed: true,
      reason: "dropped",
      scheduledAt: iso(120000),
      attempt: 1,
      maxAttempts: 3,
      delayMinutes: 5,
    },
    createdAt: iso(-900000),
    messages: [
      message("assistant", supportAgent.greeting, iso(-900000)),
      message("user", "Hi, my campaign paused after five failed dials.", iso(-880000)),
      message("assistant", "I can see a mid-call drop risk. Were the calls connecting at all?", iso(-860000)),
      message("system", "Customer disconnected. Recall scheduled.", iso(-780000)),
    ],
  },
];

await ensureStore();
await saveRules(defaultRules());
await saveAgent(leadAgent);
await saveAgent(supportAgent);
for (const call of sampleCalls) {
  await saveCall(call);
}

console.log("Zoco AI seed complete: 2 agents, 3 calls, default recall rules.");
