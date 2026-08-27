import cors from "cors";
import express from "express";
import http from "node:http";
import multer from "multer";
import { v4 as uuid } from "uuid";
import { generateReply, streamReply } from "./engine/conversation.js";
import { renderGreeting } from "./engine/template.js";
import { applyOutcome, dashboardStats, DISPOSITIONS } from "./engine/rules.js";
import { publicProviderCatalog, resolveLlmConfig } from "./engine/providers.js";
import { sttReady, transcribeAudio, transcribeFromUrl } from "./engine/stt.js";
import { mountSttStream } from "./engine/sttStream.js";
import { QUIET_OFFICE_PATH } from "./engine/ambient.js";
import { callTimedOut, isMachineAnswer, silenceAction, voicemailMessage } from "./engine/callBehavior.js";
import { getTtsClip, synthesizeSpeech } from "./engine/tts.js";
import { translateText } from "./engine/translate.js";
import { getLanguage, normalizeLanguage, publicLanguages, resolveSpokenLanguage, isNoiseTranscript } from "./languages.js";
import { readFile } from "node:fs/promises";
import { connectInfra, infraHealth } from "./infra/connect.js";
import { listTurns } from "./infra/events.js";
import { startCallWorker } from "./infra/queue.js";
import { getRecordingStream, uploadRecording } from "./infra/s3.js";
import { loadEnv } from "./loadEnv.js";
import { normalizePhone } from "./phone.js";
import { authMiddleware, mountAuthRoutes } from "./routes/auth.js";
import { mountProductRoutes } from "./routes/product.js";
import { mountWidgetRoutes } from "./routes/widget.js";
import {
  attachTurn,
  handleCallJob,
  inferSource,
  performRecall,
  queueOrDial,
  scheduleFollowUp,
} from "./services/calling.js";
import {
  gatherTwiml,
  hangupTwiml,
  mapTwilioStatus,
  publicTelephony,
  recordListenTwiml,
  redirectTwilioCall,
  resolveTelephony,
  sendWhatsApp,
  syncInboundWebhook,
  transferTwiml,
  whatsappFromNumber,
} from "./telephony/twilio.js";
import {
  commitAgentVersion,
  deleteAgent,
  deleteContact,
  ensureStore,
  getAgent,
  getAiSettings,
  getCall,
  getCallAgent,
  getCallByTwilioSid,
  getContact,
  getInbound,
  getRules,
  getTelephony,
  knowledgeContextForAgent,
  listAgentVersions,
  listAgents,
  listCalls,
  listContacts,
  listInbounds,
  retargetGrokAgents,
  saveAgent,
  saveAiSettings,
  saveCall,
  saveContact,
  saveRules,
  saveTelephony,
} from "./store.js";

loadEnv();

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });
const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors({ origin: true, credentials: true }));
app.use(express.urlencoded({ extended: false }));
app.use(express.json({ limit: "8mb" }));
app.use(authMiddleware);

mountAuthRoutes(app);
mountWidgetRoutes(app);
mountProductRoutes(app, { upload });

app.get("/api/health", async (_req, res) => {
  const settings = await getAiSettings();
  const llm = resolveLlmConfig({}, settings);
  const telephony = await resolveTelephony();
  res.json({
    ok: true,
    product: "Zoco AI",
    stage: "product",
    llm: llm
      ? { ready: true, provider: llm.provider, model: llm.model }
      : { ready: false, provider: "local", model: null },
    providers: publicProviderCatalog(settings),
    telephony: publicTelephony(telephony),
    infra: await infraHealth(),
  });
});

app.get("/api/providers", async (_req, res) => {
  res.json(publicProviderCatalog(await getAiSettings()));
});

app.get("/api/ai", async (_req, res) => {
  const settings = await getAiSettings();
  res.json({
    defaultLlmProvider: settings.defaultLlmProvider,
    defaultTtsProvider: settings.defaultTtsProvider,
    keys: {
      openrouter: settings.keys.openrouter ? "••••••••" : "",
      sarvam: settings.keys.sarvam ? "••••••••" : "",
      grok: settings.keys.grok ? "••••••••" : "",
      openai: settings.keys.openai ? "••••••••" : "",
    },
    catalog: publicProviderCatalog(settings),
  });
});

app.put("/api/ai", async (req, res) => {
  const saved = await saveAiSettings(req.body || {});
  res.json({
    defaultLlmProvider: saved.defaultLlmProvider,
    defaultTtsProvider: saved.defaultTtsProvider,
    catalog: publicProviderCatalog(saved),
  });
});

