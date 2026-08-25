import { v4 as uuid } from "uuid";
import { generateAgentFromPrompt, reviseAgentFromPrompt } from "../engine/generate.js";
import { dashboardStats } from "../engine/rules.js";
import { buildAnalytics } from "../engine/analytics.js";
import { normalizeLanguage } from "../languages.js";
import { normalizePhone } from "../phone.js";
import { queueOrDial } from "../services/calling.js";
import {
  deleteCampaign,
  deleteKnowledgeBase,
  getAgent,
  getCampaign,
  getInbound,
  getKnowledgeBase,
  listAgents,
  listCalls,
  listCallsByCampaign,
  listCampaigns,
  listKnowledgeBases,
  saveAgent,
  saveCall,
  saveCampaign,
  saveInbound,
  saveKnowledgeBase,
} from "../store.js";
import { inboundLineStatus, publicTelephony, resolveTelephony, syncInboundWebhook } from "../telephony/twilio.js";
import { documentBytes, fileKind, knowledgeStats, retrieveFromKnowledge } from "../engine/knowledge.js";

function textFromUpload(file) {
  const name = file?.originalname || "document.txt";
  const raw = Buffer.isBuffer(file?.buffer) ? file.buffer.toString("utf8") : "";
  return { name, text: raw.replace(/\u0000/g, "").slice(0, 80_000) };
}

function publicKnowledge(kb) {
  if (!kb) return kb;
  const documents = (kb.documents || []).map((doc) => ({
    ...doc,
    kind: doc.kind || fileKind(doc.name),
    bytes: documentBytes(doc),
    status: doc.status || "ready",
  }));
  return { ...kb, documents, stats: knowledgeStats({ ...kb, documents }) };
}

