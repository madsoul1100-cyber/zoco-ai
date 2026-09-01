import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type JobContext,
  WorkerOptions,
  cli,
  defineAgent,
  inference,
  llm,
  voice,
} from "@livekit/agents";
import { z } from "zod";
import {
  callTool,
  loadSession,
  recordDisposition,
  recordMetric,
  recordStatus,
  recordTranscript,
} from "./conversationAdapter.js";
import { detectSpeechLanguage, looksLikeSttNoise } from "./speechLanguage.js";

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, "../../.env") });
dotenv.config({ path: path.resolve(here, "../.env") });

type JobMeta = {
  callId?: string;
  phone?: string;
  agentId?: string;
  channel?: string;
};

function parseMeta(raw: string | undefined): JobMeta {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as JobMeta;
  } catch {
    return { callId: raw };
  }
}

function inferenceLanguage(code: string) {
  const value = String(code || "en").toLowerCase();
  if (value.startsWith("hi")) return "hi";
  if (value.startsWith("te")) return "te";
  if (value.startsWith("ta")) return "ta";
  if (value.startsWith("en")) return "en";
  return "multi";
}

const CARTESIA_VOICES = {
  female: "3b554273-4299-48b9-9aaf-eefd438e3941",
  male: "638efaaa-4d0c-442e-b701-3fae16aad012",
} as const;

function cartesiaVoice(gender: string | undefined) {
  return gender === "male" ? CARTESIA_VOICES.male : CARTESIA_VOICES.female;
}

function canSwitchLanguage(snapshot: { agent?: { callSettings?: Record<string, unknown> } }) {
  return snapshot.agent?.callSettings?.switchLanguage !== false;
}

function asSpeechLanguage(value: string | undefined): "en" | "hi" | "te" | null {
  const code = String(value || "").toLowerCase();
  if (code.startsWith("hi")) return "hi";
  if (code.startsWith("te")) return "te";
  if (code.startsWith("en")) return "en";
  return null;
}

