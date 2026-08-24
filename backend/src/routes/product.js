import { v4 as uuid } from "uuid";
import { generateAgentFromPrompt } from "../engine/generate.js";
import { dashboardStats } from "../engine/rules.js";
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
  listContacts,
  listKnowledgeBases,
  saveAgent,
  saveCall,
  saveCampaign,
  saveInbound,
  saveKnowledgeBase,
} from "../store.js";
import { inboundLineStatus, publicTelephony, resolveTelephony, syncInboundWebhook } from "../telephony/twilio.js";

function textFromUpload(file) {
  const name = file?.originalname || "document.txt";
  const raw = Buffer.isBuffer(file?.buffer) ? file.buffer.toString("utf8") : "";
  return { name, text: raw.replace(/\u0000/g, "").slice(0, 80_000) };
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

  app.get("/api/knowledge", async (_req, res) => {
    res.json(await listKnowledgeBases());
  });

  app.get("/api/knowledge/:id", async (req, res) => {
    const kb = await getKnowledgeBase(req.params.id);
    if (!kb) return res.status(404).json({ error: "Knowledge base not found" });
    res.json(kb);
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
    res.status(201).json(kb);
  });

  app.put("/api/knowledge/:id", async (req, res) => {
    const existing = await getKnowledgeBase(req.params.id);
    if (!existing) return res.status(404).json({ error: "Knowledge base not found" });
    res.json(await saveKnowledgeBase({ ...existing, ...req.body, id: existing.id }));
  });

  app.delete("/api/knowledge/:id", async (req, res) => {
    await deleteKnowledgeBase(req.params.id);
    res.json({ ok: true });
  });

  app.post("/api/knowledge/:id/documents", upload?.single?.("file") || ((req, _res, next) => next()), async (req, res) => {
    const kb = await getKnowledgeBase(req.params.id);
    if (!kb) return res.status(404).json({ error: "Knowledge base not found" });
    const file = req.file;
    const pasted = String(req.body?.text || "").trim();
    const name = String(req.body?.name || file?.originalname || "Note").trim();
    let text = pasted;
    if (file?.buffer) text = textFromUpload(file).text || pasted;
    if (!text) return res.status(400).json({ error: "Paste text or upload a .txt / .md / .csv file" });
    kb.documents = [
      ...(kb.documents || []),
      { id: `doc_${uuid().slice(0, 8)}`, name, text, createdAt: new Date().toISOString() },
    ];
    res.status(201).json(await saveKnowledgeBase(kb));
  });

  app.delete("/api/knowledge/:id/documents/:docId", async (req, res) => {
    const kb = await getKnowledgeBase(req.params.id);
    if (!kb) return res.status(404).json({ error: "Knowledge base not found" });
    kb.documents = (kb.documents || []).filter((doc) => doc.id !== req.params.docId);
    res.json(await saveKnowledgeBase(kb));
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

  app.get("/api/analytics", async (_req, res) => {
    const [calls, agents, campaigns, contacts] = await Promise.all([
      listCalls(),
      listAgents(),
      listCampaigns(),
      listContacts(),
    ]);
    const byAgent = agents.map((agent) => {
      const subset = calls.filter((call) => call.agentId === agent.id);
      return {
        id: agent.id,
        name: agent.name,
        direction: agent.direction,
        ...dashboardStats(subset),
      };
    });
    const dispositions = {};
    for (const call of calls) {
      const key = call.disposition || call.status || "unknown";
      dispositions[key] = (dispositions[key] || 0) + 1;
    }
    const days = {};
    for (const call of calls) {
      const day = String(call.startedAt || call.createdAt || "").slice(0, 10);
      if (!day) continue;
      days[day] = days[day] || { calls: 0, success: 0 };
      days[day].calls += 1;
      if (["success", "qualified", "booked"].includes(call.disposition)) days[day].success += 1;
    }
    res.json({
      overview: dashboardStats(calls),
      byAgent,
      dispositions,
      days: Object.entries(days)
        .sort(([a], [b]) => a.localeCompare(b))
        .slice(-14)
        .map(([date, value]) => ({ date, ...value })),
      campaigns: campaigns.length,
      contacts: contacts.length,
    });
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
