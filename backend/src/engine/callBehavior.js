export function agentCallSettings(agent) {
  return agent?.callSettings && typeof agent.callSettings === "object" ? agent.callSettings : {};
}

export function callTimedOut(call, agent) {
  const minutes = Number(agentCallSettings(agent).maxCallMinutes || 0);
  if (!minutes || minutes <= 0) return false;
  const start = Date.parse(call?.startedAt || call?.createdAt || 0);
  if (!start) return false;
  return Date.now() - start >= minutes * 60_000;
}

export function isMachineAnswer(answeredBy) {
  const value = String(answeredBy || "").toLowerCase();
  return (
    value.startsWith("machine") ||
    value === "fax" ||
    value.includes("voicemail") ||
    value === "machine_start" ||
    value === "machine_end_beep" ||
    value === "machine_end_silence" ||
    value === "machine_end_other"
  );
}

/**
 * Decide what to say (or hang up) when the caller is silent on a telephony turn.
 * Tracks call.nudgeIndex across gathers.
 */
export function silenceAction(call, agent, { missedFallback = "" } = {}) {
  const settings = agentCallSettings(agent);
  const nudges = Array.isArray(settings.nudges) ? settings.nudges.filter((n) => String(n?.message || "").trim()) : [];
  const enabled = Boolean(settings.nudgeEnabled) && nudges.length > 0;
  const index = Number(call?.nudgeIndex || 0);

  if (!enabled) {
    return { kind: "prompt", text: missedFallback, hangup: false, nextIndex: index };
  }

  if (index < nudges.length) {
    const nudge = nudges[index];
    return {
      kind: "nudge",
      text: String(nudge.message || "").trim(),
      hangup: false,
      nextIndex: index + 1,
      afterSeconds: Number(nudge.afterSeconds || 5),
    };
  }

  if (settings.hangupAfterNudges) {
    return {
      kind: "hangup",
      text: "",
      hangup: true,
      nextIndex: index,
      reason: "No response after nudges",
    };
  }

  return { kind: "prompt", text: missedFallback, hangup: false, nextIndex: index };
}

export function voicemailMessage(agent) {
  const settings = agentCallSettings(agent);
  if (!settings.voicemailEnabled) return "";
  return String(settings.voicemailMessage || "").trim();
}