app.post("/api/translate", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  const to = req.body?.to;
  if (!text || !to) return res.status(400).json({ error: "Text and target language are required" });
  try {
    const translated = await translateText({
      text,
      from: req.body?.from || "en-IN",
      to,
      speakerGender: req.body?.speakerGender,
    });
    res.json({ text: translated, to });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/ambient/quiet-office", async (_req, res) => {
  try {
    const { ensureQuietOfficeAudio } = await import("./engine/ambient.js");
    await ensureQuietOfficeAudio();
    const buffer = await readFile(QUIET_OFFICE_PATH);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch {
    res.status(404).json({ error: "Ambient audio missing" });
  }
});

app.get("/api/tts/:id", async (req, res) => {
  const clip = await getTtsClip(req.params.id);
  if (!clip) return res.status(404).json({ error: "Voice clip not found" });
  res.setHeader("Content-Type", clip.contentType);
  res.send(clip.buffer);
});

app.post("/api/stt", upload.single("audio"), async (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: "Audio file missing" });
  try {
    const transcript = await transcribeAudio(req.file.buffer, {
      language: req.body?.language || "en-IN",
      mime: req.file.mimetype || "audio/webm",
      filename: req.file.originalname || "speech.webm",
    });
    res.json({ transcript, ready: await sttReady() });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/tts", async (req, res) => {
  const text = String(req.body?.text || "").trim();
  if (!text) return res.status(400).json({ error: "Text is required" });
  const stored = req.body?.agentId ? await getAgent(req.body.agentId) : null;
  if (req.body?.agentId && !stored) return res.status(404).json({ error: "Agent not found" });
  const agent = {
    ...(stored || {}),
    ttsProvider: req.body?.ttsProvider || stored?.ttsProvider,
    ttsVoice: req.body?.ttsVoice || stored?.ttsVoice,
    ttsModel: req.body?.ttsModel || stored?.ttsModel,
    language: req.body?.language || stored?.language,
    voice: req.body?.voice || stored?.voice,
    callSettings: {
      ...(stored?.callSettings && typeof stored.callSettings === "object" ? stored.callSettings : {}),
      ...(req.body?.callSettings && typeof req.body.callSettings === "object" ? req.body.callSettings : {}),
    },
  };
  try {
    const spoken = await synthesizeSpeech({
      agent,
      text,
      settings: await getAiSettings(),
      publicBaseUrl: "",
      skipAmbient: Boolean(req.body?.skipAmbient) || req.body?.source === "studio",
      source: String(req.body?.source || ""),
    });
    res.json(spoken || { provider: "browser" });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.get("/api/meta", (_req, res) => {
  res.json({
    product: "Zoco AI",
    tagline: "Voice agents that close the loop",
    dispositions: DISPOSITIONS,
    languages: publicLanguages(),
  });
});

app.get("/api/dashboard", async (_req, res) => {
  const [calls, agents, rules, contacts] = await Promise.all([
    listCalls(),
    listAgents(),
    getRules(),
    listContacts(),
  ]);
  const now = Date.now();
  const scheduled = calls.filter((c) => c.status === "queued" && c.scheduledAt);
  res.json({
    stats: {
      ...dashboardStats(calls),
      contacts: contacts.length,
      scheduledCalls: scheduled.length,
      scheduledDue: scheduled.filter((c) => Date.parse(c.scheduledAt) <= now).length,
    },
    recentCalls: calls.slice(0, 8),
    recallQueue: calls
      .filter((c) => c.recall?.needed)
      .sort((a, b) => String(a.recall.scheduledAt).localeCompare(String(b.recall.scheduledAt))),
    agents,
    rules,
    telephony: publicTelephony(await resolveTelephony()),
  });
});

app.get("/api/agents", async (_req, res) => {
  res.json(await listAgents());
});

app.get("/api/agents/:id", async (req, res) => {
  const agent = await getAgent(req.params.id, req.query.version);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(agent);
});

app.get("/api/agents/:id/versions", async (req, res) => {
  const agent = await getAgent(req.params.id);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  res.json(await listAgentVersions(req.params.id));
});

app.post("/api/agents", async (req, res) => {
  const body = req.body || {};
  const now = new Date().toISOString();
  const agent = {
    id: body.id || `agt_${uuid().slice(0, 8)}`,
    name: body.name || "Untitled agent",
    direction: body.direction === "inbound" ? "inbound" : "outbound",
    useCase: body.useCase || "Qualify the caller and capture a next step.",
    persona: body.persona || "Warm, concise, professional",
    greeting: body.greeting || "",
    qualifyPrompt: body.qualifyPrompt || "",
    closingPrompt: body.closingPrompt || "",
    successPrompt: body.successPrompt || "",
    successCriteria: body.successCriteria || "Mark the call successful when the goal is met.",
    defaultSuccessDisposition: body.defaultSuccessDisposition || "success",
    language: normalizeLanguage(body.language),
    greetings: body.greetings && typeof body.greetings === "object" ? body.greetings : {},
    voice: body.voice || "Serena",
    llmProvider: body.llmProvider || "openrouter",
    llmModel: body.llmModel || process.env.OPENROUTER_MODEL || "google/gemini-2.5-flash",
    ttsProvider: body.ttsProvider || "browser",
    ttsModel: body.ttsModel || "",
    ttsVoice: body.ttsVoice || "",
    transferNumber: body.transferNumber || "",
    knowledgeBaseIds: Array.isArray(body.knowledgeBaseIds) ? body.knowledgeBaseIds : [],
    category: body.category || "",
    status: body.status || "draft",
    version: Number(body.version || 1),
    instructions: body.instructions || body.persona || "",
    variables: Array.isArray(body.variables) ? body.variables : [],
    inputVariables: Array.isArray(body.inputVariables) ? body.inputVariables : [],
    outputVariables: Array.isArray(body.outputVariables) ? body.outputVariables : [],
    customTools: Array.isArray(body.customTools) ? body.customTools : [],
    callSettings: body.callSettings && typeof body.callSettings === "object" ? body.callSettings : {},
    tests: Array.isArray(body.tests) ? body.tests : [],
    instructionSections: Array.isArray(body.instructionSections) ? body.instructionSections : [],
    workflow: body.workflow && typeof body.workflow === "object" ? body.workflow : { enabled: false, nodes: [] },
    createdAt: now,
    updatedAt: now,
  };
  if (!agent.greeting) {
    agent.greeting =
      agent.direction === "inbound"
        ? `Thank you for calling Zoco. This is ${agent.name}. How can I help?`
        : `Hi, this is ${agent.name} from Zoco. ${agent.useCase} Do you have a minute?`;
  }
  res.status(201).json(await saveAgent(agent));
});

app.put("/api/agents/:id", async (req, res) => {
  const existing = await getAgent(req.params.id);
  if (!existing) return res.status(404).json({ error: "Agent not found" });
  const agent = { ...existing, ...req.body, id: existing.id, updatedAt: new Date().toISOString() };
  if (req.body?.language) agent.language = normalizeLanguage(req.body.language);
  const saved = await saveAgent(agent);
  const bumped = Number(saved.version || 1) !== Number(existing.version || 1);
  if (bumped || req.body?.commitVersion) await commitAgentVersion(saved);
  res.json(saved);
});

app.delete("/api/agents/:id", async (req, res) => {
  await deleteAgent(req.params.id);
  res.json({ ok: true });
});

app.get("/api/telephony", async (_req, res) => {
  res.json(publicTelephony(await resolveTelephony()));
});

app.put("/api/telephony", async (req, res) => {
  const current = await getTelephony();
  const body = req.body || {};
  const authToken =
    !body.authToken || body.authToken.includes("•") ? current.authToken : body.authToken;
  const tel = await resolveTelephony();
  await saveTelephony({
    ...current,
    ...body,
    authToken,
    workspacePhone: normalizePhone(body.workspacePhone || current.workspacePhone),
    fromNumber: normalizePhone(body.fromNumber || current.fromNumber || tel.fromNumber),
    publicBaseUrl: String(body.publicBaseUrl || current.publicBaseUrl || tel.publicBaseUrl || "").replace(
      /\/$/,
      ""
    ),
  });
  const nextTel = await resolveTelephony();
  if (nextTel.twilioReady) {
    await syncInboundWebhook(nextTel).catch((error) => {
      console.warn("Could not point Twilio inbound webhook:", error.message);
    });
  }
  res.json(publicTelephony(nextTel));
});

app.get("/api/contacts", async (_req, res) => {
  res.json(await listContacts());
});

app.post("/api/contacts", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) return res.status(400).json({ error: "Phone number is required" });
  const now = new Date().toISOString();
  const contact = {
    id: `cst_${uuid().slice(0, 8)}`,
    name: req.body?.name || "Customer",
    phone,
    notes: req.body?.notes || "",
    company: req.body?.company || "",
    createdAt: now,
    updatedAt: now,
  };
  res.status(201).json(await saveContact(contact));
});

app.delete("/api/contacts/:id", async (req, res) => {
  await deleteContact(req.params.id);
  res.json({ ok: true });
});

app.get("/api/queue", async (_req, res) => {
  const now = Date.now();
  const calls = await listCalls();
  const scheduled = calls.filter((c) => c.status === "queued" && c.scheduledAt);
  const due = scheduled
    .filter((c) => Date.parse(c.scheduledAt) <= now)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const upcoming = scheduled
    .filter((c) => Date.parse(c.scheduledAt) > now)
    .sort((a, b) => String(a.scheduledAt).localeCompare(String(b.scheduledAt)));
  const recallDue = calls
    .filter((c) => c.recall?.needed && Date.parse(c.recall.scheduledAt) <= now)
    .sort((a, b) => String(a.recall.scheduledAt).localeCompare(String(b.recall.scheduledAt)));
  const recallLater = calls
    .filter((c) => c.recall?.needed && Date.parse(c.recall.scheduledAt) > now)
    .sort((a, b) => String(a.recall.scheduledAt).localeCompare(String(b.recall.scheduledAt)));
  res.json({ due, upcoming, recallDue, recallLater });
});

app.get("/api/calls", async (req, res) => {
  let calls = await listCalls();
  const { status, disposition, recall, direction } = req.query;
  if (direction) calls = calls.filter((c) => c.direction === direction);
  if (status) calls = calls.filter((c) => c.status === status);
  if (disposition) calls = calls.filter((c) => c.disposition === disposition);
  if (recall === "due") {
    const now = Date.now();
    calls = calls.filter((c) => c.recall?.needed && Date.parse(c.recall.scheduledAt) <= now);
  } else if (recall === "scheduled") {
    calls = calls.filter((c) => c.recall?.needed);
  }
  res.json(calls);
});

app.get("/api/calls/:id", async (req, res) => {
  const call = await getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  res.json(call);
});

app.get("/api/calls/:id/turns", async (req, res) => {
  res.json(await listTurns(req.params.id));
});

app.post("/api/calls", async (req, res) => {
  const body = req.body || {};
  const agent = await getAgent(body.agentId);
  if (!agent) return res.status(400).json({ error: "Choose an agent first" });

  let customer = {
    name: body.customer?.name || "Guest",
    phone: normalizePhone(body.customer?.phone || ""),
    company: body.customer?.company || "",
  };
  if (body.contactId) {
    const contact = await getContact(body.contactId);
    if (!contact) return res.status(400).json({ error: "Contact not found" });
    customer = { name: contact.name, phone: contact.phone, company: contact.company || "", contactId: contact.id };
  }
  if (body.useWorkspacePhone) {
    const telephony = await getTelephony();
    if (!telephony.workspacePhone) {
      return res.status(400).json({ error: "Register your phone first" });
    }
    customer = {
      name: customer.name !== "Guest" ? customer.name : telephony.workspaceName || "You",
      phone: telephony.workspacePhone,
      company: customer.company,
    };
  }

  const now = new Date().toISOString();
  const scheduledAt = body.scheduledAt ? new Date(body.scheduledAt).toISOString() : null;
  const isScheduled = Boolean(scheduledAt && Date.parse(scheduledAt) > Date.now());
  const channel = body.channel === "chat" ? "chat" : body.channel === "whatsapp" ? "whatsapp" : "voice";
  const call = {
    id: `call_${uuid().slice(0, 10)}`,
    agentId: agent.id,
    agentName: agent.name,
    agentVersion: Number(body.agentVersion || agent.version || 1),
    direction: body.direction || agent.direction,
    channel,
    customer,
    status: isScheduled ? "queued" : channel === "voice" ? "ringing" : "in_progress",
    disposition: isScheduled ? "in_progress" : "in_progress",
    attempt: Number(body.attempt || 1),
    scheduledAt,
    startedAt: isScheduled ? null : now,
    endedAt: null,
    durationSeconds: 0,
    recordingUrl: null,
    gathered: {},
    language: normalizeLanguage(body.language || agent.language),
    outcomeReason: null,
    recall: { needed: false, reason: null, scheduledAt: null, attempt: Number(body.attempt || 1), maxAttempts: 3 },
    createdAt: now,
    messages: [
      {
        id: `msg_${uuid().slice(0, 8)}`,
        role: "system",
        text: isScheduled
          ? `Scheduled for ${scheduledAt} · ${customer.phone || "no number"}`
          : channel === "voice"
            ? `Call ringing ${customer.phone || ""}`.trim()
            : "Chat session started",
        timestamp: now,
        audioOffsetMs: 0,
      },
    ],
  };

  await saveCall(call);
  if (!isScheduled && channel === "chat") {
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "assistant",
      text: renderGreeting(agent, customer) || agent.greeting,
      timestamp: now,
      audioOffsetMs: 0,
    }, "chat");
  }

  try {
    let saved = await saveCall(call);
    if (isScheduled) {
      await scheduleFollowUp(saved);
    } else if (body.mode === "phone") {
      saved = await queueOrDial(saved);
    } else if (channel === "whatsapp") {
      const tel = await resolveTelephony();
      const greeting = renderGreeting(agent, customer) || agent.greeting || "Hi, this is Zoco.";
      await attachTurn(saved, {
        id: `msg_${uuid().slice(0, 8)}`,
        role: "assistant",
        text: greeting,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
      }, "whatsapp");
      await sendWhatsApp({ tel, to: customer.phone, body: greeting });
      saved = await saveCall(saved);
    }
    res.status(201).json(saved);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/calls/:id/start", async (req, res) => {
  const call = await getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (!["queued", "ringing"].includes(call.status) && !call.recall?.needed) {
    return res.status(409).json({ error: "This call cannot be started" });
  }
  const now = new Date().toISOString();
  call.status = "ringing";
  call.disposition = "in_progress";
  call.startedAt = call.startedAt || now;
  call.channel = "voice";
  call.messages.push({
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `Started outbound call to ${call.customer?.phone || call.customer?.name}`,
    timestamp: now,
    audioOffsetMs: null,
  });
  let saved = await saveCall(call);
  try {
    if (req.body?.mode === "phone" || (await resolveTelephony()).twilioReady) {
      saved = await queueOrDial(saved);
    }
    res.json(saved);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/calls/:id/connect", async (req, res) => {
  const call = await getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  const agent = await getCallAgent(call);
  const alreadyGreeted = call.messages?.some((m) => m.role === "assistant");
  if (call.status === "in_progress" && alreadyGreeted) {
    return res.json(call);
  }
  const now = new Date().toISOString();
  call.status = "in_progress";
  call.disposition = "in_progress";
  if (!alreadyGreeted) {
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "assistant",
      text: renderGreeting(agent, call.customer) || agent?.greeting || "Hi, you are through to Zoco.",
      timestamp: now,
      audioOffsetMs: null,
    });
  }
  res.json(await saveCall(call));
});

