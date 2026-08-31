import { v4 as uuid } from "uuid";
import { generateAgentFromPrompt, reviseAgentFromPrompt } from "../engine/generate.js";
import { dashboardStats } from "../engine/rules.js";
import { buildAnalytics, timeSeries } from "../engine/analytics.js";
import {
  ensureCampaignShape,
  ensureInboundShape,
  formatSchedule,
  isDndListed,
  parseContactRows,
  publicCampaign,
  publicInboundCall,
  retryBreakdown,
  toLegacyInbound,
} from "../engine/deploy.js";
import { normalizeLanguage } from "../languages.js";
import { normalizePhone } from "../phone.js";
import { queueOrDial } from "../services/calling.js";
import {
  deleteCampaign,
  deleteInboundDeployment,
  deleteKnowledgeBase,
  getAgent,
  getCampaign,
  getDnd,
  getInbound,
  getInboundById,
  getKnowledgeBase,
  listAgents,
  listCalls,
  listCallsByCampaign,
  listCallsByDirection,
  listCallsByInbound,
  listCampaigns,
  listInbounds,
  listKnowledgeBases,
  saveAgent,
  saveCall,
  saveCampaign,
  saveDnd,
  saveInbound,
  saveInboundDeployment,
  saveKnowledgeBase,
} from "../store.js";
import { inboundLineStatus, publicTelephony, resolveTelephony, syncInboundWebhook } from "../telephony/index.js";
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

  async function decorateInbound(item, tel, line) {
    const shaped = ensureInboundShape(item, tel);
    const live = Boolean(shaped.status === "live" && shaped.agentId && tel.exotelReady && line.wired);
    return {
      ...shaped,
      scheduleLabel: formatSchedule(shaped.schedule),
      phoneNumber: shaped.phoneNumber || tel.fromNumber || "",
      telephony: publicTelephony(tel),
      line,
      live,
    };
  }

  async function seedInbounds(tel) {
    const existing = await listInbounds();
    if (existing.length) return existing.map((item) => ensureInboundShape(item, tel));
    const legacy = await getInbound();
    if (!legacy.agentId && !legacy.phoneNumber && !legacy.enabled) return [];
    const agent = legacy.agentId ? await getAgent(legacy.agentId) : null;
    const seeded = await saveInboundDeployment(ensureInboundShape({
      id: `inb_${uuid().slice(0, 8)}`,
      name: agent?.name ? `${agent.name} inbound` : "Inbound",
      agentId: legacy.agentId,
      agentName: agent?.name || "",
      phoneNumber: legacy.phoneNumber || tel.fromNumber || "",
      greeting: legacy.greeting,
      record: legacy.record,
      enabled: legacy.enabled,
      status: legacy.enabled ? "live" : "paused",
      createdAt: legacy.updatedAt || new Date().toISOString(),
    }, tel));
    return [seeded];
  }

  async function wireInbound(enabled) {
    const tel = await resolveTelephony();
    let line = await inboundLineStatus(tel);
    if (tel.exotelReady) {
      try {
        const synced = await syncInboundWebhook(tel);
        line = await inboundLineStatus(tel);
        if (synced.error) line = { ...line, error: synced.error };
      } catch (error) {
        line = { ...(line || {}), wired: false, error: error.message };
        if (enabled) throw error;
      }
    }
    if (enabled && !line.wired) {
      throw new Error(line.error || "Connect Exotel and configure inbound in the Exotel dashboard.");
    }
    return { tel, line };
  }

  app.get("/api/inbound", async (_req, res) => {
    const inbound = await getInbound();
    const tel = await resolveTelephony();
    const line = await inboundLineStatus(tel);
    const live = Boolean(inbound.enabled && inbound.agentId && tel.exotelReady && line.wired);
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
    try {
      const { tel, line } = await wireInbound(enabled);
      const saved = await saveInbound({
        ...current,
        ...req.body,
        enabled,
        agentId,
        phoneNumber: normalizePhone(req.body?.phoneNumber || current.phoneNumber || tel.fromNumber),
      });
      const live = Boolean(saved.enabled && saved.agentId && tel.exotelReady && line.wired);
      res.json({ ...saved, telephony: publicTelephony(tel), line, live });
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/inbounds", async (_req, res) => {
    const tel = await resolveTelephony();
    const line = await inboundLineStatus(tel);
    const items = await seedInbounds(tel);
    res.json(await Promise.all(items.map((item) => decorateInbound(item, tel, line))));
  });

  app.post("/api/inbounds", async (req, res) => {
    const agent = await getAgent(req.body?.agentId);
    if (!agent) return res.status(400).json({ error: "Choose an agent first" });
    const tel = await resolveTelephony();
    const line = await inboundLineStatus(tel);
    const now = new Date().toISOString();
    const saved = await saveInboundDeployment(ensureInboundShape({
      id: `inb_${uuid().slice(0, 8)}`,
      name: req.body?.name || `${agent.name} inbound`,
      agentId: agent.id,
      agentName: agent.name,
      phoneNumber: normalizePhone(req.body?.phoneNumber || tel.fromNumber),
      agentVersion: req.body?.agentVersion || agent.version || 1,
      greeting: req.body?.greeting || agent.greeting || "",
      status: "paused",
      enabled: false,
      schedule: req.body?.schedule,
      createdAt: now,
    }, tel));
    res.status(201).json(await decorateInbound(saved, tel, line));
  });

  app.get("/api/inbounds/:id", async (req, res) => {
    const tel = await resolveTelephony();
    const line = await inboundLineStatus(tel);
    const item = await getInboundById(req.params.id);
    if (!item) return res.status(404).json({ error: "Inbound not found" });
    const inbound = await decorateInbound(item, tel, line);
    const calls = await listCallsByInbound(item.id);
    const fallback = calls.length ? calls : (await listCallsByDirection("inbound"))
      .filter((call) => call.agentId === item.agentId || call.toNumber === inbound.phoneNumber)
      .slice(0, 20);
    res.json({
      ...inbound,
      recentCalls: fallback.map((call) => publicInboundCall(call, inbound.phoneNumber)),
    });
  });

  app.put("/api/inbounds/:id", async (req, res) => {
    const existing = await getInboundById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Inbound not found" });
    const tel = await resolveTelephony();
    const line = await inboundLineStatus(tel);
    const agent = req.body?.agentId ? await getAgent(req.body.agentId) : null;
    const saved = await saveInboundDeployment(ensureInboundShape({
      ...existing,
      ...req.body,
      id: existing.id,
      agentName: agent?.name || existing.agentName,
      phoneNumber: normalizePhone(req.body?.phoneNumber || existing.phoneNumber || tel.fromNumber),
    }, tel));
    res.json(await decorateInbound(saved, tel, line));
  });

  app.post("/api/inbounds/:id/resume", async (req, res) => {
    const existing = await getInboundById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Inbound not found" });
    if (!existing.agentId) return res.status(400).json({ error: "Assign an agent before going live" });
    try {
      const { tel, line } = await wireInbound(true);
      const others = await listInbounds();
      for (const item of others) {
        if (item.id === existing.id) continue;
        if (item.status === "live") {
          await saveInboundDeployment({ ...item, status: "paused", enabled: false, pausedAt: new Date().toISOString() });
        }
      }
      const saved = await saveInboundDeployment({
        ...ensureInboundShape(existing, tel),
        status: "live",
        enabled: true,
        pausedAt: null,
      });
      await saveInbound(toLegacyInbound(saved));
      res.json(await decorateInbound(saved, tel, line));
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.post("/api/inbounds/:id/pause", async (req, res) => {
    const existing = await getInboundById(req.params.id);
    if (!existing) return res.status(404).json({ error: "Inbound not found" });
    const tel = await resolveTelephony();
    const line = await inboundLineStatus(tel);
    const saved = await saveInboundDeployment({
      ...ensureInboundShape(existing, tel),
      status: "paused",
      enabled: false,
      pausedAt: new Date().toISOString(),
    });
    await saveInbound(toLegacyInbound(saved));
    res.json(await decorateInbound(saved, tel, line));
  });

  app.delete("/api/inbounds/:id", async (req, res) => {
    await deleteInboundDeployment(req.params.id);
    res.json({ ok: true });
  });

  app.get("/api/dnd", async (_req, res) => {
    res.json(await getDnd());
  });

  app.put("/api/dnd", async (req, res) => {
    res.json(await saveDnd(req.body));
  });

  app.get("/api/campaigns/overview", async (req, res) => {
    const hours = Number(req.query.hours || 24);
    const [campaigns, calls] = await Promise.all([listCampaigns(), listCalls()]);
    const outbound = calls.filter((call) => call.direction !== "inbound");
    res.json({
      hours,
      total: outbound.filter((call) => {
        const time = Date.parse(call.startedAt || call.createdAt || 0);
        return time && time >= Date.now() - hours * 3600000;
      }).length,
      activity: timeSeries(outbound, { hours, grainMinutes: 60 }),
      concurrency: timeSeries(outbound, { hours, grainMinutes: 60 }),
      campaigns: campaigns.map((campaign) => ensureCampaignShape(campaign)),
    });
  });

  app.get("/api/campaigns", async (_req, res) => {
    const campaigns = await listCampaigns();
    res.json(campaigns.map((campaign) => ensureCampaignShape(campaign)));
  });

  app.post("/api/campaigns", async (req, res) => {
    const agent = await getAgent(req.body?.agentId);
    if (!agent) return res.status(400).json({ error: "Choose an agent first" });
    const now = new Date().toISOString();
    const parsed = parseContactRows(req.body?.contacts || [], req.body?.columnMap);
    const campaign = await saveCampaign(ensureCampaignShape({
      id: `cmp_${uuid().slice(0, 8)}`,
      name: req.body?.name || `${agent.name} campaign`,
      agentId: agent.id,
      agentName: agent.name,
      agentVersion: req.body?.agentVersion || agent.version || 1,
      language: normalizeLanguage(req.body?.language || agent.language),
      status: "draft",
      concurrency: Number(req.body?.concurrency || 1),
      columnMap: req.body?.columnMap && typeof req.body.columnMap === "object" ? req.body.columnMap : {},
      schedule: req.body?.schedule,
      contacts: parsed.valid,
      launchedAt: null,
      createdAt: now,
      updatedAt: now,
    }));
    res.status(201).json(campaign);
  });

  app.get("/api/campaigns/:id", async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const hours = Number(req.query.hours || 24);
    const grain = req.query.grain === "minute" ? 1 : 60;
    const calls = await listCallsByCampaign(campaign.id);
    const shaped = publicCampaign(campaign, calls);
    res.json({
      ...shaped,
      scheduleLabel: formatSchedule(shaped.schedule),
      activity: timeSeries(calls, { hours, grainMinutes: grain }),
      dash: dashboardStats(calls),
    });
  });

  app.put("/api/campaigns/:id", async (req, res) => {
    const existing = await getCampaign(req.params.id);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    const next = ensureCampaignShape({ ...existing, ...req.body, id: existing.id });
    if (Array.isArray(req.body?.contacts)) next.contacts = parseContactRows(req.body.contacts).valid;
    if (Array.isArray(req.body?.cohorts)) next.cohorts = req.body.cohorts;
    res.json(await saveCampaign(next));
  });

  app.post("/api/campaigns/:id/cohorts", async (req, res) => {
    const existing = await getCampaign(req.params.id);
    if (!existing) return res.status(404).json({ error: "Campaign not found" });
    const shaped = ensureCampaignShape(existing);
    const parsed = parseContactRows((req.body?.contacts || []).map((row) => ({ ...row })), existing.columnMap);
    const cohort = {
      id: `coh_${uuid().slice(0, 8)}`,
      name: req.body?.name || `cohort_${(shaped.cohorts.length + 1).toString().padStart(2, "0")}`,
      status: "completed",
      validRecords: parsed.valid.length,
      invalidRecords: parsed.invalid.length,
      uploadedAt: new Date().toISOString(),
      contacts: parsed.valid.map((row) => ({ ...row, cohortId: undefined })),
    };
    cohort.contacts = parsed.valid.map((row) => ({ ...row, cohortId: cohort.id }));
    shaped.cohorts = [...shaped.cohorts, cohort];
    const saved = await saveCampaign(ensureCampaignShape(shaped));
    res.status(201).json(saved);
  });

  app.get("/api/campaigns/:id/retries", async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const calls = await listCallsByCampaign(campaign.id);
    const cohortId = req.query.cohortId || "";
    const subset = cohortId
      ? calls.filter((call) => call.cohortId === cohortId || call.customer?.cohortId === cohortId)
      : calls;
    res.json({
      cohortId,
      numbers: subset.length,
      breakdown: retryBreakdown(subset),
    });
  });

  app.delete("/api/campaigns/:id", async (req, res) => {
    await deleteCampaign(req.params.id);
    res.json({ ok: true });
  });

  async function launchCampaign(req, res) {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    const shaped = ensureCampaignShape(campaign);
    const agent = await getAgent(shaped.agentId, shaped.agentVersion);
    if (!agent) return res.status(400).json({ error: "Campaign agent is missing" });
    const now = new Date().toISOString();
    const tel = await resolveTelephony();
    const dnd = await getDnd();
    const existingCalls = await listCallsByCampaign(shaped.id);
    const already = new Set(existingCalls.map((call) => normalizePhone(call.customer?.phone)));
    const created = [];
    for (const row of shaped.contacts || []) {
      if (isDndListed(row.phone, dnd.numbers)) continue;
      if (already.has(normalizePhone(row.phone))) continue;
      const call = {
        id: `call_${uuid().slice(0, 10)}`,
        agentId: agent.id,
        agentName: agent.name,
        agentVersion: shaped.agentVersion || agent.version || 1,
        campaignId: shaped.id,
        campaignName: shaped.name,
        cohortId: row.cohortId || "",
        direction: "outbound",
        channel: "voice",
        customer: { name: row.name, phone: row.phone, notes: row.notes || "", ...(row.vars || {}) },
        status: "queued",
        disposition: "in_progress",
        attempt: 1,
        scheduledAt: now,
        startedAt: null,
        endedAt: null,
        durationSeconds: 0,
        recordingUrl: null,
        gathered: { ...(row.vars || {}), name: row.name, phone: row.phone },
        language: shaped.language || agent.language,
        outcomeReason: null,
        recall: { needed: false, reason: null, scheduledAt: null, attempt: 1, maxAttempts: 3 },
        createdAt: now,
        messages: [
          {
            id: `msg_${uuid().slice(0, 8)}`,
            role: "system",
            text: `Campaign ${shaped.name} · queued ${row.phone}`,
            timestamp: now,
            audioOffsetMs: 0,
          },
        ],
      };
      await saveCall(call);
      already.add(normalizePhone(row.phone));
      if (!tel.exotelReady) {
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
    shaped.status = "running";
    shaped.launchedAt = shaped.launchedAt || now;
    shaped.pausedAt = null;
    await saveCampaign(shaped);
    res.json({ campaign: shaped, calls: created });
  }

  app.post("/api/campaigns/:id/launch", launchCampaign);
  app.post("/api/campaigns/:id/resume", launchCampaign);

  app.post("/api/campaigns/:id/pause", async (req, res) => {
    const campaign = await getCampaign(req.params.id);
    if (!campaign) return res.status(404).json({ error: "Campaign not found" });
    campaign.status = "paused";
    campaign.pausedAt = new Date().toISOString();
    res.json(await saveCampaign(ensureCampaignShape(campaign)));
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
