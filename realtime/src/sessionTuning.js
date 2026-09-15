/**
 * LiveKit voice session tuning — keep close to SDK defaults (Retell/Vapi-style).
 */

import {
  detectExplicitLanguageSwitch,
  isEllipticalAffirmation,
  isIncompleteUserUtterance,
  isLikelyAgentEcho,
  isNotSpeakingCue,
  isUserBackchannel,
  looksLikeSttNoise,
  wantsAgentToContinue,
} from "./speechLanguage.js";
import { isExplicitHangupRequest } from "./hangup.js";

/** SDK default — let WebRTC AEC warm up before turn-taking. */
export const AEC_WARMUP_MS = 3000;

export const USER_AWAY_TIMEOUT_S = 45;

/** Disabled — empty VAD during agent TTS must not spam "didn't catch that". */
export const TRANSCRIPTION_TIMEOUT_MS = null;

/** Brief echo-ignore window after the greeting finishes. */
export const POST_GREETING_ECHO_MS = 800;

/**
 * Deepgram + dynamic endpointing — wait through slow / mixed-language speech.
 *
 * voice-pause-endpointing-v1 REVERTED: 2800/2200-4800 added ~600ms to perceived
 * latency. Mid-sentence cutoffs are handled by hasOpenLanguageTail instead.
 *
 * voice-snappier-endpointing-v1: measured reply_ttfb_ms on a real call averaged 483ms,
 * so this wait — not generation — was nearly all the dead air a caller feels. Trimmed
 * ~700ms per turn. The safety net for cutting people off is not this timer: an utterance
 * that still looks mid-thought is classified `noise_repair` and coalesced into the next
 * chunk, so a premature endpoint costs a merge rather than a wrong reply.
 */
export const STT_ENDPOINTING_MS = 1500;
export const ENDPOINTING_MIN_DELAY_MS = 1200;
export const ENDPOINTING_MAX_DELAY_MS = 3000;
export const ENDPOINTING_DYNAMIC_ALPHA = 0.93;

/** Let the caller finish — only real multi-word barge-in cuts agent speech. */
export const INTERRUPTION_MIN_DURATION_MS = 750;
export const INTERRUPTION_MIN_WORDS = 4;
export const INTERRUPTION_BACKCHANNEL_MS = 300;

export const REPEAT_PROMPT_COOLDOWN_MS = 20_000;
export const MAX_REPEAT_PROMPTS_PER_CALL = 1;

/** Floor and ceiling for how long we will ever wait on greeting audio to finish. */
export const GREETING_PLAYOUT_MIN_MS = 15_000;
export const GREETING_PLAYOUT_MAX_MS = 45_000;

/**
 * voice-greeting-playout-watchdog-v1
 *
 * How long the greeting could legitimately take to play, plus slack. `waitForPlayout()`
 * can hang without rejecting; when it does, `greetingActive` never clears and the session
 * keeps discounting caller audio. A call audit caught a greeting that stopped after its
 * first clause and left 50s of silence while the caller talked and was ignored.
 *
 * Budget is generous on purpose — this is a stall detector, not a latency control. Cutting
 * a greeting short is worse than waiting a few extra seconds.
 */
export function greetingPlayoutBudgetMs(text, { speed = 0.88 } = {}) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean).length;
  if (!words) return GREETING_PLAYOUT_MIN_MS;
  // ~2.6 words/sec of synthesized speech at speed 1.0, scaled by the configured rate.
  const spokenMs = (words / 2.6) * 1000 / (speed > 0 ? speed : 1);
  const budget = spokenMs * 1.8 + 6000;
  return Math.min(GREETING_PLAYOUT_MAX_MS, Math.max(GREETING_PLAYOUT_MIN_MS, Math.round(budget)));
}

