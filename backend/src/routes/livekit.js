import {
  buildSessionSnapshot,
  handleSessionEvent,
  handleSessionTool,
  handleSessionTurn,
} from "../engine/livekitSession.js";
import { getCall, getCallAgent, saveCall } from "../store.js";
import {
  agentUsesLiveKit,
  bridgeAuthorized,
  livekitReady,
  publicLiveKitStatus,
  startLiveKitWebSession,
} from "../services/livekit.js";

function unauthorized(_req, res) {
  return res.status(401).json({ error: "LiveKit bridge token required" });
}

export function mountLiveKitRoutes(app) {
  app.get("/api/livekit/status", (_req, res) => {
    res.json(publicLiveKitStatus());
  });

  app.post("/api/livekit/calls/:callId/session", async (req, res) => {
    if (!livekitReady()) {
      return res.status(503).json({ error: "LiveKit is not configured" });
    }
    try {
      const call = await getCall(req.params.callId);
      if (!call) return res.status(404).json({ error: "Call not found" });
      const agent = await getCallAgent(call);
      if (!agent) return res.status(400).json({ error: "Agent not found" });
      if (!agentUsesLiveKit(agent)) {
        return res.status(409).json({ error: "This agent is set to Personalized. Switch Voice stack to LiveKit." });
      }
      const session = await startLiveKitWebSession(call, agent);
      call.channel = call.channel || "voice";
      call.runtime = "livekit";
      call.livekit = { ...(call.livekit || {}), roomName: session.roomName, channel: "web" };
      if (call.status === "ringing") {
        call.status = "in_progress";
        call.disposition = "in_progress";
        if (!call.startedAt) call.startedAt = new Date().toISOString();
      }
      await saveCall(call);
      res.json(session);
    } catch (error) {
      res.status(400).json({ error: error.message });
    }
  });

  app.get("/api/livekit/sessions/:callId/snapshot", async (req, res) => {
    if (!bridgeAuthorized(req)) return unauthorized(req, res);
    try {
      res.json(await buildSessionSnapshot(req.params.callId));
    } catch (error) {
      res.status(error.message === "Call not found" ? 404 : 400).json({ error: error.message });
    }
  });

  app.post("/api/livekit/sessions/:callId/turn", async (req, res) => {
    if (!bridgeAuthorized(req)) return unauthorized(req, res);
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

  app.post("/api/livekit/sessions/:callId/tools", async (req, res) => {
    if (!bridgeAuthorized(req)) return unauthorized(req, res);
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

  app.post("/api/livekit/sessions/:callId/events", async (req, res) => {
    if (!bridgeAuthorized(req)) return unauthorized(req, res);
    const eventId = String(req.body?.eventId || "").trim();
    const type = String(req.body?.type || "").trim();
    if (!eventId || !type) {
      return res.status(400).json({ error: "eventId and type are required" });
    }
    try {
      res.json(await handleSessionEvent(req.params.callId, req.body || {}));
    } catch (error) {
      res.status(error.message === "Call not found" ? 404 : 400).json({ error: error.message });
    }
  });
}