app.post("/api/calls/:id/messages", async (req, res) => {
  const call = await getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (!["in_progress", "ringing"].includes(call.status)) {
    return res.status(409).json({ error: "This call is no longer live" });
  }

  const userText = String(req.body?.text || "").trim();
  if (!userText) return res.status(400).json({ error: "Message text is required" });

  const agent = await getCallAgent(call);
  const source = req.body?.source || inferSource(call);
  const now = new Date().toISOString();
  call.status = "in_progress";
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "user",
    text: userText,
    timestamp: now,
    audioOffsetMs: req.body?.audioOffsetMs ?? null,
  }, source);

  const reply = await generateReply({
    agent,
    call,
    userText,
    knowledge: await knowledgeContextForAgent(agent, userText),
    knowledgeFn: (ag, q) => knowledgeContextForAgent(ag, q),
  });
  call.gathered = { ...(call.gathered || {}), ...(reply.slots || {}) };
  call.llm = { provider: reply.provider, model: reply.model || null };
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "assistant",
    text: reply.text,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
    provider: reply.provider,
  }, source);
  if (reply.llmError) {
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "system",
      text: `LLM fallback: ${reply.llmError}`,
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
    }, source);
  }

  let next = call;
  if (reply.endCall) {
    const rules = await getRules();
    next = applyOutcome(
      call,
      { status: "completed", disposition: reply.disposition || agent.defaultSuccessDisposition, reason: "Agent closed the conversation" },
      rules
    );
    await scheduleFollowUp(next);
  }

  res.json(await saveCall(next));
});