export function shouldPromptOnTranscriptionTimeout({
  ending = false,
  greetingActive = false,
  agentBusy = false,
  lastPromptAt = 0,
  promptCount = 0,
  now = Date.now(),
  cooldownMs = REPEAT_PROMPT_COOLDOWN_MS,
  maxPrompts = MAX_REPEAT_PROMPTS_PER_CALL,
} = {}) {
  if (ending || greetingActive || agentBusy) return false;
  if (promptCount >= maxPrompts) return false;
  if (lastPromptAt && now - lastPromptAt < cooldownMs) return false;
  return true;
}

/** Drop obvious speaker→mic echo of the agent's last line. */
export function shouldIgnoreUserAudio(
  text,
  {
    greetingActive = false,
    listenAfter = 0,
    lastSpoken = "",
    ttsLanguage = "en",
    now = Date.now(),
  } = {}
) {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (greetingActive || now < listenAfter) {
    if (isLikelyAgentEcho(raw, lastSpoken) || looksLikeSttNoise(raw, ttsLanguage)) {
      return true;
    }
  }
  if (isLikelyAgentEcho(raw, lastSpoken)) {
    // Real one-word phone answers must not be dropped as greeting echo.
    if (/^(hi|hello|hey|yes|yeah|sure|ok|okay)\.?$/i.test(raw)) return false;
    return true;
  }
  return false;
}

export function mergeUtterance(existing, next) {
  const a = String(existing || "").trim();
  const b = String(next || "").trim();
  if (!a) return b;
  if (!b) return a;
  if (b === a) return a;
  if (b.startsWith(a)) return b;
  if (a.startsWith(b)) return a;
  if (a.includes(b)) return a;
  if (b.includes(a)) return b;
  return `${a} ${b}`.replace(/\s+/g, " ").trim();
}

export function decideUserTurn(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw || shouldIgnoreUserAudio(raw, opts)) return "ignore";
  // voice-human-listen-v1 — they weren't talking / it was noise: stay quiet.
  if (isNotSpeakingCue(raw)) return "ignore";
  if (isUserBackchannel(raw)) return "backchannel";
  // voice-control-before-incomplete-v1 — only exact short commands, not any phrase starting with "no"
  if (isForcedCompleteCommand(raw)) return "reply";
  // "Yes, I have." / "Yes, I am." — elliptical answers to the prior question.
  if (isEllipticalAffirmation(raw)) return "reply";
  // "no no continue" / "go on" — resume what you were saying, like a human.
  if (wantsAgentToContinue(raw)) return "reply";
  // Explicit hang-up / cut-the-call requests are real turns.
  if (isExplicitHangupRequest(raw)) return "reply";
  // voice-language-switch-priority-v1 — "please speak Hindi" must never be swallowed as
  // noise; being stuck in the wrong language is the caller's most urgent problem.
  if (detectExplicitLanguageSwitch(raw)) return "reply";
  if (isIncompleteUserUtterance(raw)) return "noise_repair";
  if (looksLikeSttNoise(raw, opts.ttsLanguage || "en")) return "noise_repair";
  return "reply";
}

/** Short polite/hard closes that are complete thoughts, not STT bleed. */
export function isClearCallerClose(text) {
  const normalized = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return /^(goodbye|good bye|bye|thank you|thanks|thanks a lot|thank you so much|that'?s all|thats all|not interested|no thanks)$/i.test(
    normalized
  );
}

