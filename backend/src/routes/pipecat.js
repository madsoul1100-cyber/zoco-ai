import {
  buildSessionSnapshot,
  handleSessionEvent,
  handleSessionTool,
  handleSessionTurn,
} from "../engine/livekitSession.js";
import { getCall, getCallAgent, saveCall } from "../store.js";
import {
  agentUsesPipecat,
  pipecatBridgeAuthorized,
  pipecatConfig,
  pipecatReady,
  publicPipecatStatus,
  startPipecatWebSession,
  stopPipecatSession,
} from "../services/pipecat.js";
import {
  PipecatCloudError,
  createAgent,
  createBuild,
  deleteAgent,
  deleteSecret,
  deleteSecretSet,
  getAgent,
  getAgentLogs,
  getBuild,
  getBuildLogs,
  getProperties,
  getPropertiesSchema,
  getSecretSet,
  getSession,
  getUploadUrl,
  listAgents,
  listBuilds,
  listRegions,
  listSecrets,
  listSessions,
  pipecatCloudConfig,
  sessionProxy,
  startConfiguredSession,
  stopSession,
  updateAgent,
  updateProperties,
  upsertSecretSet,
} from "../services/pipecatCloud.js";

function unauthorized(_req, res) {
  return res.status(401).json({ error: "Pipecat bridge token required" });
}

function queryFrom(req) {
  return { ...(req.query || {}) };
}

async function sendCloud(res, fn) {
  try {
    const data = await fn();
    if (data && typeof data === "object" && "status" in data && "body" in data && "text" in data) {
      const status = Number(data.status) || 200;
      if (data.body != null && typeof data.body === "object") return res.status(status).json(data.body);
      if (typeof data.text === "string" && data.text) return res.status(status).type("text/plain").send(data.text);
      return res.status(status).end();
    }
    res.json(data ?? {});
  } catch (error) {
    const status = error instanceof PipecatCloudError ? error.status : 400;
    res.status(status || 400).json({
      error: error.message,
      ...(error.code ? { code: error.code } : {}),
    });
  }
}