app.post("/api/calls/:id/messages/stream", async (req, res) => {
  const call = await getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (!["in_progress", "ringing"].includes(call.status)) {
    return res.status(409).json({ error: "This call is no longer live" });
  }
  const userText = String(req.body?.text || "").trim();
  if (!userText) return res.status(400).json({ error: "Message text is required" });

  const agent = await getCallAgent(call);
  const source = req.body?.source || inferSource(call);
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();
  const emit = (payload) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  try {
    call.status = "in_progress";
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "user",
      text: userText,
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
    }, source);
    await saveCall(call);
    emit({ type: "user", text: userText });

    // Skip KB retrieval on short/ack turns — it blocks time-to-first-token.
    const needsKb = /form\s*18|mlc|register|constituency|graduate|election|ఫారం|ఎన్నిక|జిల్లా|year|డిస్ట్రిక్ట్|voter|ఓటర్/i.test(userText)
      || userText.length > 48;
    const knowledge = needsKb
      ? await knowledgeContextForAgent(agent, userText, { limit: 2, maxChars: 1600 })
      : "";
    const reply = await streamReply({
      agent,
      call,
      userText,
      knowledge,
      onToken: (token) => emit({ type: "delta", text: token }),
    });

    call.gathered = { ...(call.gathered || {}), ...(reply.slots || {}) };
    call.llm = { provider: reply.provider, model: reply.model || null };
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "assistant",
      text: reply.text,
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
      provider: reply.provider,
    }, source);
    if (reply.llmError) {
      await attachTurn(call, {
        id: `msg_${uuid().slice(0, 8)}`,
        role: "system",
        text: `LLM fallback: ${reply.llmError}`,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
      }, source);
    }

    let next = call;
    if (reply.endCall) {
      const rules = await getRules();
      next = applyOutcome(
        call,
        {
          status: "completed",
          disposition: reply.disposition || agent.defaultSuccessDisposition,
          reason: "Agent closed the conversation",
        },
        rules
      );
      await scheduleFollowUp(next);
    }
    emit({ type: "done", call: await saveCall(next) });
  } catch (error) {
    console.error(error);
    emit({ type: "error", error: error.message || "Stream failed" });
  } finally {
    res.end();
  }
});

