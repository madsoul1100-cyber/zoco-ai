/**
 * voice-conversation-script-v1
 * Pure simulator of onUserTurnCompleted decisioning — no LiveKit / mic required.
 * Use this to replay human-like multi-turn scripts before changing live voice.
 */
import { isPresenceCheck } from "./speechLanguage.js";
import { decideUserTurn, mergeUtterance } from "./sessionTuning.js";

/**
 * @typedef {{
 *   user: string,
 *   label?: string,
 *   greetingActive?: boolean,
 *   agentBusy?: boolean,
 *   lastSpoken?: string,
 *   ttsLanguage?: string,
 *   listenAfter?: number,
 *   now?: number,
 * }} ScriptTurn
 *
 * @typedef {{
 *   label: string,
 *   user: string,
 *   turn: "ignore" | "backchannel" | "noise_repair" | "reply",
 *   stopResponse: boolean,
 *   accepted: boolean,
 *   acceptedTurns: number,
 *   effectiveUserText: string,
 *   coalesce: string,
 *   note: string,
 * }} ScriptResult
 */

export function createTurnSimulator(seed = {}) {
  let acceptedTurns = Number(seed.acceptedTurns || 0);
  let utteranceCoalesce = String(seed.utteranceCoalesce || "");
  let lastSpoken = String(seed.lastSpoken || "");
  let ttsLanguage = seed.ttsLanguage || "en";
  let greetingActive = Boolean(seed.greetingActive);
  let agentBusy = Boolean(seed.agentBusy);
  let listenAfter = Number(seed.listenAfter || 0);

  function setContext(patch = {}) {
    if ("acceptedTurns" in patch) acceptedTurns = Number(patch.acceptedTurns);
    if ("utteranceCoalesce" in patch) utteranceCoalesce = String(patch.utteranceCoalesce || "");
    if ("lastSpoken" in patch) lastSpoken = String(patch.lastSpoken || "");
    if ("ttsLanguage" in patch) ttsLanguage = patch.ttsLanguage || "en";
    if ("greetingActive" in patch) greetingActive = Boolean(patch.greetingActive);
    if ("agentBusy" in patch) agentBusy = Boolean(patch.agentBusy);
    if ("listenAfter" in patch) listenAfter = Number(patch.listenAfter || 0);
  }

  /**
   * Run one user utterance through the same decision order as the LiveKit worker.
   * @param {ScriptTurn} step
   * @returns {ScriptResult}
   */
  function handleUser(step) {
    const user = String(step.user || "").trim();
    const label = step.label || user;
    if ("greetingActive" in step) greetingActive = Boolean(step.greetingActive);
    if ("agentBusy" in step) agentBusy = Boolean(step.agentBusy);
    if ("lastSpoken" in step) lastSpoken = String(step.lastSpoken || lastSpoken);
    if ("ttsLanguage" in step) ttsLanguage = step.ttsLanguage || ttsLanguage;
    if ("listenAfter" in step) listenAfter = Number(step.listenAfter ?? listenAfter);

    const merged = mergeUtterance(utteranceCoalesce, user);
    const turn = decideUserTurn(merged, {
      greetingActive,
      listenAfter,
      lastSpoken,
      ttsLanguage,
      now: step.now ?? Date.now(),
    });

    if (turn === "ignore") {
      // Echo must not poison the next real sentence (voice-ignore-no-coalesce-v1).
      return {
        label,
        user,
        turn,
        stopResponse: true,
        accepted: false,
        acceptedTurns,
        effectiveUserText: merged,
        coalesce: utteranceCoalesce,
        note: "ignored (echo/noise) — no coalesce, agent stays silent",
      };
    }

    if (turn === "noise_repair") {
      utteranceCoalesce = merged;
      return {
        label,
        user,
        turn,
        stopResponse: true,
        accepted: false,
        acceptedTurns,
        effectiveUserText: merged,
        coalesce: utteranceCoalesce,
        note: "incomplete — keep listening / coalesce; do not reply yet",
      };
    }

    if (turn === "backchannel" && agentBusy && !greetingActive && !isPresenceCheck(merged)) {
      return {
        label,
        user,
        turn,
        stopResponse: true,
        accepted: false,
        acceptedTurns,
        effectiveUserText: merged,
        coalesce: utteranceCoalesce,
        note: "backchannel while agent speaking — resume prior line, no new reply",
      };
    }

    utteranceCoalesce = "";
    acceptedTurns += 1;
    let effectiveUserText = merged;
    let note = "reply to LLM with caller words";

    if (isPresenceCheck(merged) && acceptedTurns > 1) {
      const resume = lastSpoken ? lastSpoken.slice(0, 160) : "the last question";
      effectiveUserText = `presence-check:${merged} → resume:${resume}`;
      note = "mid-call hello — tell model to confirm presence and resume last question";
    }

    return {
      label,
      user,
      turn: "reply",
      stopResponse: false,
      accepted: true,
      acceptedTurns,
      effectiveUserText,
      coalesce: utteranceCoalesce,
      note,
    };
  }

  /** @param {ScriptTurn[]} script */
  function runScript(script = []) {
    return script.map((step) => handleUser(step));
  }

  return {
    handleUser,
    runScript,
    setContext,
    getState: () => ({
      acceptedTurns,
      utteranceCoalesce,
      lastSpoken,
      ttsLanguage,
      greetingActive,
      agentBusy,
      listenAfter,
    }),
  };
}
