import "dotenv/config";
import { fileURLToPath } from "node:url";
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  voice,
} from "@livekit/agents";
import * as openai from "@livekit/agents-plugin-openai";
import * as sarvam from "@livekit/agents-plugin-sarvam";
import * as silero from "@livekit/agents-plugin-silero";
import { handleUserTurn, loadSession, recordMetric, recordStatus } from "./conversationAdapter.js";

type JobMeta = {
  callId?: string;
  phone?: string;
};

function parseMeta(raw: string | undefined): JobMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as JobMeta;
  } catch {
    return { callId: raw };
  }
}

function sarvamLanguage(code: string) {
  const value = String(code || "te-IN");
  if (value.startsWith("hi")) return "hi-IN";
  if (value.startsWith("en")) return "en-IN";
  if (value.startsWith("ta")) return "ta-IN";
  return "te-IN";
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const startedAt = Date.now();
    const meta = parseMeta(ctx.job.metadata);
    const callId = String(meta.callId || "").trim();
    if (!callId) {
      throw new Error("LiveKit job metadata must include callId");
    }

    await ctx.connect();
    const snapshot = await loadSession(callId);
    const language = sarvamLanguage(snapshot.language || snapshot.agent.language);
    const speaker = String(snapshot.agent.ttsVoice || "priya").toLowerCase();
    const modelRaw = String(snapshot.agent.ttsModel || "bulbul:v3");
    const model = modelRaw.includes("v2") ? "bulbul:v2" : "bulbul:v3";

    await recordStatus(callId, "in_progress", "agent_connected");
    await recordMetric(callId, "agent_connect_ms", Date.now() - startedAt);

    const session = new voice.AgentSession({
      stt: new sarvam.STT({
        languageCode: language,
        model: "saaras:v3",
        mode: "codemix",
      }),
      tts: new sarvam.TTS({
        targetLanguageCode: language,
        model,
        speaker,
        pace: 0.95,
        temperature: 0.42,
      }),
      llm: snapshot.llm
        ? new openai.LLM({
            model: snapshot.llm.model,
            baseURL: snapshot.llm.baseUrl,
            apiKey: snapshot.llm.apiKey,
          })
        : new openai.LLM({
            model: "gpt-4o-mini",
            apiKey: process.env.OPENAI_API_KEY || "",
          }),
      vad: await silero.VAD.load(),
    });

    const agent = new voice.Agent({
      instructions:
        "You are on a live phone call. Keep replies short and natural. Follow Zoco turn responses when provided.",
    });

    let greetingSpoken = false;
    let ending = false;

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, async (event) => {
      if (ending || !event.isFinal) return;
      const userText = String(event.transcript || "").trim();
      if (!userText) return;

      const turnStarted = Date.now();
      try {
        const reply = await handleUserTurn(callId, userText, event.language || language);
        await recordMetric(callId, "turn_latency_ms", Date.now() - turnStarted, {
          provider: reply.provider || "zoco",
        });

        if (reply.text) {
          await session.say(reply.text, { allowInterruptions: true });
        }
        if (reply.endCall) {
          ending = true;
          await recordStatus(callId, "completed", reply.disposition || "success");
          await ctx.room.disconnect();
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`Turn failed for ${callId}:`, message);
        await recordMetric(callId, "turn_error", 1, { message });
        await session.say("Sorry, one moment please.", { allowInterruptions: true });
      }
    });

    await session.start({ agent, room: ctx.room });

    if (!greetingSpoken && snapshot.greeting) {
      greetingSpoken = true;
      const greetStarted = Date.now();
      await session.say(snapshot.greeting, { allowInterruptions: true });
      await recordMetric(callId, "greeting_ms", Date.now() - greetStarted);
    }

    ctx.room.on("disconnected", async () => {
      if (!ending) {
        await recordStatus(callId, "dropped", "room_disconnected");
      }
    });
  },
});

cli.runApp(new WorkerOptions({ agent: fileURLToPath(import.meta.url) }));