app.post("/api/calls/:id/outcome", async (req, res) => {
  const call = await getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  const rules = await getRules();
  const next = applyOutcome(
    call,
    {
      status: req.body?.status,
      disposition: req.body?.disposition,
      reason: req.body?.reason,
    },
    rules
  );
  if (req.body?.note) {
    await attachTurn(next, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "system",
      text: req.body.note,
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
    });
  }
  await scheduleFollowUp(next);
  res.json(await saveCall(next));
});

app.post("/api/calls/:id/recall", async (req, res) => {
  try {
    res.status(201).json(await performRecall(req.params.id));
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/calls/:id/recording", upload.single("audio"), async (req, res) => {
  const call = await getCall(req.params.id);
  if (!call) return res.status(404).json({ error: "Call not found" });
  if (!req.file?.buffer) return res.status(400).json({ error: "Audio file missing" });
  const stored = await uploadRecording({
    callId: call.id,
    buffer: req.file.buffer,
    contentType: req.file.mimetype || "audio/webm",
    ext: "webm",
  });
  call.recordingUrl = `/api/calls/${call.id}/recording`;
  call.recordingKey = stored.key;
  call.recordingPath = stored.path || null;
  call.recordingStorage = stored.storage;
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `Voice recording stored in ${stored.storage}`,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
  }, "voice");
  res.json(await saveCall(call));
});

app.get("/api/calls/:id/recording", async (req, res) => {
  const call = await getCall(req.params.id);
  const audio = await getRecordingStream({ key: call?.recordingKey, filePath: call?.recordingPath });
  if (!audio) return res.status(404).json({ error: "No recording" });
  res.setHeader("Content-Type", audio.contentType);
  if (Buffer.isBuffer(audio.stream)) return res.send(audio.stream);
  audio.stream.pipe(res);
});

app.get("/api/rules", async (_req, res) => {
  res.json(await getRules());
});

app.put("/api/rules", async (req, res) => {
  res.json(await saveRules(req.body || {}));
});

function sendTwiml(res, xml) {
  res.status(200);
  res.setHeader("Content-Type", "text/xml");
  res.send(xml);
}

function nextSilenceSeconds(agent, call) {
  const settings = agent?.callSettings || {};
  const nudges = Array.isArray(settings.nudges) ? settings.nudges : [];
  const index = Number(call?.nudgeIndex || 0);
  const next = nudges[index];
  return Number(next?.afterSeconds || 6);
}

async function spokenTwiml({ agent, say, language, actionUrl, hangup = false, record = false, callId, transferTo, silenceTimeout }) {
  const tel = await resolveTelephony();
  const spokenLanguage = language || agent?.language || "en-IN";
  let audioUrl = null;
  try {
    const spoken = await synthesizeSpeech({
      agent: { ...agent, language: spokenLanguage },
      text: say,
      settings: await getAiSettings(),
      publicBaseUrl: tel.publicBaseUrl,
    });
    if (spoken?.audioUrl && spoken.provider !== "browser") audioUrl = spoken.publicAudioUrl || spoken.audioUrl;
  } catch (error) {
    console.warn("TTS fallback to Twilio Say:", error.message);
  }
  if (hangup) return hangupTwiml({ say, language: spokenLanguage, audioUrl });
  if (transferTo) {
    return transferTwiml({
      say,
      language: spokenLanguage,
      audioUrl,
      toNumber: transferTo,
      callerId: tel.fromNumber,
    });
  }
  const recordingCallbackUrl =
    record && callId
      ? `${tel.publicBaseUrl}/webhooks/twilio/recording?callId=${encodeURIComponent(callId)}`
      : "";
  const timeout = silenceTimeout ?? 6;
  if (await sttReady()) {
    return recordListenTwiml({ say, actionUrl, language: spokenLanguage, audioUrl, recordingCallbackUrl, silenceTimeout: timeout });
  }
  return gatherTwiml({ say, actionUrl, language: spokenLanguage, audioUrl, recordingCallbackUrl, silenceTimeout: timeout });
}

async function speechFromTwilio(req, language) {
  const spoken = String(req.body?.SpeechResult || req.body?.UnstableSpeechResult || "").trim();
  if (spoken) return spoken;
  const recordingUrl = req.body?.RecordingUrl;
  if (!recordingUrl) return "";
  const tel = await resolveTelephony();
  try {
    return await transcribeFromUrl(`${recordingUrl}.wav`, {
      language,
      authHeader: `Basic ${Buffer.from(`${tel.accountSid}:${tel.authToken}`).toString("base64")}`,
    });
  } catch (error) {
    console.warn("Sarvam STT failed:", error.message);
    return "";
  }
}

async function findCallFromTwilio(req) {
  const callId = req.query.callId || req.body?.callId;
  if (callId) {
    const call = await getCall(callId);
    if (call) return call;
  }
  return getCallByTwilioSid(req.body?.CallSid || req.query?.CallSid);
}

app.post("/webhooks/twilio/inbound", handleInboundCall);
app.get("/webhooks/twilio/inbound", handleInboundCall);

