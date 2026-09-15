import dotenv from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  type JobContext,
  StopResponse,
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
  recordMetricDetached,
  recordStatus,
  recordTranscriptDetached,
} from "./conversationAdapter.js";
import {
  detectExplicitLanguageSwitch,
  detectSpeechLanguage,
  grantsTalkTime,
  isEllipticalAffirmation,
  isIncompleteUserUtterance,
  isListeningComplaint,
  isPresenceCheck,
  isPurposeQuestion,
  looksLikeSttNoise,
  softListenPrompt,
  wantsAgentToContinue,
} from "./speechLanguage.js";
import {
  buildLiveKitSessionOptions,
  decideUserTurn,
  greetingPlayoutBudgetMs,
  mergeUtterance,
  POST_GREETING_ECHO_MS,
  STT_ENDPOINTING_MS,
  shouldIgnoreUserAudio as ignoreUserAudio,
  shouldPromptOnTranscriptionTimeout,
} from "./sessionTuning.js";
import { isExplicitHangupRequest, parseEndTag, stripEndTag } from "./hangup.js";
import { BackgroundVoiceCancellation } from "@livekit/noise-cancellation-node";

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

function setItemText(item: unknown, text: string) {
  if (!item || typeof item !== "object") return;
  const record = item as Record<string, unknown>;
  if ("text" in record) {
    record.text = text;
    return;
  }
  if (typeof record.content === "string") {
    record.content = text;
    return;
  }
  if (Array.isArray(record.content) && record.content.length) {
    const first = record.content[0];
    if (typeof first === "string") record.content[0] = text;
    else if (first && typeof first === "object" && "text" in first) {
      (first as { text?: string }).text = text;
    }
  }
}

