const RECALL_DISPOSITIONS = new Set([
  "no_answer",
  "busy",
  "dropped",
  "voicemail",
  "callback_requested",
  "failed",
]);

export const CALL_STATUSES = [
  "queued",
  "ringing",
  "in_progress",
  "completed",
  "no_answer",
  "busy",
  "voicemail",
  "dropped",
  "failed",
];

export const DISPOSITIONS = [
  { id: "in_progress", label: "Call in progress", kind: "live" },
  { id: "success", label: "Successful outcome", kind: "done" },
  { id: "qualified", label: "Lead qualified", kind: "done" },
  { id: "booked", label: "Appointment booked", kind: "done" },
  { id: "not_interested", label: "Not interested", kind: "done" },
  { id: "do_not_call", label: "Do not call", kind: "done" },
  { id: "callback_requested", label: "Customer asked to be recalled", kind: "recall" },
  { id: "no_answer", label: "No answer", kind: "recall" },
  { id: "busy", label: "Busy", kind: "recall" },
  { id: "voicemail", label: "Voicemail", kind: "recall" },
  { id: "dropped", label: "Dropped mid-call", kind: "recall" },
  { id: "failed", label: "Failed / error", kind: "recall" },
];

export function applyOutcome(call, { status, disposition, reason }, rules) {
  const now = new Date();
  const next = { ...call };
  next.status = status || next.status;
  next.disposition = disposition || mapStatusToDisposition(next.status);
  next.endedAt = ["ringing", "queued", "in_progress"].includes(next.status)
    ? null
    : now.toISOString();
  if (next.startedAt && next.endedAt) {
    next.durationSeconds = Math.max(
      0,
      Math.round((Date.parse(next.endedAt) - Date.parse(next.startedAt)) / 1000)
    );
  }
  next.outcomeReason = reason || next.outcomeReason || null;
  next.recall = planRecall(next, rules, now);
  return next;
}

export function planRecall(call, rules, now = new Date()) {
  const attempts = Number(call.attempt || 1);
  const disposition = call.disposition || mapStatusToDisposition(call.status);
  const recallOn = new Set(rules.recallOn || [...RECALL_DISPOSITIONS]);
  const success = new Set(rules.successDispositions || []);

  if (success.has(disposition) || disposition === "do_not_call") {
    return {
      needed: false,
      reason: null,
      scheduledAt: null,
      attempt: attempts,
      maxAttempts: rules.maxAttempts,
    };
  }

  const shouldRecall = recallOn.has(disposition) && attempts < Number(rules.maxAttempts || 3);
  if (!shouldRecall) {
    return {
      needed: false,
      reason: attempts >= rules.maxAttempts ? "max_attempts_reached" : null,
      scheduledAt: null,
      attempt: attempts,
      maxAttempts: rules.maxAttempts,
    };
  }

  const delayMinutes = Number(rules.delaysMinutes?.[disposition] ?? 60);
  return {
    needed: true,
    reason: disposition,
    scheduledAt: new Date(now.getTime() + delayMinutes * 60 * 1000).toISOString(),
    attempt: attempts,
    maxAttempts: rules.maxAttempts,
    delayMinutes,
  };
}

export function mapStatusToDisposition(status) {
  if (status === "completed") return "success";
  if (status === "in_progress") return "in_progress";
  if (status === "ringing" || status === "queued") return "in_progress";
  return status;
}

export function dashboardStats(calls) {
  const now = Date.now();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayMs = today.getTime();

  const live = calls.filter((c) => ["ringing", "in_progress", "queued"].includes(c.status));
  const recall = calls.filter((c) => c.recall?.needed);
  const due = recall.filter((c) => Date.parse(c.recall.scheduledAt) <= now);
  const successful = calls.filter((c) =>
    ["success", "qualified", "booked"].includes(c.disposition)
  );
  const todayCalls = calls.filter((c) => Date.parse(c.startedAt || c.createdAt) >= todayMs);

  return {
    totalCalls: calls.length,
    todayCalls: todayCalls.length,
    liveCalls: live.length,
    successfulCalls: successful.length,
    recallDue: due.length,
    recallScheduled: recall.length,
    connectRate: rate(calls.filter((c) => c.status === "completed" || c.status === "dropped" || c.disposition === "success").length, calls.length),
    successRate: rate(successful.length, calls.filter((c) => !["queued", "ringing", "in_progress"].includes(c.status)).length),
  };
}

function rate(part, whole) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}
