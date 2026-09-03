/**
 * Shared LiveKit voice-session tuning.
 * Units match @livekit/agents AgentSessionOptions (milliseconds / seconds as noted).
 */

import { isLikelyAgentEcho, looksLikeSttNoise } from "./speechLanguage.js";

/** AEC warmup must be real milliseconds. 0.35 was treated as 0.35ms and re-enabled barge-in mid-greeting. */
export const AEC_WARMUP_MS = 3000;

/** Default LiveKit away timeout is 15s — too short when STT finals lag behind VAD. */
export const USER_AWAY_TIMEOUT_S = 45;

/**
 * When VAD hears speech but STT never finals. SDK default is null (disabled).
 * A short timeout (e.g. 2500) fires on agent-echo / empty VAD and caused the
 * agent to spam "I didn't catch that clearly..." in a loop.
 * Keep disabled now that we no longer mute the mic during greeting.
 */
export const TRANSCRIPTION_TIMEOUT_MS = null;

/** Soft window after greeting playout where echo of the agent line is ignored. */
export const POST_GREETING_ECHO_MS = 800;

/** Minimum gap between "say that again" prompts if a timeout handler is enabled. */
export const REPEAT_PROMPT_COOLDOWN_MS = 20_000;

/** Cap how many times we ask the caller to repeat in one call. */
export const MAX_REPEAT_PROMPTS_PER_CALL = 1;

/**
 * Decide whether to speak the transcription-timeout recovery line.
 * Empty VAD during agent TTS must never trigger another spoken prompt.
 */
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

/**
 * Whether mic text should be dropped (echo / greeting bleed) instead of answered.
 */
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
  if (isLikelyAgentEcho(raw, lastSpoken)) return true;
  return false;
}

/**
 * High-level turn policy used by regression scenarios (mirrors LiveKit agent decisions).
 * @returns {"ignore"|"noise_repair"|"reply"}
 */
export function decideUserTurn(text, opts = {}) {
  const raw = String(text || "").trim();
  if (!raw || shouldIgnoreUserAudio(raw, opts)) return "ignore";
  if (looksLikeSttNoise(raw, opts.ttsLanguage || "en")) return "noise_repair";
  return "reply";
}

/**
 * Simulate a sequence of transcription-timeout events; returns spoken prompt count.
 * Catches the client-demo failure where "didn't catch that" was said again and again.
 */
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
    ...overrides,
  };
}

/**
 * Detects the “muted during greeting then VAD with empty transcript” failure mode
 * from LiveKit worker logs.
 */
export function isEmptyVadAfterMuteFailure({
  audioTranscript,
  interimTranscript,
  userAwayTriggered,
  skippedBecausePaused,
} = {}) {
  const empty = !String(audioTranscript || "").trim();
  const hadInterim = Boolean(String(interimTranscript || "").trim());
  return empty && hadInterim && Boolean(userAwayTriggered || skippedBecausePaused);
}

/**
 * Incomplete language-switch TTS (Pipecat): Hindi line cut mid-sentence then
 * English “Hello? Are you there?” from the caller.
 */
export function isIncompleteLanguageSwitchUtterance(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (/[\u0900-\u097F]/.test(raw) && raw.length < 40 && /आपने$|मैं$|के लिए$|रजिस्ट्रेशन$/.test(raw)) {
    return true;
  }
  return /[\u0900-\u097F]/.test(raw) && !/[।?!.]$/.test(raw) && raw.split(/\s+/).length <= 12;
}

export function shouldAskRepeatInsteadOfEnd(text = "", language = "en") {
  const raw = String(text || "").trim();
  if (!raw) return true;
  if (/^(hello\??|are you there\??|yeah\.?|yes\.?)$/i.test(raw)) return true;
  if (/hello\??\s*are you there/i.test(raw) && raw.length < 40) return true;
  if (isIncompleteLanguageSwitchUtterance(raw)) return true;
  return false;
}
