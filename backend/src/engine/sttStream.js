import { WebSocketServer, WebSocket } from "ws";
import { currentUser, skipLoginAllowed } from "../auth.js";
import { getAiSettings } from "../store.js";
import { mergedKeys, sarvamTtsLanguage } from "./providers.js";

const SARVAM_REALTIME = "wss://api.sarvam.ai/speech-to-text-realtime/ws";

function silenceMsFromEagerness(eagerness) {
  const value = Number(eagerness);
  if (!Number.isFinite(value)) return 450;
  return Math.max(280, Math.min(900, Math.round((11 - value) * 70)));
}

function buildSarvamUrl({ language = "auto", eagerness = 7 } = {}) {
  const params = new URLSearchParams({
    language_code: language === "auto" ? "auto" : sarvamTtsLanguage(language),
    model: "saaras:v3-realtime",
    stream_type: "fast",
    mode: "transcribe",
    endpointing: "vad",
    encoding: "linear16",
    sample_rate: "16000",
    threshold: "0.35",
    silence_duration_ms: String(silenceMsFromEagerness(eagerness)),
    min_speech_duration_ms: "200",
  });
  return `${SARVAM_REALTIME}?${params.toString()}`;
}

function parseClientMessage(raw) {
  if (typeof raw === "string") {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (Buffer.isBuffer(raw)) {
    try {
      return JSON.parse(raw.toString("utf8"));
    } catch {
      return { type: "audio_bin", buffer: raw };
    }
  }
  return null;
}

/**
 * Attach /api/stt/stream WebSocket proxy (browser ↔ Sarvam realtime STT).
 */
export function mountSttStream(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname !== "/api/stt/stream") return;

      const user = await currentUser(req);
      if (!user && !skipLoginAllowed()) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit("connection", client, req, url);
      });
    } catch (error) {
      console.warn("STT upgrade failed:", error.message);
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
    }
  });

  wss.on("connection", async (client, _req, url) => {
    const settings = await getAiSettings();
    const key = mergedKeys(settings).sarvam;
    if (!key) {
      client.send(JSON.stringify({ type: "error", error: "Add a Sarvam API key in Settings for live transcription." }));
      client.close();
      return;
    }

    const language = String(url.searchParams.get("language") || "auto");
    const eagerness = Number(url.searchParams.get("eagerness") || 7);
    const upstream = new WebSocket(buildSarvamUrl({ language, eagerness }), {
      headers: { "api-subscription-key": key, "Api-Subscription-Key": key },
    });

    let closed = false;
    const closeBoth = () => {
      if (closed) return;
      closed = true;
      try {
        if (upstream.readyState === WebSocket.OPEN) {
          upstream.send(JSON.stringify({ event: "end" }));
        }
      } catch {
        /* ignore */
      }
      try {
        upstream.close();
      } catch {
        /* ignore */
      }
      try {
        client.close();
      } catch {
        /* ignore */
      }
    };

    const ping = setInterval(() => {
      if (upstream.readyState === WebSocket.OPEN) {
        try {
          upstream.send(JSON.stringify({ event: "ping" }));
        } catch {
          /* ignore */
        }
      }
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.ping();
        } catch {
          /* ignore */
        }
      }
    }, 20000);

    upstream.on("open", () => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "ready", language }));
      }
    });

    upstream.on("message", (data) => {
      if (client.readyState !== WebSocket.OPEN) return;
      let msg = null;
      try {
        msg = JSON.parse(String(data));
      } catch {
        return;
      }
      const event = msg.event || msg.type;
      if (event === "transcript.partial") {
        client.send(JSON.stringify({
          type: "partial",
          text: String(msg.text || "").trim(),
          language: msg.language || null,
        }));
        return;
      }
      if (event === "transcript.final") {
        client.send(JSON.stringify({
          type: "final",
          text: String(msg.text || "").trim(),
          language: msg.language || null,
        }));
        return;
      }
      if (event === "vad.speech_start") {
        client.send(JSON.stringify({ type: "vad_start" }));
        return;
      }
      if (event === "vad.speech_end") {
        client.send(JSON.stringify({ type: "vad_end" }));
        return;
      }
      if (event === "error") {
        client.send(JSON.stringify({
          type: "error",
          error: msg.message || msg.code || "STT error",
          fatal: Boolean(msg.is_fatal),
        }));
        if (msg.is_fatal) closeBoth();
        return;
      }
      if (event === "session.begin") {
        client.send(JSON.stringify({ type: "session", state: "begin" }));
      }
    });

    upstream.on("close", () => {
      clearInterval(ping);
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(JSON.stringify({ type: "closed" }));
        } catch {
          /* ignore */
        }
        client.close();
      }
    });

    upstream.on("error", (error) => {
      console.warn("Sarvam STT socket error:", error.message);
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify({ type: "error", error: error.message || "Upstream STT failed" }));
      }
      closeBoth();
    });

    client.on("message", (raw) => {
      if (upstream.readyState !== WebSocket.OPEN) return;
      const msg = parseClientMessage(raw);
      if (!msg) return;
      if (msg.type === "audio" && msg.audio) {
        upstream.send(JSON.stringify({ event: "audio_input", audio: msg.audio }));
        return;
      }
      if (msg.type === "audio_bin" && msg.buffer) {
        upstream.send(JSON.stringify({
          event: "audio_input",
          audio: msg.buffer.toString("base64"),
        }));
        return;
      }
      if (msg.type === "ping") {
        upstream.send(JSON.stringify({ event: "ping" }));
        return;
      }
      if (msg.type === "end" || msg.type === "stop") {
        closeBoth();
      }
    });

    client.on("close", () => {
      clearInterval(ping);
      closeBoth();
    });
    client.on("error", () => {
      clearInterval(ping);
      closeBoth();
    });
  });

  return wss;
}