async function resolveInboundLine(to) {
  const items = await listInbounds();
  const match = items.find((item) => item.phoneNumber && normalizePhone(item.phoneNumber) === to && (item.status === "live" || item.enabled));
  const live = match || items.find((item) => item.status === "live" || item.enabled);
  if (live) {
    return {
      ...live,
      enabled: live.status === "live" || live.enabled === true,
      inboundId: live.id,
    };
  }
  return getInbound();
}

async function handleInboundCall(req, res) {
  const from = normalizePhone(req.body?.From || req.query?.From);
  const to = normalizePhone(req.body?.To || req.query?.To);
  const inbound = await resolveInboundLine(to);
  const twilioSid = req.body?.CallSid || req.query?.CallSid || null;
  if (!twilioSid) {
    return sendTwiml(res, hangupTwiml({ say: "", language: "en-IN" }));
  }
  const agent = inbound.enabled ? await getAgent(inbound.agentId, inbound.agentVersion) : null;
  const language = normalizeLanguage(agent?.language);
  const spoken = getLanguage(language);
  if (!agent) {
    const say = inbound.enabled
      ? spoken.inactive
      : "This number is not answering right now. Please try again later.";
    return sendTwiml(res, hangupTwiml({ say, language }));
  }
  const existing = twilioSid ? await getCallByTwilioSid(twilioSid) : null;
  if (existing) {
    const tel = await resolveTelephony();
    const actionUrl = `${tel.publicBaseUrl}/webhooks/twilio/gather?callId=${encodeURIComponent(existing.id)}`;
    const greeting =
      [...(existing.messages || [])].reverse().find((m) => m.role === "assistant")?.text ||
      inbound.greeting ||
      agent.greeting ||
      "Thank you for calling. How can I help?";
    return sendTwiml(res, await spokenTwiml({ agent, say: greeting, language: resolveSpokenLanguage(existing, agent), actionUrl }));
  }
  const now = new Date().toISOString();
  const call = {
    id: `call_${uuid().slice(0, 10)}`,
    agentId: agent.id,
    agentName: agent.name,
    agentVersion: inbound.agentVersion || agent.version || 1,
    inboundId: inbound.inboundId || inbound.id || "",
    toNumber: to || inbound.phoneNumber || "",
    direction: "inbound",
    channel: "telephony",
    twilioSid,
    customer: { name: from || "Caller", phone: from },
    status: "in_progress",
    disposition: "in_progress",
    attempt: 1,
    scheduledAt: null,
    startedAt: now,
    endedAt: null,
    durationSeconds: 0,
    recordingUrl: null,
    gathered: {},
    language,
    outcomeReason: null,
    recall: { needed: false, reason: null, scheduledAt: null, attempt: 1, maxAttempts: 3 },
    createdAt: now,
    messages: [],
  };
  const greeting =
    inbound.greeting ||
    renderGreeting(agent, { name: from || "Caller", phone: from }) ||
    "Thank you for calling. How can I help?";
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "assistant",
    text: greeting,
    timestamp: now,
    audioOffsetMs: null,
  }, "telephony");
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "system",
    text: `Inbound ${from} → ${to || inbound.phoneNumber || "Zoco"}`,
    timestamp: now,
    audioOffsetMs: null,
  }, "telephony");
  await saveCall(call);
  const tel = await resolveTelephony();
  const actionUrl = `${tel.publicBaseUrl}/webhooks/twilio/gather?callId=${encodeURIComponent(call.id)}`;
  sendTwiml(res, await spokenTwiml({ agent, say: greeting, language, actionUrl, record: inbound.record !== false, callId: call.id }));
}

app.post("/webhooks/twilio/voice", async (req, res) => {
  const callId = req.query.callId || req.body?.callId;
  const call = await getCall(callId);
  const agent = call ? await getCallAgent(call) : null;
  const language = resolveSpokenLanguage(call, agent);
  const spoken = getLanguage(language);
  if (!call) return sendTwiml(res, hangupTwiml({ say: spoken.inactive, language }));
  const tel = await resolveTelephony();

  if (isMachineAnswer(req.body?.AnsweredBy) && voicemailMessage(agent)) {
    call.answeredBy = req.body.AnsweredBy;
    const rules = await getRules();
    const next = applyOutcome(call, { status: "voicemail", disposition: "voicemail", reason: `Twilio ${req.body.AnsweredBy}` }, rules);
    await saveCall(next);
    await scheduleFollowUp(next);
    return sendTwiml(res, await spokenTwiml({ agent, say: voicemailMessage(agent), language, hangup: true }));
  }

  if (callTimedOut(call, agent)) {
    const rules = await getRules();
    const next = applyOutcome(call, { status: "completed", disposition: "dropped", reason: "Max call length reached" }, rules);
    await saveCall(next);
    await scheduleFollowUp(next);
    return sendTwiml(res, await spokenTwiml({ agent, say: "Thank you for your time. Goodbye.", language, hangup: true }));
  }

  const greeting =
    [...(call.messages || [])].reverse().find((m) => m.role === "assistant")?.text ||
    renderGreeting(agent, call.customer) ||
    agent?.greeting ||
    "Hello, is now a good time?";
  if (!call.messages.some((m) => m.role === "assistant")) {
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "assistant",
      text: greeting,
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
    }, "telephony");
  }
  call.status = "in_progress";
  call.disposition = "in_progress";
  if (!call.startedAt) call.startedAt = new Date().toISOString();
  call.nudgeIndex = Number(call.nudgeIndex || 0);
  await saveCall(call);
  const actionUrl = `${tel.publicBaseUrl}/webhooks/twilio/gather?callId=${encodeURIComponent(call.id)}`;
  sendTwiml(res, await spokenTwiml({
    agent,
    say: greeting,
    language,
    actionUrl,
    silenceTimeout: nextSilenceSeconds(agent, call),
  }));
});