/** Exact interrupt/close commands — must not match longer incomplete bleed like "no no you are going". */
export function isForcedCompleteCommand(text) {
  const normalized = String(text || "")
    .trim()
    .replace(/[^\p{L}\p{M}\p{N}\s']+/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  if (
    /^(stop|wait|hold on|please stop|stop talking|रुको|रुकिए|बस|मत बोलो|ఆపు|వద్దు|చాలు)$/i.test(
      normalized
    )
  ) {
    return true;
  }
  if (/^(don't call|do not call|not interested)$/i.test(normalized)) return true;
  return isClearCallerClose(normalized);
}

export function countRepeatPrompts(events = []) {
  let promptCount = 0;
  let lastPromptAt = 0;
  for (const event of events) {
    const now = event.now ?? Date.now();
    if (
      shouldPromptOnTranscriptionTimeout({
        ending: Boolean(event.ending),
        greetingActive: Boolean(event.greetingActive),
        agentBusy: Boolean(event.agentBusy),
        lastPromptAt,
        promptCount,
        now,
        cooldownMs: event.cooldownMs ?? REPEAT_PROMPT_COOLDOWN_MS,
        maxPrompts: event.maxPrompts ?? MAX_REPEAT_PROMPTS_PER_CALL,
      })
    ) {
      promptCount += 1;
      lastPromptAt = now;
    }
  }
  return promptCount;
}

export function buildLiveKitSessionOptions(overrides = {}) {
  return {
    aecWarmupDuration: AEC_WARMUP_MS,
    userAwayTimeout: USER_AWAY_TIMEOUT_S,
    transcriptionTimeout: TRANSCRIPTION_TIMEOUT_MS,
    turnHandling: {
      interruption: {
        enabled: true,
        minDuration: INTERRUPTION_MIN_DURATION_MS,
        minWords: INTERRUPTION_MIN_WORDS,
        resumeFalseInterruption: true,
        discardAudioIfUninterruptible: true,
        backchannelBoundary: INTERRUPTION_BACKCHANNEL_MS,
      },
      endpointing: {
        // Cast keeps the literal type when this JS module is consumed from agent.ts.
        mode: /** @type {"dynamic"} */ ("dynamic"),
        alpha: ENDPOINTING_DYNAMIC_ALPHA,
        minDelay: ENDPOINTING_MIN_DELAY_MS,
        maxDelay: ENDPOINTING_MAX_DELAY_MS,
      },
      /*
       * voice-preemptive-generation-v1
       *
       * Start LLM inference on the interim transcript so the reply is already in flight
       * when endpointing confirms the turn. This is the SDK default; disabling it was
       * costing roughly a full LLM time-to-first-token on every turn, and a call audit
       * measured reply latency well above target because of it.
       *
       * Correctness is guaranteed by the SDK, not by us: after `onUserTurnCompleted` it
       * compares the preemptive transcript against the final one and cancels the speech
       * handle on any mismatch. So every turn we rewrite via setItemText, or drop with
       * StopResponse, discards its preemptive result and falls back to normal generation.
       * The speedup lands on clean pass-through turns, which are the common case.
       *
       * preemptiveTts stays off (also the SDK default): synthesizing audio that may be
       * thrown away costs TTS on every discarded turn for a much smaller gain.
       */
      preemptiveGeneration: {
        enabled: true,
        preemptiveTts: false,
        maxSpeechDuration: 10_000,
        maxRetries: 3,
      },
    },
    ...overrides,
  };
}

export function isEmptyVadAfterMuteFailure({
  audioTranscript = "",
  interimTranscript = "",
  userAwayTriggered = false,
  skippedBecausePaused = false,
} = {}) {
  const empty = !String(audioTranscript || "").trim();
  const hadInterim = Boolean(String(interimTranscript || "").trim());
  return empty && hadInterim && Boolean(userAwayTriggered || skippedBecausePaused);
}

export function isIncompleteLanguageSwitchUtterance(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/[\u0900-\u097F]/.test(raw) && raw.length < 40 && /आपने$|मैं$|के लिए$|रजिस्ट्रेशन$/.test(raw)) {
    return true;
  }
  return /[\u0900-\u097F]/.test(raw) && !/[।?!.]$/.test(raw) && raw.split(/\s+/).length <= 12;
}

export function shouldAskRepeatInsteadOfEnd(text = "", _language = "en") {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (/^(hello\??|are you there\??|yeah\.?|yes\.?)$/i.test(raw)) return true;
  if (/hello\??\s*are you there/i.test(raw) && raw.length < 40) return true;
  if (isIncompleteLanguageSwitchUtterance(raw)) return true;
  return false;
}