export function mountProductRoutes(app, { upload } = {}) {
  app.post("/api/agents/generate", async (req, res) => {
    const prompt = String(req.body?.prompt || "").trim();
    if (prompt.length < 8) {
      return res.status(400).json({ error: "Describe what the voice agent should do" });
    }
    const draft = await generateAgentFromPrompt(prompt);
    const now = new Date().toISOString();
    const agent = await saveAgent({
      ...draft,
      id: `agt_${uuid().slice(0, 8)}`,
      language: normalizeLanguage(draft.language),
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json(agent);
  });

  app.post("/api/agents/:id/assist", async (req, res) => {
    const existing = await getAgent(req.params.id);
    if (!existing) return res.status(404).json({ error: "Agent not found" });
    const prompt = String(req.body?.prompt || "").trim();
    if (!prompt) return res.status(400).json({ error: "Say what you want to change" });
    const draft = { ...existing, ...(req.body?.agent && typeof req.body.agent === "object" ? req.body.agent : {}) };
    try {
      const result = await reviseAgentFromPrompt(draft, prompt);
      res.json(result);
    } catch (error) {
      res.status(400).json({ error: error.message || "Genie could not update this agent" });
    }
  });

  app.get("/api/knowledge", async (_req, res) => {
    res.json((await listKnowledgeBases()).map(publicKnowledge));
  });

  app.get("/api/knowledge/:id", async (req, res) => {
    const kb = await getKnowledgeBase(req.params.id);
    if (!kb) return res.status(404).json({ error: "Knowledge base not found" });
    res.json(publicKnowledge(kb));
  });

  app.post("/api/knowledge", async (req, res) => {
    const now = new Date().toISOString();
    const kb = await saveKnowledgeBase({
      id: `kb_${uuid().slice(0, 8)}`,
      name: req.body?.name || "Untitled knowledge",
      description: req.body?.description || "",
      documents: [],
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json(publicKnowledge(kb));
  });

  app.put("/api/knowledge/:id", async (req, res) => {
    const existing = await getKnowledgeBase(req.params.id);
    if (!existing) return res.status(404).json({ error: "Knowledge base not found" });
    res.json(publicKnowledge(await saveKnowledgeBase({
      ...existing,
      ...req.body,
      id: existing.id,
      documents: Array.isArray(req.body?.documents) ? req.body.documents : existing.documents,
    })));
  });

  app.delete("/api/knowledge/:id", async (req, res) => {
    await deleteKnowledgeBase(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/knowledge/:id/documents", upload?.array?.("file", 12) || ((req, _res, next) => next()), async (req, res) => {
    const kb = await getKnowledgeBase(req.params.id);
    if (!kb) return res.status(404).json({ error: "Knowledge base not found" });
    const files = Array.isArray(req.files) ? req.files : req.file ? [req.file] : [];
    const pasted = String(req.body?.text || "").trim();
    const added = [];
    for (const file of files) {
      const parsed = textFromUpload(file);
      if (!parsed.text) continue;
      added.push({
        id: `doc_${uuid().slice(0, 8)}`,
        name: parsed.name,
        text: parsed.text,
        kind: fileKind(parsed.name),
        bytes: Buffer.byteLength(parsed.text, "utf8"),
        status: "ready",
        createdAt: new Date().toISOString(),
      });
    }
    if (pasted) {
      const name = String(req.body?.name || "Note").trim() || "Note";
      added.push({
        id: `doc_${uuid().slice(0, 8)}`,
        name,
        text: pasted.slice(0, 80_000),
        kind: fileKind(name),
        bytes: Buffer.byteLength(pasted, "utf8"),
        status: "ready",
        createdAt: new Date().toISOString(),
      });
    }
    if (!added.length) return res.status(400).json({ error: "Paste text or upload a .txt / .md / .csv file" });
    kb.documents = [...(kb.documents || []), ...added];
    res.status(201).json(publicKnowledge(await saveKnowledgeBase(kb)));
  });

  app.post("/api/knowledge/:id/query", async (req, res) => {
    const kb = await getKnowledgeBase(req.params.id);
    if (!kb) return res.status(404).json({ error: "Knowledge base not found" });
    const question = String(req.body?.question || "").trim();
    if (question.length < 3) return res.status(400).json({ error: "Ask a question to test retrieval" });
    res.json({
      question,
      matches: retrieveFromKnowledge(kb, question),
      stats: knowledgeStats(kb),
    });
  });

  app.delete("/api/knowledge/:id/documents/:docId", async (req, res) => {
    const kb = await getKnowledgeBase(req.params.id);
    if (!kb) return res.status(404).json({ error: "Knowledge base not found" });
    kb.documents = (kb.documents || []).filter((doc) => doc.id !== req.params.docId);
    res.json(publicKnowledge(await saveKnowledgeBase(kb)));
  });

  app.get("/api/inbound", async (_req, res) => {
    const inbound = await getInbound();
    const tel = await resolveTelephony();
    const line = await inboundLineStatus(tel);
    const live = Boolean(inbound.enabled && inbound.agentId && tel.twilioReady && line.wired);
    res.json({
      ...inbound,
      phoneNumber: inbound.phoneNumber || tel.fromNumber || "",
      telephony: publicTelephony(tel),
      line,
      live,
    });
  });

  app.put("/api/inbound", async (req, res) => {
    const current = await getInbound();
    const agentId = req.body?.agentId || current.agentId;
    const enabled = req.body?.enabled ?? current.enabled;
    if (enabled && !agentId) {
      return res.status(400).json({ error: "Choose an agent before turning inbound answering on" });
    }
    if (agentId) {
      const agent = await getAgent(agentId);
      if (!agent) return res.status(400).json({ error: "Choose an existing agent" });
    }
    const tel = await resolveTelephony();
    let line = await inboundLineStatus(tel);
    if (tel.twilioReady) {
      try {
        const synced = await syncInboundWebhook(tel);
        line = await inboundLineStatus(tel);
        if (synced.error) line = { ...line, error: synced.error };
      } catch (error) {
        line = { ...(line || {}), wired: false, error: error.message };
        if (enabled) {
          return res.status(400).json({ error: error.message });
        }
      }
    }
    if (enabled && !line.wired) {
      return res.status(400).json({
        error: line.error || "Could not point this Twilio number at the inbound webhook. Check ngrok and Twilio credentials.",
      });
    }
    const saved = await saveInbound({
      ...current,
      ...req.body,
      enabled,
      agentId,
      phoneNumber: normalizePhone(req.body?.phoneNumber || current.phoneNumber || tel.fromNumber),
    });
    const live = Boolean(saved.enabled && saved.agentId && tel.twilioReady && line.wired);
    res.json({ ...saved, telephony: publicTelephony(tel), line, live });
  });

  app.get("/api/campaigns", async (_req, res) => {
    const campaigns = await listCampaigns();
    res.json(campaigns);
  });

  app.post("/api/campaigns", async (req, res) => {
    const agent = await getAgent(req.body?.agentId);
    if (!agent) return res.status(400).json({ error: "Choose an agent first" });
    const now = new Date().toISOString();
    const contacts = Array.isArray(req.body?.contacts) ? req.body.contacts : [];
    const campaign = await saveCampaign({
      id: `cmp_${uuid().slice(0, 8)}`,
      name: req.body?.name || `${agent.name} campaign`,
      agentId: agent.id,
      agentName: agent.name,
      language: normalizeLanguage(req.body?.language || agent.language),
      status: "draft",
      concurrency: Number(req.body?.concurrency || 1),
      contacts: contacts.map((item) => ({
        id: item.id || `row_${uuid().slice(0, 6)}`,
        name: item.name || "Customer",
        phone: normalizePhone(item.phone),
        notes: item.notes || "",
      })).filter((item) => item.phone),
      launchedAt: null,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json(campaign);
  });

  app.get("/api/campaigns/:id", async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const calls = await listCallsByCampaign(campaign.id);
    res.json({ ...campaign, calls, stats: dashboardStats(calls) });
  });

  app.put("/api/campaigns/:id", async (req, res) => {
    const existing = await getCampaign(req.params.id);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    const next = { ...existing, ...req.body, id: existing.id };
    if (Array.isArray(req.body?.contacts)) {
      next.contacts = req.body.contacts
        .map((item) => ({
          id: item.id || `row_${uuid().slice(0, 6)}`,
          name: item.name || "Customer",
          phone: normalizePhone(item.phone),
          notes: item.notes || "",
        }))
        .filter((item) => item.phone);
    }
    res.json(await saveCampaign(next));
  });

  app.delete("/api/campaigns/:id", async (req, res) => {
    await deleteCampaign(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/campaigns/:id/launch", async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const agent = await getAgent(campaign.agentId);
    if (!agent) return res.status(400).json({ error: "Campaign agent is missing" });
    const now = new Date().toISOString();
    const tel = await resolveTelephony();
    const created = [];
    for (const row of campaign.contacts || []) {
      const call = {
        id: `call_${uuid().slice(0, 10)}`,
        agentId: agent.id,
        agentName: agent.name,
        campaignId: campaign.id,
        campaignName: campaign.name,
        direction: "outbound",
        channel: "voice",
        customer: { name: row.name, phone: row.phone, notes: row.notes || "" },
        status: "queued",
        disposition: "in_progress",
        attempt: 1,
        scheduledAt: now,
        startedAt: null,
        endedAt: null,
        durationSeconds: 0,
        recordingUrl: null,
        gathered: {},
        language: campaign.language || agent.language,
        outcomeReason: null,
        recall: { needed: false, reason: null, scheduledAt: null, attempt: 1, maxAttempts: 3 },
        createdAt: now,
        messages: [
          {
            id: `msg_${uuid().slice(0, 8)}`,
            role: "system",
            text: `Campaign ${campaign.name} · queued ${row.phone}`,
            timestamp: now,
            audioOffsetMs: 0,
          },
        ],
      };
      await saveCall(call);
      if (!tel.twilioReady) {
        created.push(call);
        continue;
      }
      try {
        created.push(await queueOrDial(call));
      } catch (error) {
        call.status = "failed";
        call.disposition = "failed";
        call.outcomeReason = error.message;
        created.push(await saveCall(call));
      }
    }
    campaign.status = "running";
    campaign.launchedAt = now;
    await saveCampaign(campaign);
    res.json({ campaign, calls: created });
  });

  app.post("/api/campaigns/:id/pause", async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    campaign.status = "paused";
    res.json(await saveCampaign(campaign));
  });

  app.get("/api/analytics", async (req, res) => {
    const [calls, agents, campaigns] = await Promise.all([
      listCalls(),
      listAgents(),
      listCampaigns(),
    ]);
    const from = req.query.from ? Date.parse(`${req.query.from}T00:00:00+05:30`) : Date.now() - 6 * 86400000;
    const to = req.query.to ? Date.parse(`${req.query.to}T23:59:59.999+05:30`) : Date.now();
    res.json(buildAnalytics({
      calls,
      agents,
      campaigns,
      from: Number.isNaN(from) ? undefined : from,
      to: Number.isNaN(to) ? undefined : to,
      agentId: req.query.agentId || "",
      campaignId: req.query.campaignId || "",
    }));
  });

  app.get("/api/usage", async (_req, res) => {
    const calls = await listCalls();
    const minutes = Math.round(calls.reduce((sum, call) => sum + Number(call.durationSeconds || 0), 0) / 60);
    const live = calls.filter((call) => ["queued", "ringing", "in_progress"].includes(call.status)).length;
    res.json({
      calls: calls.length,
      minutes,
      live,
      recordings: calls.filter((call) => call.recordingUrl).length,
      plan: "builder",
      includedMinutes: 500,
    });
  });
}
