import { WebSocket, WebSocketServer } from "ws";
import { currentUser, skipLoginAllowed } from "../auth.js";
import { spokenForTts } from "../languages.js";
import { getAiSettings } from "../store.js";
import { applyPronunciations } from "./pronunciation.js";
import { mergedKeys, sarvamTtsLanguage } from "./providers.js";

const SARVAM_TTS_STREAM = "wss://api.sarvam.ai/text-to-speech/ws";
const V3_SPEAKERS = new Set([
  "shubh", "aditya", "ritu", "priya", "neha", "rahul", "pooja", "rohan",
  "simran", "kavya", "amit", "dev", "ishita", "shreya", "ratan", "varun",
  "manan", "sumit", "roopa", "kabir", "aayan", "ashutosh", "advait", "anand",
  "tanya", "tarun", "sunny", "mani", "gokul", "vijay", "shruti", "suhani",
  "mohit", "kavitha", "rehan", "soham", "rupali",
]);

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Math.min(max, Math.max(min, Number.isFinite(number) ? number : fallback));
}

function parseMessage(raw) {
  try {
    return JSON.parse(Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw));
  } catch {
    return null;
  }
}

/**
 * Browser ↔ local WebSocket ↔ Sarvam Bulbul streaming TTS.
 * Audio chunks are forwarded as base64 MP3 for progressive MediaSource playback.
 */
export function mountTtsStream(server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", async (req, socket, head) => {
    try {
      const host = req.headers.host || "localhost";
      const url = new URL(req.url || "/", `http://${host}`);
      if (url.pathname !== "/api/tts/stream") return;

      const user = await currentUser(req);
      if (!user && !skipLoginAllowed()) {
        socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (client) => {
        wss.emit("connection", client);
      });
    } catch {
      socket.destroy();
    }
  });

  wss.on("connection", async (client) => {
    const settings = await getAiSettings();
    const apiKey = mergedKeys(settings).sarvam;
    if (!apiKey) {
      client.send(JSON.stringify({ type: "error", error: "Sarvam API key is not configured." }));
      client.close();
      return;
    }

    let upstream = null;
    let started = false;
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      try {
        upstream?.close();
      } catch {
        /* ignore */
      }
      try {
        client.close();
      } catch {
        /* ignore */
      }
    };

    client.on("message", (raw) => {
      const message = parseMessage(raw);
      if (!message) return;
      if (message.type === "stop") {
        close();
        return;
      }
      if (message.type !== "start" || started) return;
      started = true;

      const text = spokenForTts(
        applyPronunciations(message.text, message.language, message.pronunciations)
      ).slice(0, 2400);
      if (!text) {
        client.send(JSON.stringify({ type: "error", error: "Text is required." }));
        close();
        return;
      }
      const model = String(message.model || "bulbul:v3").includes("v2") ? "bulbul:v2" : "bulbul:v3";
      const requestedSpeaker = String(message.speaker || "kavya").toLowerCase();
      const speaker = model === "bulbul:v3" && V3_SPEAKERS.has(requestedSpeaker)
        ? requestedSpeaker
        : model === "bulbul:v3" ? "kavya" : "anushka";
      const language = sarvamTtsLanguage(message.language || "en-IN");
      const pace = clamp(message.pace, 0.5, 1.2, 0.95);
      const temperature = clamp(message.temperature, 0.01, 0.75, 0.42);

      upstream = new WebSocket(
        `${SARVAM_TTS_STREAM}?model=${encodeURIComponent(model)}&send_completion_event=true`,
        { headers: { "Api-Subscription-Key": apiKey, "api-subscription-key": apiKey } }
      );

      upstream.on("open", () => {
        const config = {
          model,
          language_code: language,
          speaker,
          pace,
          speech_sample_rate: 24000,
          output_audio_codec: "mp3",
          output_audio_bitrate: "128k",
          min_buffer_size: 30,
          max_chunk_length: 180,
        };
        if (model === "bulbul:v3") config.temperature = temperature;
        else config.pitch = clamp(message.pitch, -0.75, 0.75, 0);
        const dictId = String(message.dictId || "").trim();
        if (dictId && model === "bulbul:v3") config.dict_id = dictId;

        upstream.send(JSON.stringify({ type: "config", data: config }));
        upstream.send(JSON.stringify({ type: "text", data: { text } }));
        upstream.send(JSON.stringify({ type: "flush" }));
      });

      upstream.on("message", (data) => {
        if (client.readyState !== WebSocket.OPEN) return;
        const event = parseMessage(data);
        if (!event) return;
        if (event.type === "audio" && event.data?.audio) {
          client.send(JSON.stringify({
            type: "audio",
            audio: event.data.audio,
            contentType: event.data.content_type || "audio/mpeg",
          }));
          return;
        }
        if (event.type === "event" && event.data?.event_type === "final") {
          client.send(JSON.stringify({ type: "done" }));
          return;
        }
        if (event.type === "error") {
          client.send(JSON.stringify({
            type: "error",
            error: event.data?.message || "Sarvam streaming TTS failed.",
          }));
        }
      });
      upstream.on("error", (error) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "error", error: error.message || "TTS socket failed." }));
        }
      });
      upstream.on("close", () => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ type: "done" }));
        }
      });
    });

    client.on("close", () => {
      closed = true;
      try {
        upstream?.close();
      } catch {
        /* ignore */
      }
    });
    client.on("error", close);
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ type: "ready" }));
    }
  });

  return wss;
}
