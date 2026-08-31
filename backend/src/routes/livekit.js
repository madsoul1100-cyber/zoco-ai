import {
  buildSessionSnapshot,
  handleSessionEvent,
  handleSessionTurn,
} from "../engine/livekitSession.js";
import { bridgeAuthorized, publicLiveKitStatus } from "../services/livekit.js";

function unauthorized(_req, res) {
  return res.status(401).json({ error: "LiveKit bridge token required" });
}

export function mountLiveKitRoutes(app) {
  app.get("/api/livekit/status", (_req, res) => {
    res.json(publicLiveKitStatus());
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