function itemText(item: unknown): string {
  if (!item || typeof item !== "object") return "";
  const record = item as Record<string, unknown>;
  if (typeof record.text === "string") return record.text;
  if (typeof record.content === "string") return record.content;
  if (Array.isArray(record.content)) {
    return record.content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) return String((part as { text?: string }).text || "");
        return "";
      })
      .join(" ")
      .trim();
  }
  return "";
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const startedAt = Date.now();
    const meta = parseMeta(ctx.job.metadata);
    const callId = String(meta.callId || "").trim();
    if (!callId) {
      throw new Error("LiveKit job metadata must include callId");
    }

    const [, snapshot] = await Promise.all([ctx.connect(), loadSession(callId)]);
    const spokenLanguage = inferenceLanguage(snapshot.language || snapshot.agent.language);
    const gender = snapshot.agent.gender === "male" ? "male" : "female";
    const switchLanguages = canSwitchLanguage(snapshot);

    await recordStatus(callId, "in_progress", "agent_connected");
    await recordMetric(callId, "agent_connect_ms", Date.now() - startedAt);

    const tts = new inference.TTS({
      model: "cartesia/sonic-3",
      voice: cartesiaVoice(gender),
      language: spokenLanguage === "multi" ? "en" : spokenLanguage,
      modelOptions: {
        speed: 1,
        max_buffer_delay_ms: 80,
      },
    });

    const stt = new inference.STT({
      model: "deepgram/nova-3",
      language: switchLanguages ? "multi" : spokenLanguage,
      modelOptions: {
        keyterm: ["Form 18", "Graduate MLC", "graduation", "हिंदी", "తెలుగు", "MLC", "Priya"],
        punctuate: true,
        smart_format: true,
        filler_words: false,
        endpointing: 300,
        numerals: true,
      },
    });

    const session = new voice.AgentSession({
      stt,
      llm: new inference.LLM({
        model: "google/gemma-4-31b-it",
      }),
      tts,
      aecWarmupDuration: 0,
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        interruption: {
          enabled: true,
          minDuration: 180,
          minWords: 1,
          resumeFalseInterruption: false,
          discardAudioIfUninterruptible: true,
          backchannelBoundary: 300,
        },
        endpointing: {
          mode: "dynamic",
          minDelay: 400,
          maxDelay: 1600,
        },
        preemptiveGeneration: {
          enabled: true,
          preemptiveTts: false,
        },
      },
    });
    session.input.setAudioEnabled(false);

    let ending = false;
    let ttsLanguage: "en" | "hi" | "te" = spokenLanguage === "multi" ? "en" : (spokenLanguage as "en" | "hi" | "te");
    let sttLanguage = switchLanguages ? "multi" : spokenLanguage;

    function applySpeechLanguage(next: "en" | "hi" | "te") {
      if (!switchLanguages) return;
      if (next !== ttsLanguage) {
        ttsLanguage = next;
        tts.updateOptions({ language: next as never });
      }
      if (next !== sttLanguage) {
        sttLanguage = next;
        stt.updateOptions({ language: next as never });
      }
    }

    function languageFromTurn(text: string, reported?: string) {
      const fromText = detectSpeechLanguage(text, ttsLanguage);
      if (fromText) return fromText;
      if (looksLikeSttNoise(text, ttsLanguage)) return null;
      return asSpeechLanguage(reported);
    }

    async function finish(disposition: string, reason: string) {
      if (ending) return;
      ending = true;
      await recordDisposition(callId, disposition, reason);
      try {
        await session.close();
      } catch {
        /* ignore */
      }
      await ctx.room.disconnect();
    }

    const extraTools: Record<string, ReturnType<typeof llm.tool>> = {};
    for (const tool of snapshot.agent.customTools || []) {
      if (!tool?.name) continue;
      extraTools[tool.name] = llm.tool({
        description: tool.description || `Call the ${tool.name} HTTP API`,
        parameters: z.object({
          note: z.string().optional(),
        }),
        execute: async (args) => {
          const result = await callTool(callId, tool.name, args);
          return result.result || "Done.";
        },
      });
    }

    const alreadyGreeted = Boolean(snapshot.greeting);
    const agent = voice.Agent.create({
      instructions: [
        snapshot.instructions || `You are ${snapshot.agent.name}, on a live phone call. Keep replies short and natural.`,
        gender === "male"
          ? "You speak with a male voice. In Hindi and other gendered Indian languages use masculine first-person forms: करूंगा, रहा हूँ, गया. Never say करूंगी, रही, or गई."
          : "You speak with a female voice. In Hindi and other gendered Indian languages use feminine first-person forms: करूंगी, रही हूँ, गई. Never say करूंगा.",
        alreadyGreeted
          ? "The configured greeting has already been spoken. Do not repeat the introduction. Wait for the customer, then continue the call."
          : "Greet the customer using the configured greeting, then wait.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      onUserTurnCompleted: async (_agentCtx, _chatCtx, newMessage) => {
        const text = itemText(newMessage);
        const next = languageFromTurn(text);
        if (next) applySpeechLanguage(next);
        if (!looksLikeSttNoise(text, ttsLanguage)) return;
        await recordTranscript(callId, "user", text);
        newMessage.content = [
          `[Unclear STT while the caller is speaking ${ttsLanguage === "hi" ? "Hindi" : ttsLanguage === "te" ? "Telugu" : "English"}. Stay in that language. Do not switch to English. Do not end the call. Do not assume they graduated or refused. Ask them to repeat in one short sentence.]`,
        ];
      },
      onEnter: async (agentCtx) => {
        try {
          if (snapshot.greeting) {
            const greetStarted = Date.now();
            const handle = agentCtx.session.say(snapshot.greeting, { allowInterruptions: true });
            session.input.setAudioEnabled(true);
            await recordTranscript(callId, "assistant", snapshot.greeting);
            void handle.waitForPlayout().then(() => recordMetric(callId, "greeting_ms", Date.now() - greetStarted));
            return;
          }
        } finally {
          session.input.setAudioEnabled(true);
        }
      },
      tools: {
        query_knowledge: llm.tool({
          description: "Look up facts from attached knowledge bases. Use when the caller asks a factual question.",
          parameters: z.object({
            question: z.string().describe("The caller's factual question"),
          }),
          execute: async ({ question }) => {
            const result = await callTool(callId, "query_knowledge", { question });
            return result.result || "No matching knowledge.";
          },
        }),
        end_interaction: llm.tool({
          description:
            "End the call only after the caller clearly refuses, asks to stop, or finishes the flow. Never use this for Hello, who, No no no, or other short STT noise. Always pass goodbye with that exact spoken line, then disposition.",
          parameters: z.object({
            goodbye: z.string().describe("The exact short closing line spoken to the caller before hangup"),
            disposition: z
              .string()
              .describe("not_interested | do_not_call | success | callback_requested | wrong_person | qualified"),
          }),
          execute: async ({ goodbye, disposition }, { ctx: toolCtx }) => {
            const result = await callTool(callId, "end_interaction", { goodbye, disposition });
            const spoken = result.say || goodbye;
            if (spoken) {
              await toolCtx.session.say(spoken, { allowInterruptions: true });
              await recordTranscript(callId, "assistant", spoken);
            }
            await finish(result.disposition || disposition || "success", "agent_end");
            return result.result || "Call ended.";
          },
        }),
        transfer_to_human: llm.tool({
          description: "Warm-transfer the live call to a human. Speak a one-line handoff first.",
          parameters: z.object({
            reason: z.string().optional(),
            number: z.string().optional(),
          }),
          execute: async ({ reason, number }, { ctx: toolCtx }) => {
            const result = await callTool(callId, "transfer_to_human", { reason, number });
            const spoken = result.say || "I am connecting you to a teammate now.";
            await toolCtx.session.say(spoken, { allowInterruptions: false });
            await recordTranscript(callId, "assistant", spoken);
            await finish(result.disposition || "success", result.transfer ? `transfer:${result.transfer}` : "transfer");
            return result.result || "Transfer requested.";
          },
        }),
        ...extraTools,
      },
    });

    session.on(voice.AgentSessionEventTypes.UserInputTranscribed, (event) => {
      if (ending || !event.isFinal) return;
      const text = String(event.transcript || "");
      const next = languageFromTurn(text, event.language || undefined);
      if (next) applySpeechLanguage(next);
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (event) => {
      if (ending) return;
      const item = event.item as { role?: string; text?: string; content?: unknown };
      const role = item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : "";
      const text = itemText(item);
      if (!role || !text) return;
      if (text.includes("[Unclear STT")) return;
      if (role === "user") {
        const next = languageFromTurn(text);
        if (next) applySpeechLanguage(next);
      }
      await recordTranscript(callId, role, text);
    });

    await session.start({
      agent,
      room: ctx.room,
      outputOptions: {
        transcriptionEnabled: true,
        syncTranscription: false,
      },
    });

    ctx.room.on("disconnected", async () => {
      if (!ending) {
        await recordStatus(callId, "dropped", "room_disconnected");
      }
    });
  },
});

const agentName = String(process.env.LIVEKIT_AGENT_NAME || "zoco-voice").trim();

cli.runApp(
  new WorkerOptions({
    agent: fileURLToPath(import.meta.url),
    agentName,
  })
);