app.post("/webhooks/twilio/amd", async (req, res) => {
  const call = await findCallFromTwilio(req);
  if (!call) return res.sendStatus(204);
  const agent = await getCallAgent(call);
  const answeredBy = req.body?.AnsweredBy || req.body?.answeredBy;
  call.answeredBy = answeredBy;
  if (!isMachineAnswer(answeredBy) || !voicemailMessage(agent)) {
    await saveCall(call);
    return res.sendStatus(204);
  }
  const tel = await resolveTelephony();
  const rules = await getRules();
  const next = applyOutcome(call, { status: "voicemail", disposition: "voicemail", reason: `Twilio AMD ${answeredBy}` }, rules);
  await saveCall(next);
  await scheduleFollowUp(next);
  const vmUrl = `${tel.publicBaseUrl}/webhooks/twilio/voicemail?callId=${encodeURIComponent(call.id)}`;
  try {
    await redirectTwilioCall({ tel, callSid: call.twilioSid || req.body?.CallSid, url: vmUrl });
  } catch (error) {
    console.warn("Could not redirect to voicemail:", error.message);
  }
  res.sendStatus(204);
});

app.post("/webhooks/twilio/voicemail", async (req, res) => {
  const call = await findCallFromTwilio(req);
  const agent = call ? await getCallAgent(call) : null;
  const language = resolveSpokenLanguage(call, agent);
  const say = voicemailMessage(agent) || "I will call you back later. Goodbye.";
  sendTwiml(res, await spokenTwiml({ agent, say, language, hangup: true }));
});

app.post("/webhooks/twilio/gather", async (req, res) => {
  const callId = req.query.callId || req.body?.callId;
  const call = await getCall(callId);
  const tel = await resolveTelephony();
  const agent = call ? await getCallAgent(call) : null;
  const startLanguage = resolveSpokenLanguage(call, agent);
  const spokenLang = getLanguage(startLanguage);
  if (!call) return sendTwiml(res, hangupTwiml({ say: spokenLang.inactive, language: startLanguage }));
  const actionUrl = `${tel.publicBaseUrl}/webhooks/twilio/gather?callId=${encodeURIComponent(call.id)}`;

  if (callTimedOut(call, agent)) {
    const rules = await getRules();
    const next = applyOutcome(call, { status: "completed", disposition: "dropped", reason: "Max call length reached" }, rules);
    await saveCall(next);
    await scheduleFollowUp(next);
    return sendTwiml(res, await spokenTwiml({ agent, say: "Thank you for your time. Goodbye.", language: startLanguage, hangup: true }));
  }

  const spoken = await speechFromTwilio(req, startLanguage);

  if (!spoken || isNoiseTranscript(spoken, call.messages?.filter((m) => m.role === "assistant").at(-1)?.text)) {
    const action = silenceAction(call, agent, { missedFallback: spokenLang.missed });
    call.nudgeIndex = action.nextIndex;
    if (action.hangup) {
      const rules = await getRules();
      const next = applyOutcome(call, { status: "no_answer", disposition: "no_answer", reason: action.reason || "No response after nudges" }, rules);
      await saveCall(next);
      await scheduleFollowUp(next);
      return sendTwiml(res, hangupTwiml({ say: "", language: startLanguage }));
    }
    if (action.kind === "nudge" && action.text) {
      await attachTurn(call, {
        id: `msg_${uuid().slice(0, 8)}`,
        role: "assistant",
        text: action.text,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
        kind: "nudge",
      }, "telephony");
    }
    await saveCall(call);
    return sendTwiml(res, await spokenTwiml({
      agent,
      say: action.text || spokenLang.missed,
      language: startLanguage,
      actionUrl,
      silenceTimeout: action.afterSeconds || nextSilenceSeconds(agent, call),
    }));
  }

  call.nudgeIndex = 0;
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "user",
    text: spoken,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
  }, "telephony");
  const reply = await generateReply({
    agent,
    call,
    userText: spoken,
    knowledge: await knowledgeContextForAgent(agent, spoken),
    knowledgeFn: (ag, q) => knowledgeContextForAgent(ag, q),
  });
  const language = resolveSpokenLanguage(call, agent);
  call.gathered = { ...(call.gathered || {}), ...(reply.slots || {}) };
  call.llm = { provider: reply.provider, model: reply.model || null };
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "assistant",
    text: reply.text,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
    provider: reply.provider,
  }, "telephony");

  if (reply.transfer) {
    await saveCall(call);
    return sendTwiml(res, await spokenTwiml({
      agent,
      say: reply.text || "Please stay on the line.",
      language,
      transferTo: reply.transfer,
    }));
  }

  if (reply.endCall) {
    const rules = await getRules();
    const next = applyOutcome(
      call,
      {
        status: "completed",
        disposition: reply.disposition || agent.defaultSuccessDisposition,
        reason: "Agent closed the live call",
      },
      rules
    );
    await saveCall(next);
    await scheduleFollowUp(next);
    return sendTwiml(res, await spokenTwiml({ agent, say: reply.text, language, hangup: true }));
  }

  await saveCall(call);
  sendTwiml(res, await spokenTwiml({
    agent,
    say: reply.text,
    language,
    actionUrl,
    silenceTimeout: nextSilenceSeconds(agent, call),
  }));
});