export default defineAgent({
  entry: async (ctx: JobContext) => {
    const startedAt = Date.now();
    const meta = parseMeta(ctx.job.metadata);
    const callId = String(meta.callId || "").trim();
    const callerPhone = String(meta.phone || "").trim();
    if (!callId) {
      throw new Error("LiveKit job metadata must include callId");
    }

    const [, snapshotRaw] = await Promise.all([ctx.connect(), loadSession(callId)]);
    const snapshot = snapshotRaw;
    const phoneOnFile = String(snapshot.customer?.phone || callerPhone || "").trim();
    const spokenLanguage = inferenceLanguage(snapshot.language || snapshot.agent.language);
    const gender = snapshot.agent.gender === "male" ? "male" : "female";
    const switchLanguages = canSwitchLanguage(snapshot);

    await recordStatus(callId, "in_progress", "agent_connected");
    recordMetricDetached(callId, "agent_connect_ms", Date.now() - startedAt);

    const tts = new inference.TTS({
      model: "cartesia/sonic-3",
      voice: cartesiaVoice(gender),
      language: spokenLanguage === "multi" ? "en" : spokenLanguage,
      modelOptions: {
        speed: 0.88,
        max_buffer_delay_ms: 80,
      },
    });

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
        endpointing: STT_ENDPOINTING_MS,
        numerals: true,
      },
    });

    const sessionOpts = buildLiveKitSessionOptions();
    const session = new voice.AgentSession({
      stt,
      llm: new inference.LLM({
        model: "google/gemma-4-31b-it",
      }),
      tts,
      aecWarmupDuration: sessionOpts.aecWarmupDuration,
      userAwayTimeout: sessionOpts.userAwayTimeout,
      transcriptionTimeout: sessionOpts.transcriptionTimeout,
      turnHandling: {
        turnDetection: new inference.TurnDetector(),
        ...sessionOpts.turnHandling,
      },
    });

    let ending = false;
    let pendingHangup: { disposition: string; reason: string } | null = null;
    let lastSpoken = String(snapshot.greeting || "");
    let listenAfter = 0;
    let greetingActive = false;
    let agentBusy = false;
    let lastRepeatPromptAt = 0;
    let repeatPromptCount = 0;
    let ttsLanguage: "en" | "hi" | "te" = spokenLanguage === "multi" ? "en" : (spokenLanguage as "en" | "hi" | "te");
    let sttLanguage: string = sttStartLanguage;
    let speechLanguageLocked = false;
    let utteranceCoalesce = "";
    let replyClockStartedAt = 0;
    /*
     * voice-no-prompt-in-transcript-v1
     *
     * Steering text we injected into the canonical user message, mapped back to what the
     * caller actually said.
     *
     * `onUserTurnCompleted` gives us the real user chat item, and rewriting it is how we
     * steer the model. But `ConversationItemAdded` then fires with our injected text and
     * saved it as the caller's words — a studio transcript showed a whole user turn reading
     * 'The caller said "Hello?" only to check you are still on the line. Do not greet...'.
     * Recording the real words keeps the model steering and the transcript honest.
     */
    const steeredText = new Map<string, string>();

    function steerModel(message: unknown, instruction: string, callerText: string) {
      setItemText(message, instruction);
      steeredText.set(instruction, callerText);
      if (steeredText.size > 8) {
        const oldest = steeredText.keys().next().value;
        if (oldest !== undefined) steeredText.delete(oldest);
      }
    }
    let utteranceCoalesceAt = 0;
    let coalesceRepeatTimer: ReturnType<typeof setTimeout> | null = null;
    let userTurns = 0;

    function clearCoalesceRepeatTimer() {
      if (coalesceRepeatTimer) {
        clearTimeout(coalesceRepeatTimer);
        coalesceRepeatTimer = null;
      }
    }

    function scheduleCoalesceRepeatPrompt() {
      clearCoalesceRepeatTimer();
      /*
       * voice-no-stale-repeat-prompt-v1 — a real turn between scheduling and firing means
       * we did understand the caller, so asking them to repeat is wrong. `agentBusy` alone
       * missed this: the studio logged "I didn't catch that completely" immediately followed
       * by the correct goodbye, because the timer fired in a gap while the reply was pending.
       */
      const scheduledForTurn = userTurns;
      coalesceRepeatTimer = setTimeout(async () => {
        coalesceRepeatTimer = null;
        if (ending || agentBusy || !utteranceCoalesce.trim()) return;
        if (userTurns !== scheduledForTurn) return;
        if (Date.now() - utteranceCoalesceAt < 5000) return;
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
        const buffered = utteranceCoalesce.trim();
        utteranceCoalesce = "";
        lastRepeatPromptAt = Date.now();
        repeatPromptCount += 1;
        try {
          const listenLine = softListenPrompt(ttsLanguage);
          await session.say(listenLine, { allowInterruptions: true });
          recordTranscriptDetached(callId, "assistant", listenLine);
        } catch {
          /* ignore */
        }
        void buffered;
      }, 6500);
    }

    /*
     * voice-stt-stay-multilingual-v1
     *
     * TTS follows the caller's language, but STT deliberately stays multilingual.
     *
     * Narrowing STT to a single language used to deadlock the call: once STT was pinned
     * to Telugu, a Hindi caller was transcribed as garble, so "please speak Hindi" could
     * never be recognised as a switch request. A call audit found callers asking to switch
     * and then waiting 8-22s in silence. Deepgram nova-3 in multi mode transcribes
     * hi/en/te code-switching cleanly, so there is no accuracy reason to narrow.
     */
    function applySpeechLanguage(next: "en" | "hi" | "te", { lock = false }: { lock?: boolean } = {}) {
      if (!switchLanguages) return;
      if (lock) speechLanguageLocked = true;
      if (next !== ttsLanguage) {
        ttsLanguage = next;
        tts.updateOptions({ language: next as never });
      }
      // Single-language agents never had a multilingual recogniser to preserve.
      if (sttStartLanguage !== "multi" && next !== sttLanguage) {
        sttLanguage = next;
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
      pendingHangup = null;
      clearCoalesceRepeatTimer();
      await recordDisposition(callId, disposition, reason);
      try {
        await session.close();
      } catch {
        /* ignore */
      }
      await ctx.room.disconnect();
    }

    function queueHangup(disposition: string, reason: string) {
      if (ending) return;
      pendingHangup = { disposition: disposition || "success", reason };
      // If agent is already idle, hang up shortly after the goodbye line finishes speaking.
      if (!agentBusy) {
        setTimeout(() => {
          if (pendingHangup && !ending && !agentBusy) {
            void finish(pendingHangup.disposition, pendingHangup.reason);
          }
        }, 700);
      }
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

    const agent = voice.Agent.create({
      instructions: [
        snapshot.instructions || `You are ${snapshot.agent.name}, on a live phone call. Keep replies short and natural.`,
        `You are ${snapshot.agent.name}, the company voice assistant. You are NEVER the customer.`,
        `Never say "Yes, this is [customer name]". If they confirm identity, say "Great, thanks" and continue.`,
        gender === "male"
          ? "You speak with a male voice."
          : "You speak with a female voice.",
        snapshot.greeting
          ? "The greeting has already been spoken. Do not repeat it. Wait for the caller, then continue."
          : "Greet the caller, then wait.",
        "LISTEN FIRST: stay silent while the caller is still talking, including mixed English/Hindi/Telugu. Reply only after they finish a full thought.",
        "When speech is unclear or overlapping, listen quietly like a human. Prefer a soft invite such as \"Sorry — go ahead, I'm listening\" over robotic \"I didn't catch that / please repeat\".",
        "If they say \"continue\", \"go on\", or \"no no continue\", resume your last point — do not restart the greeting or ask them to repeat.",
        "If they say they were not saying anything / ignore that / never mind, stay quiet or say okay briefly and continue — do not interrogate them.",
        "Do not hurry. Do not stack questions. Do not close or wrap up the call unless they clearly say goodbye or not interested.",
        "Speak slowly. One calm sentence. Then wait. Never throw a list of next steps at them.",
        "Never invent remaining phone digits from fragments like z91 or 9120. If you only heard part of a number, wait — do not guess.",
        "Never restart the call or repeat the greeting. If they say hello mid-call, say you are here and continue the last question.",
        "If they start talking while you are speaking, stop immediately and listen to the full sentence, then answer that.",
        "Never invent meaning from one random word (e.g. eating, previously). If still unclear after they finish, softly invite them: \"Sorry — go ahead, I'm listening.\"",
        "When the call should end (success, not interested, goodbye, hang-up request), you MUST call the end_interaction tool. Do not only write [END:...] in your spoken text — the tool actually hangs up.",
        "Never speak the characters [END:success] or any [END:...] tag out loud. Closing line only, then end_interaction.",
        "If they ask you to cut/end/hang up the call, say a short goodbye and call end_interaction immediately.",
        "Keep replies short — one unhurried sentence. Do not lecture.",
        "Short clear Yes/Yeah/Sure answers are confirmations of your last question — keep that context and continue. Never ask them what they mean by a plain Yes.",
        "Elliptical answers like \"Yes, I have\" / \"Yes, I am\" / \"No, I don't\" refer to your previous question. Answer accordingly; never say you are still listening.",
        "If they already said yes / have a minute / go ahead, never ask again whether they have a minute. Answer what the call is about and move to the next useful question.",
        "If they ask what this is about / why you called, answer in one sentence immediately — do not ask them to repeat and do not re-ask permission.",
        "If they say you are not listening, apologise once and answer their last real question. Do not ask them to repeat again.",
        "If interrupted, answer the new point or resume what you were saying — never go silent.",
        "On brief listening sounds (mm-hmm, okay, go on, are you there), acknowledge briefly and continue your last point.",
        "If they agree to WhatsApp or ask for a link, confirm briefly and continue — never go silent after Yes.",
        phoneOnFile
          ? `Caller phone on file: ${phoneOnFile}. When they say "this number", "same number", "use the number you have", or "feed that in memory", confirm WhatsApp to ${phoneOnFile} — do not ask for the number again unless they give a different one.`
          : "",
        "If they say hello repeatedly, they are checking you are still there — respond briefly and continue the last topic.",
      ]
        .filter(Boolean)
        .join("\n\n"),
      onUserTurnCompleted: async (_agentCtx, _chatCtx, newMessage) => {
        const chunk = itemText(newMessage);
        const now = Date.now();
        if (utteranceCoalesce && now - utteranceCoalesceAt > 10_000) {
          utteranceCoalesce = "";
        }
        const text = mergeUtterance(utteranceCoalesce, chunk);
        utteranceCoalesceAt = now;

        const turn = decideUserTurn(text, {
          greetingActive,
          listenAfter,
          lastSpoken,
          ttsLanguage,
        });
        if (turn === "ignore") {
          // voice-ignore-no-coalesce-v1 — do not merge agent echo into the next real sentence
          throw new StopResponse();
        }
        if (turn === "noise_repair") {
          /*
           * voice-language-switch-priority-v1 — a partially garbled turn can still carry a
           * legible "speak Hindi". Switch now even though we are not replying to this turn,
           * so the retry the caller is about to make is already in the right language.
           */
          const requested = detectExplicitLanguageSwitch(text);
          if (requested) applySpeechLanguage(requested, { lock: true });
          utteranceCoalesce = text;
          scheduleCoalesceRepeatPrompt();
          // Still persist what we heard so the studio timeline is not blank mid-utterance.
          recordTranscriptDetached(callId, "user", text);
          throw new StopResponse();
        }
        /*
         * voice-purpose-question-v1 — if we buffered a prior turn as "incomplete" and the
         * caller then complains we are not listening, answer that buffered line instead of
         * asking them to repeat again (call_d99d3a05-2).
         */
        const priorBuffered = utteranceCoalesce.trim();
        clearCoalesceRepeatTimer();
        // Caller checking in while we were speaking — resume prior line, do not restart the flow.
        if (turn === "backchannel" && agentBusy && !greetingActive && !isPresenceCheck(text)) {
          throw new StopResponse();
        }
        utteranceCoalesce = "";
        // voice-reply-ttfb-metric-v1 — measure accepted-turn -> first agent audio.
        replyClockStartedAt = now;
        userTurns += 1;
        let replyText = text;
        if (
          priorBuffered
          && priorBuffered !== text
          && isListeningComplaint(chunk)
          && (isPurposeQuestion(priorBuffered) || grantsTalkTime(priorBuffered) || priorBuffered.split(/\s+/).length >= 4)
        ) {
          replyText = priorBuffered;
          steerModel(
            newMessage,
            `The caller already said: "${priorBuffered}". They are upset that you asked them to repeat. ` +
              `Apologise once briefly, answer that line directly, and continue. ` +
              `If they already granted a minute, do NOT ask whether they have a minute again. ` +
              `If they asked what this is about, explain the purpose in one sentence, then ask the next useful question.`,
            text
          );
        } else {
          const switchRequest = detectExplicitLanguageSwitch(text);
          if (switchRequest) {
            /*
             * voice-language-switch-priority-v1 — switch the voice before generating.
             * If the same turn also affirms ("talk in English? Yes. Go ahead."), do NOT
             * re-ask identity/permission — continue the flow (Priya call_8a2a9ee8-5).
             */
            applySpeechLanguage(switchRequest, { lock: true });
            const language =
              switchRequest === "hi" ? "Hindi" : switchRequest === "te" ? "Telugu" : "English";
            const alsoAffirms =
              isEllipticalAffirmation(text)
              || grantsTalkTime(text)
              || /\b(yes|yeah|yep|sure|ok|okay|go ahead)\b/i.test(text);
            if (alsoAffirms) {
              const prior = lastSpoken ? lastSpoken.slice(0, 160) : "";
              steerModel(
                newMessage,
                `The caller asked to speak ${language} and already agreed to continue ("${text}"). ` +
                  `From now on speak only ${language}. Do not apologise at length. Do not re-ask name or thirty seconds. ` +
                  (prior
                    ? `Treat their yes/go-ahead as answering: ${prior}. Move to the next useful point.`
                    : `Briefly confirm ${language}, then move to the next useful point.`),
                text
              );
            } else {
              const resume = lastSpoken ? lastSpoken.slice(0, 160) : "the question you last asked";
              steerModel(
                newMessage,
                `The caller cannot understand the language you were speaking and asked you to switch to ${language}. ` +
                  `From now on speak only ${language}. Do not greet again and do not restart the call. ` +
                  `Briefly apologise in ${language}, then ask again, in ${language}: ${resume}`,
                text
              );
            }
          } else if (isExplicitHangupRequest(text)) {
            steerModel(
              newMessage,
              `The caller wants the call ended now. They said: "${text}". ` +
                `Speak one short goodbye in the active language, then call end_interaction with disposition success (or not_interested if they refused). Do not ask another question.`,
              text
            );
          } else if (wantsAgentToContinue(text)) {
            const resume = lastSpoken ? lastSpoken.slice(0, 160) : "the point you were making";
            steerModel(
              newMessage,
              `The caller wants you to continue speaking. They said: "${text}". ` +
                `Do not apologise robotically and do not ask them to repeat. ` +
                `Pick up naturally from where you left off: ${resume}`,
              text
            );
          } else if (isPresenceCheck(text) && userTurns > 1) {
            const resume = lastSpoken ? lastSpoken.slice(0, 160) : "the last question you asked";
            steerModel(
              newMessage,
              `The caller said "${text}" only to check you are still on the line. Do not greet. Do not restart the call. Briefly say you are here, then continue: ${resume}`,
              text
            );
          } else if (isEllipticalAffirmation(text) || isPurposeQuestion(text) || grantsTalkTime(text)) {
            const prior = lastSpoken ? lastSpoken.slice(0, 180) : "";
            steerModel(
              newMessage,
              `The caller gave a short answer: "${text}". ` +
                (prior
                  ? `This answers your previous question/line: "${prior}". Interpret it in that context. `
                  : "") +
                `Do NOT say you are listening. Do NOT ask them to repeat. Do NOT re-ask the same permission/identity question. Continue to the next useful step.`,
              text
            );
          } else if (text !== chunk) {
            setItemText(newMessage, text);
          }
        }
        syncSpeechLanguageFromUserText(replyText);
      },
      tools: {
        query_knowledge: llm.tool({
          description: "Look up facts from attached knowledge bases.",
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
            "REQUIRED to hang up. Call this whenever the conversation is finished: success, not interested, goodbye, callback, or the caller asks to cut/end the call. Speak the closing line first (or pass it as goodbye), then invoke this tool. Never skip this tool or the call stays open.",
          parameters: z.object({
            goodbye: z.string().describe("Exact closing line spoken before hangup"),
            disposition: z
              .string()
              .describe("not_interested | do_not_call | success | callback_requested | wrong_person | qualified"),
          }),
          execute: async ({ goodbye, disposition }, { ctx: toolCtx }) => {
            const result = await callTool(callId, "end_interaction", { goodbye, disposition });
            const spoken = stripEndTag(String(result.say || goodbye || "").trim());
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
              recordTranscriptDetached(callId, "assistant", spoken);
            }
            await new Promise((resolve) => setTimeout(resolve, 600));
            await finish(result.disposition || disposition || "success", "agent_end");
            return result.result || "Call ended.";
          },
        }),
        transfer_to_human: llm.tool({
          description: "Warm-transfer the live call to a human.",
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
            recordTranscriptDetached(callId, "assistant", spoken);
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
      const text = String(event.transcript || "").trim();
      if (!text || shouldIgnoreUserAudio(text)) return;
      syncSpeechLanguageFromUserText(text, event.language || undefined);
    });

    session.on(voice.AgentSessionEventTypes.ConversationItemAdded, (event) => {
      if (ending) return;
      const item = event.item as { role?: string; text?: string; content?: unknown };
      const role = item.role === "user" ? "user" : item.role === "assistant" ? "assistant" : "";
      const raw = itemText(item);
      // voice-no-prompt-in-transcript-v1 — save the caller's words, not our steering prompt.
      const text = (role === "user" ? steeredText.get(raw) : undefined) ?? raw;
      if (!role || !text) return;
      if (text.includes("[Unclear speech:")) return;
      if (role === "assistant") {
        /*
         * voice-end-tag-hangup-v1 — LiveKit Gemma often writes chat-style [END:success]
         * instead of calling end_interaction. Without this fallback the room stays open
         * (call_6fca168b-b: user had to ask "काट दो" and still status=dropped).
         */
        const parsed = parseEndTag(text);
        lastSpoken = parsed.text || text;
        recordTranscriptDetached(callId, role, parsed.text || text);
        if (parsed.endCall) {
          queueHangup(parsed.disposition || "success", "end_tag");
        }
        return;
      }
      if (role === "user") {
        if (shouldIgnoreUserAudio(text)) return;
        // voice-persist-partial-user-text-v1 — a fragment is still the caller's words, so
        // persist it for the timeline; the backend merges extend/join into one message.
        // Only language sync is gated, since a fragment is a poor language signal.
        if (!isIncompleteUserUtterance(text) && !looksLikeSttNoise(text, ttsLanguage)) {
          syncSpeechLanguageFromUserText(text);
        }
      }
      recordTranscriptDetached(callId, role, text);
    });

    session.on(voice.AgentSessionEventTypes.AgentStateChanged, (event) => {
      const next = String((event as { newState?: string }).newState || "");
      const wasBusy = agentBusy;
      agentBusy = next === "speaking" || next === "thinking";
      // voice-reply-ttfb-metric-v1 — the gap the caller actually perceives as lag.
      if (next === "speaking" && replyClockStartedAt) {
        recordMetricDetached(callId, "reply_ttfb_ms", Date.now() - replyClockStartedAt);
        replyClockStartedAt = 0;
      }
      // Hang up once the goodbye line has finished playing.
      if (wasBusy && !agentBusy && pendingHangup && !ending) {
        const hang = pendingHangup;
        setTimeout(() => {
          if (!ending && pendingHangup) {
            void finish(hang.disposition, hang.reason);
          }
        }, 400);
      }
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
        const listenLine = softListenPrompt(ttsLanguage);
        await session.say(listenLine, { allowInterruptions: true });
      } catch {
        /* ignore */
      }
    });

    const useBvc = String(process.env.LIVEKIT_VOICE_BVC || "1").trim() !== "0";
    await session.start({
      agent,
      room: ctx.room,
      inputOptions: {
        closeOnDisconnect: true,
        noiseCancellation: useBvc ? BackgroundVoiceCancellation() : undefined,
      },
      outputOptions: {
        transcriptionEnabled: true,
        syncTranscription: false,
      },
    });

    if (snapshot.greeting) {
      greetingActive = true;
      lastSpoken = snapshot.greeting;
      const greetStarted = Date.now();
      const handle = session.say(snapshot.greeting, { allowInterruptions: false });
      recordTranscriptDetached(callId, "assistant", snapshot.greeting);
      /*
       * voice-greeting-playout-watchdog-v1 — never block the session on playout completing.
       * If waitForPlayout() hangs, greetingActive would stay true and the caller would be
       * ignored indefinitely; bounding the wait guarantees we start listening.
       */
      const budgetMs = greetingPlayoutBudgetMs(snapshot.greeting);
      let playoutTimer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        handle
          .waitForPlayout()
          .then(() => false)
          .catch(() => false),
        new Promise<boolean>((resolve) => {
          playoutTimer = setTimeout(() => resolve(true), budgetMs);
        }),
      ]);
      if (playoutTimer) clearTimeout(playoutTimer);
      if (timedOut) {
        console.warn(
          `Call ${callId}: greeting playout did not finish within ${budgetMs}ms — listening anyway`
        );
        recordMetricDetached(callId, "greeting_playout_timeout_ms", budgetMs);
      }
      recordMetricDetached(callId, "greeting_ms", Date.now() - greetStarted);
      greetingActive = false;
      listenAfter = Date.now() + POST_GREETING_ECHO_MS;
    }

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
