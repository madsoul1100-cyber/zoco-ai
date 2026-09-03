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
import { detectExplicitLanguageSwitch, detectSpeechLanguage, isLikelyAgentEcho, looksLikeSttNoise } from "./speechLanguage.js";
import {
  AEC_WARMUP_MS,
  POST_GREETING_ECHO_MS,
  TRANSCRIPTION_TIMEOUT_MS,
  USER_AWAY_TIMEOUT_S,
  shouldIgnoreUserAudio as ignoreUserAudio,
  shouldPromptOnTranscriptionTimeout,
} from "./sessionTuning.js";

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
        max_buffer_delay_ms: 40,
      },
    });

    // When language switching is allowed, start STT in multi so Hindi/English
    // requests are not force-transcribed as Telugu (Kabir demo failure mode).
    const sttStartLanguage = switchLanguages
      ? "multi"
      : spokenLanguage === "multi"
        ? "en"
        : spokenLanguage;

    const stt = new inference.STT({
      model: "deepgram/nova-3",
      language: sttStartLanguage as never,
      modelOptions: {
        keyterm: [
          snapshot.agent?.name,
          "WhatsApp",
          "weekend",
          "batch",
          "English",
          "Hindi",
          "Telugu",
          "हिंदी",
          "Form 18",
          "Priya",
          "Kabir",
        ].filter(Boolean),
        punctuate: true,
        smart_format: true,
        filler_words: false,
        endpointing: 400,
        numerals: true,
      },
    });

    const session = new voice.AgentSession({
      stt,
      llm: new inference.LLM({
        model: "google/gemma-4-31b-it",
      }),
      tts,
      // Milliseconds (SDK default 3000). Never pass fractional seconds — 0.35 became 0.35ms.
      aecWarmupDuration: AEC_WARMUP_MS,
      userAwayTimeout: USER_AWAY_TIMEOUT_S,
      transcriptionTimeout: TRANSCRIPTION_TIMEOUT_MS,
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        interruption: {
          enabled: true,
          minDuration: 120,
          minWords: 1,
          resumeFalseInterruption: false,
          discardAudioIfUninterruptible: true,
          backchannelBoundary: 220,
        },
        endpointing: {
          mode: "dynamic",
          minDelay: 200,
          maxDelay: 650,
        },
        preemptiveGeneration: {
          enabled: true,
          preemptiveTts: false,
        },
      },
    });
    // Keep the input timeline continuous. Muting for the whole greeting caused
    // "Input is shorter by N samples; silence has been prepended" and empty STT finals.
    session.input.setAudioEnabled(true);

    let ending = false;
    let lastSpoken = String(snapshot.greeting || "");
    let listenAfter = 0;
    let greetingActive = false;
    let agentBusy = false;
    let lastRepeatPromptAt = 0;
    let repeatPromptCount = 0;
    let ttsLanguage: "en" | "hi" | "te" = spokenLanguage === "multi" ? "en" : (spokenLanguage as "en" | "hi" | "te");
    let sttLanguage: string = sttStartLanguage;
    let speechLanguageLocked = false;

    function applySpeechLanguage(next: "en" | "hi" | "te", { lock = false }: { lock?: boolean } = {}) {
      if (!switchLanguages) return;
      if (lock) speechLanguageLocked = true;
      if (next !== ttsLanguage) {
        ttsLanguage = next;
        tts.updateOptions({ language: next as never });
      }
      if (next !== sttLanguage) {
        sttLanguage = next;
        stt.updateOptions({ language: next as never });
      } else if (lock) {
        // Re-assert STT language after an explicit switch — Deepgram can keep
        // emitting the previous script if the live stream never got the update.
        stt.updateOptions({ language: next as never });
      }
    }

    function syncSpeechLanguageFromUserText(text: string, reported?: string) {
      const explicit = detectExplicitLanguageSwitch(text);
      if (explicit) {
        applySpeechLanguage(explicit, { lock: true });
        return explicit;
      }
      const fromText = detectSpeechLanguage(text, ttsLanguage, { locked: speechLanguageLocked });
      if (fromText) {
        applySpeechLanguage(fromText);
        return fromText;
      }
      if (looksLikeSttNoise(text, ttsLanguage) || speechLanguageLocked) return null;
      const reportedLang = asSpeechLanguage(reported);
      if (reportedLang) applySpeechLanguage(reportedLang);
      return reportedLang;
    }

    function shouldIgnoreUserAudio(text: string) {
      return ignoreUserAudio(text, {
        greetingActive,
        listenAfter,
        lastSpoken,
        ttsLanguage,
      });
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
        `You are ${snapshot.agent.name}. You are the clinic / company voice assistant. The customer is never you. Never say you are the customer, never say "मैं Ravi बोल रहा हूँ" / "this is Ravi", and never answer as if you received the call.`,
        gender === "male"
          ? "You speak with a male voice. In Hindi and other gendered Indian languages use masculine first-person forms: करूंगा, रहा हूँ, गया. Never say करूंगी, रही, or गई."
          : "You speak with a female voice. In Hindi and other gendered Indian languages use feminine first-person forms: करूंगी, रही हूँ, गई. Never say करूंगा.",
        alreadyGreeted
          ? "The configured greeting has already been spoken. Do not repeat the introduction. Wait for the customer, then continue the call."
          : "Greet the customer using the configured greeting, then wait.",
        "STT can arrive as short fragments (Aankhen, I am saying any, you are not). Those are not refusals. Ask them to repeat. Never call end_interaction unless they clearly say not interested, stop calling, goodbye, or that the flow is finished in a full sentence.",
        "When you call end_interaction, put the exact closing sentence in goodbye and do not also write a different spoken reply in the same turn — otherwise the caller hears cut-off audio.",
        "Short answers like Yes, Yeah, Sure, Yeah sure, Go ahead are real confirmations. Answer them. Do not say you didn't catch that.",
        "If the caller asks for Hindi or English, switch spoken replies immediately and stay there. Do not answer in Telugu after they asked for Hindi/English.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      onUserTurnCompleted: async (_agentCtx, _chatCtx, newMessage) => {
        const text = itemText(newMessage);
        if (shouldIgnoreUserAudio(text)) {
          newMessage.content = [
            "[Ignore: microphone heard the agent's own voice. Do not speak. Do not change identity. Wait for the real caller.]",
          ];
          return;
        }
        syncSpeechLanguageFromUserText(text);
        if (!looksLikeSttNoise(text, ttsLanguage)) return;
        await recordTranscript(callId, "user", text);
        newMessage.content = [
          `[Unclear STT fragment: "${text}". Stay in ${ttsLanguage === "hi" ? "Hindi" : ttsLanguage === "te" ? "Telugu" : "English"}. Do not end the call. Do not assume they refused. Ask them to repeat in one short sentence.]`,
        ];
      },
      onEnter: async (agentCtx) => {
        session.input.setAudioEnabled(true);
        try {
          if (snapshot.greeting) {
            greetingActive = true;
            lastSpoken = snapshot.greeting;
            const greetStarted = Date.now();
            const handle = agentCtx.session.say(snapshot.greeting, { allowInterruptions: false });
            await recordTranscript(callId, "assistant", snapshot.greeting);
            try {
              await handle.waitForPlayout();
            } catch {
              /* continue */
            }
            await recordMetric(callId, "greeting_ms", Date.now() - greetStarted);
            await new Promise((resolve) => setTimeout(resolve, POST_GREETING_ECHO_MS));
          }
        } finally {
          greetingActive = false;
          listenAfter = Date.now() + POST_GREETING_ECHO_MS;
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
            "End the call only after the caller clearly refuses, asks to stop, or finishes the flow. Never use this for Hello, who, No no no, Aankhen, you are not, I am saying any, or other short STT fragments. Pass goodbye as the exact closing line you want spoken (or already spoke). Do not invent a second different closing in the same turn.",
          parameters: z.object({
            goodbye: z.string().describe("The exact short closing line spoken to the caller before hangup"),
            disposition: z
              .string()
              .describe("not_interested | do_not_call | success | callback_requested | wrong_person | qualified"),
          }),
          execute: async ({ goodbye, disposition }, { ctx: toolCtx }) => {
            const result = await callTool(callId, "end_interaction", { goodbye, disposition });
            const spoken = String(result.say || goodbye || "").trim();
            // Drain in-flight LLM speech first so a second goodbye does not cut it off.
            const drainStarted = Date.now();
            while (Date.now() - drainStarted < 12_000) {
              const state = String(toolCtx.session.agentState || "");
              if (state !== "speaking" && state !== "thinking") break;
              await new Promise((resolve) => setTimeout(resolve, 150));
            }
            if (spoken) {
              try {
                const handle = toolCtx.session.say(spoken, { allowInterruptions: false });
                await handle.waitForPlayout();
              } catch {
                /* still hang up cleanly */
              }
              await recordTranscript(callId, "assistant", spoken);
            }
            // Let the last audio packets reach the browser before room teardown.
            await new Promise((resolve) => setTimeout(resolve, 600));
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
            try {
              const handle = toolCtx.session.say(spoken, { allowInterruptions: false });
              await handle.waitForPlayout();
            } catch {
              /* continue */
            }
            await recordTranscript(callId, "assistant", spoken);
            await new Promise((resolve) => setTimeout(resolve, 400));
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
      if (shouldIgnoreUserAudio(text)) return;
      syncSpeechLanguageFromUserText(text, event.language || undefined);
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, async (event) => {
      if (ending) return;
      const item = event.item as { role?: string; text?: string; content?: unknown };
      const role = item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : "";
      const text = itemText(item);
      if (!role || !text) return;
      if (text.includes("[Unclear STT") || text.includes("[Ignore:")) return;
      if (role === "assistant") lastSpoken = text;
      if (role === "user") {
        if (shouldIgnoreUserAudio(text)) return;
        syncSpeechLanguageFromUserText(text);
      }
      await recordTranscript(callId, role, text);
    });

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
      const next = String((event as { newState?: string }).newState || "");
      agentBusy = next === "speaking" || next === "thinking";
    });

    session.on(voice.AgentSessionEventTypes.UserTranscriptionTimeout, async () => {
      if (
        !shouldPromptOnTranscriptionTimeout({
          ending,
          greetingActive,
          agentBusy,
          lastPromptAt: lastRepeatPromptAt,
          promptCount: repeatPromptCount,
        })
      ) {
        return;
      }
      lastRepeatPromptAt = Date.now();
      repeatPromptCount += 1;
      try {
        await session.say(
          ttsLanguage === "hi"
            ? "मुझे साफ़ सुनाई नहीं दिया। एक बार फिर से बोलिए?"
            : ttsLanguage === "te"
              ? "సరిగ్గా వినిపించలేదు అండి. మళ్లీ చెప్తారా?"
              : "I didn't catch that clearly. Could you say that again?",
          { allowInterruptions: true }
        );
      } catch {
        /* ignore */
      }
    });

    await session.start({
      agent,
      room: ctx.room,
      inputOptions: {
        closeOnDisconnect: true,
      },
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