app.post("/webhooks/twilio/status", async (req, res) => {
  const call = await findCallFromTwilio(req);
  if (!call) return res.sendStatus(204);
  const mapped = mapTwilioStatus(req.body?.CallStatus);
  if (!mapped) return res.sendStatus(204);

  if (mapped.status === "completed") {
    if (call.endedAt || !["queued", "ringing", "in_progress"].includes(call.status)) {
      return res.sendStatus(204);
    }
    const rules = await getRules();
    const next = applyOutcome(call, { status: "dropped", disposition: "dropped", reason: "Customer hung up" }, rules);
    await saveCall(next);
    await scheduleFollowUp(next);
    return res.sendStatus(204);
  }

  if (["busy", "no_answer", "failed"].includes(mapped.status)) {
    const rules = await getRules();
    const next = applyOutcome(call, { status: mapped.status, disposition: mapped.disposition, reason: `Twilio ${req.body?.CallStatus}` }, rules);
    await saveCall(next);
    await scheduleFollowUp(next);
    return res.sendStatus(204);
  }

  call.status = mapped.status;
  if (mapped.disposition) call.disposition = mapped.disposition;
  await saveCall(call);
  res.sendStatus(204);
});

app.post("/webhooks/twilio/recording", async (req, res) => {
  const status = String(req.body?.RecordingStatus || "completed").toLowerCase();
  if (status === "in-progress" || status === "absent") return res.sendStatus(204);
  const recordingUrl = req.body?.RecordingUrl;
  const call = await findCallFromTwilio(req);
  if (!call || !recordingUrl) return res.sendStatus(204);
  try {
    const tel = await resolveTelephony();
    const audio = await fetch(`${recordingUrl}.mp3`, {
      headers: {
        Authorization: `Basic ${Buffer.from(`${tel.accountSid}:${tel.authToken}`).toString("base64")}`,
      },
    });
    if (!audio.ok) throw new Error(`Twilio recording download failed (${audio.status})`);
    const stored = await uploadRecording({
      callId: call.id,
      buffer: Buffer.from(await audio.arrayBuffer()),
      contentType: "audio/mpeg",
      ext: "mp3",
    });
    call.recordingUrl = `/api/calls/${call.id}/recording`;
    call.recordingKey = stored.key;
    call.recordingPath = stored.path || null;
    call.recordingStorage = stored.storage;
    await attachTurn(
      call,
      {
        id: `msg_${uuid().slice(0, 8)}`,
        role: "system",
        text: `Call recording saved to ${stored.storage}`,
        timestamp: new Date().toISOString(),
        audioOffsetMs: null,
      },
      "telephony"
    );
    await saveCall(call);
  } catch (error) {
    console.error("Recording webhook failed:", error.message);
  }
  res.sendStatus(204);
});

app.post("/webhooks/twilio/whatsapp", handleWhatsApp);
app.post("/webhooks/twilio/sms", handleWhatsApp);

async function handleWhatsApp(req, res) {
  const from = whatsappFromNumber(req.body?.From);
  const to = whatsappFromNumber(req.body?.To);
  const body = String(req.body?.Body || "").trim();
  res.setHeader("Content-Type", "text/xml");
  if (!from || !body) return res.send("<Response></Response>");
  const inbound = await resolveInboundLine(to);
  const agent = inbound.enabled ? await getAgent(inbound.agentId, inbound.agentVersion) : null;
  if (!agent) {
    return res.send("<Response><Message>This WhatsApp line is not answering right now.</Message></Response>");
  }
  const existing = (await listCalls()).find(
    (item) => item.channel === "whatsapp" && normalizePhone(item.customer?.phone) === from && ["in_progress", "ringing"].includes(item.status)
  );
  const now = new Date().toISOString();
  const call = existing || {
    id: `call_${uuid().slice(0, 10)}`,
    agentId: agent.id,
    agentName: agent.name,
    agentVersion: inbound.agentVersion || agent.version || 1,
    inboundId: inbound.inboundId || inbound.id || "",
    direction: "inbound",
    channel: "whatsapp",
    customer: { name: from, phone: from },
    status: "in_progress",
    disposition: "in_progress",
    attempt: 1,
    startedAt: now,
    gathered: {},
    language: agent.language || "en-IN",
    createdAt: now,
    messages: [],
  };
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "user",
    text: body,
    timestamp: now,
    audioOffsetMs: null,
  }, "whatsapp");
  const reply = await generateReply({
    agent,
    call,
    userText: body,
    knowledge: await knowledgeContextForAgent(agent, body),
    knowledgeFn: (ag, q) => knowledgeContextForAgent(ag, q),
  });
  call.gathered = { ...(call.gathered || {}), ...(reply.slots || {}) };
  await attachTurn(call, {
    id: `msg_${uuid().slice(0, 8)}`,
    role: "assistant",
    text: reply.text,
    timestamp: new Date().toISOString(),
    audioOffsetMs: null,
    provider: reply.provider,
  }, "whatsapp");
  if (reply.endCall) {
    const next = applyOutcome(
      call,
      { status: "completed", disposition: reply.disposition || agent.defaultSuccessDisposition, reason: "WhatsApp closed" },
      await getRules()
    );
    await saveCall(next);
  } else {
    await saveCall(call);
  }
  const safe = String(reply.text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  res.send(`<Response><Message>${safe}</Message></Response>`);
}

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: error.message || "Server error" });
});

const boot = async () => {
  const infra = await connectInfra();
  await ensureStore();
  await retargetGrokAgents().catch((error) => console.warn("Grok retarget skipped:", error.message));
  startCallWorker(handleCallJob);
  const agents = await listAgents();
  if (agents.length === 0) {
    await import("./seed.js");
  }
  const server = http.createServer(app);
  mountSttStream(server);
  server.listen(PORT, () => {
    console.log(`Zoco AI API on http://localhost:${PORT}`);
  });
  const tel = await resolveTelephony();
  console.log(
    `Infra mongo=${infra.mongo} redis=${infra.redis} s3=${infra.s3} queue=${infra.queue}`
  );
  if (tel.twilioReady) {
    console.log(`Live calling ready: ${tel.fromNumber} → webhooks at ${tel.publicBaseUrl}`);
  } else {
    console.log("Live calling: add Twilio SID, auth token, From number, then start ngrok on 8787.");
  }
};

boot().catch((error) => {
  console.error(error.message || error);
  process.exit(1);
});