export function mountPipecatRoutes(app) {
  app.get("/api/pipecat/status", (_req, res) => {
    res.json(publicPipecatStatus());
  });

  app.post("/api/pipecat/calls/:callId/session", async (req, res) => {
    if (!pipecatReady()) {
      return res.status(503).json({ error: "Pipecat is not configured" });
    }
    try {
      const call = await getCall(req.params.callId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      const agent = await getCallAgent(call);
      if (!agent) return res.status(400).json({ error: "Agent not found" });
      if (!agentUsesPipecat(agent)) {
        return res.status(409).json({ error: "This agent is not set to Pipecat. Switch Voice stack to Pipecat." });
      }
      const session = await startPipecatWebSession(call, agent);
      call.channel = call.channel || "voice";
      call.runtime = "pipecat";
      call.pipecat = {
        ...(call.pipecat || {}),
        channel: "web",
        transport: session.transport,
        mode: session.mode,
        sessionId: session.sessionId || call.pipecat?.sessionId || "",
        roomUrl: session.dailyRoom || call.pipecat?.roomUrl || "",
      };
      if (call.status === "ringing") {
        call.status = "in_progress";
        call.disposition = "in_progress";
        if (!call.startedAt) call.startedAt = new Date().toISOString();
      }
      await saveCall(call);
      res.json(session);
    } catch (error) {
      const status = error instanceof PipecatCloudError ? error.status : 400;
      res.status(status || 400).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    }
  });

  app.delete("/api/pipecat/calls/:callId/session", async (req, res) => {
    try {
      const call = await getCall(req.params.callId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      const result = await stopPipecatSession(call);
      if (call.pipecat) {
        call.pipecat = { ...call.pipecat, stoppedAt: new Date().toISOString() };
        await saveCall(call);
      }
      res.json(result);
    } catch (error) {
      const status = error instanceof PipecatCloudError ? error.status : 400;
      res.status(status || 400).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
    }
  });

  app.get("/api/pipecat/sessions/:callId/snapshot", async (req, res) => {
    if (!pipecatBridgeAuthorized(req)) return unauthorized(req, res);
    try {
      res.json(await buildSessionSnapshot(req.params.callId));
    } catch (error) {
      res.status(error.message === "Call not found" ? 404 : 400).json({ error: error.message });
    }
  });

  app.post("/api/pipecat/sessions/:callId/turn", async (req, res) => {
    if (!pipecatBridgeAuthorized(req)) return unauthorized(req, res);
    const userText = String(req.body?.userText || "").trim();
    const eventId = String(req.body?.eventId || "").trim();
    if (!eventId || !userText) {
      return res.status(400).json({ error: "eventId and userText are required" });
    }
    try {
      res.json(await handleSessionTurn(req.params.callId, {
        eventId,
        userText,
        sttLanguage: req.body?.sttLanguage || null,
      }));
    } catch (error) {
      res.status(error.message === "Call not found" ? 404 : 400).json({ error: error.message });
    }
  });

  app.post("/api/pipecat/sessions/:callId/tools", async (req, res) => {
    if (!pipecatBridgeAuthorized(req)) return unauthorized(req, res);
    const name = String(req.body?.name || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    try {
      res.json(await handleSessionTool(req.params.callId, {
        eventId: req.body?.eventId || "",
        name,
        args: req.body?.args || {},
      }));
    } catch (error) {
      res.status(error.message === "Call not found" ? 404 : 400).json({ error: error.message });
    }
  });

  app.post("/api/pipecat/sessions/:callId/events", async (req, res) => {
    if (!pipecatBridgeAuthorized(req)) return unauthorized(req, res);
    const eventId = String(req.body?.eventId || "").trim();
    const type = String(req.body?.type || "").trim();
    if (!eventId || !type) {
      return res.status(400).json({ error: "eventId and type are required" });
    }
    try {
      const result = await handleSessionEvent(req.params.callId, req.body || {});
      if (type === "disposition" || type === "status") {
        const call = await getCall(req.params.callId);
        if (call && call.status && call.status !== "in_progress" && call.status !== "ringing") {
          await stopPipecatSession(call).catch(() => null);
        }
      }
      res.json(result);
    } catch (error) {
      res.status(error.message === "Call not found" ? 404 : 400).json({ error: error.message });
    }
  });

  app.get("/api/pipecat/cloud/agents", (req, res) => sendCloud(res, () => listAgents(queryFrom(req))));
  app.post("/api/pipecat/cloud/agents", (req, res) => sendCloud(res, () => createAgent(req.body || {})));
  app.get("/api/pipecat/cloud/agents/:agentName/logs", (req, res) => (
    sendCloud(res, () => getAgentLogs(req.params.agentName, queryFrom(req)))
  ));
  app.get("/api/pipecat/cloud/agents/:agentName/sessions/:sessionId", (req, res) => (
    sendCloud(res, () => getSession(req.params.agentName, req.params.sessionId, queryFrom(req)))
  ));
  app.delete("/api/pipecat/cloud/agents/:agentName/sessions/:sessionId", (req, res) => (
    sendCloud(res, () => stopSession(req.params.agentName, req.params.sessionId))
  ));
  app.get("/api/pipecat/cloud/agents/:agentName/sessions", (req, res) => (
    sendCloud(res, () => listSessions(req.params.agentName, queryFrom(req)))
  ));
  app.get("/api/pipecat/cloud/agents/:agentName", (req, res) => (
    sendCloud(res, () => getAgent(req.params.agentName, queryFrom(req)))
  ));
  app.post("/api/pipecat/cloud/agents/:agentName", (req, res) => (
    sendCloud(res, () => updateAgent(req.params.agentName, req.body || {}))
  ));
  app.delete("/api/pipecat/cloud/agents/:agentName", (req, res) => (
    sendCloud(res, () => deleteAgent(req.params.agentName))
  ));

  app.get("/api/pipecat/cloud/secrets", (_req, res) => sendCloud(res, () => listSecrets()));
  app.put("/api/pipecat/cloud/secrets/:setName", (req, res) => (
    sendCloud(res, () => upsertSecretSet(req.params.setName, req.body || {}))
  ));
  app.get("/api/pipecat/cloud/secrets/:setName", (req, res) => (
    sendCloud(res, () => getSecretSet(req.params.setName))
  ));
  app.delete("/api/pipecat/cloud/secrets/:setName/:secretKey", (req, res) => (
    sendCloud(res, () => deleteSecret(req.params.setName, req.params.secretKey))
  ));
  app.delete("/api/pipecat/cloud/secrets/:setName", (req, res) => (
    sendCloud(res, () => deleteSecretSet(req.params.setName))
  ));

  app.post("/api/pipecat/cloud/builds/upload-url", (req, res) => (
    sendCloud(res, () => getUploadUrl(req.body || {}))
  ));
  app.post("/api/pipecat/cloud/builds", (req, res) => sendCloud(res, () => createBuild(req.body || {})));
  app.get("/api/pipecat/cloud/builds", (req, res) => sendCloud(res, () => listBuilds(queryFrom(req))));
  app.get("/api/pipecat/cloud/builds/:buildId/logs", (req, res) => (
    sendCloud(res, () => getBuildLogs(req.params.buildId))
  ));
  app.get("/api/pipecat/cloud/builds/:buildId", (req, res) => sendCloud(res, () => getBuild(req.params.buildId)));

  app.get("/api/pipecat/cloud/regions", (_req, res) => sendCloud(res, () => listRegions()));
  app.get("/api/pipecat/cloud/properties/schema", (_req, res) => sendCloud(res, () => getPropertiesSchema()));
  app.get("/api/pipecat/cloud/properties", (_req, res) => sendCloud(res, () => getProperties()));
  app.put("/api/pipecat/cloud/properties", (req, res) => sendCloud(res, () => updateProperties(req.body || {})));

  app.post("/api/pipecat/cloud/start", (req, res) => sendCloud(res, () => startConfiguredSession(req.body || {})));

  app.all("/api/pipecat/cloud/sessions/:sessionId/{*path}", (req, res) => {
    const rest = Array.isArray(req.params.path) ? req.params.path.join("/") : String(req.params.path || "");
    sendCloud(res, () => sessionProxy(
      pipecatCloudConfig().agentName,
      req.params.sessionId,
      req.method,
      rest,
      {
        body: req.method === "GET" || req.method === "HEAD" ? undefined : (req.body || {}),
        query: queryFrom(req),
      }
    ));
  });

  app.all("/api/pipecat/cloud/sessions/:sessionId", (req, res) => {
    sendCloud(res, () => sessionProxy(
      pipecatConfig().agentName,
      req.params.sessionId,
      req.method,
      "",
      {
        body: req.method === "GET" || req.method === "HEAD" ? undefined : (req.body || {}),
        query: queryFrom(req),
      }
    ));
  });
}
