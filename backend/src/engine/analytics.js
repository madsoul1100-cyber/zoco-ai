const CONNECTED = new Set(["in_progress", "completed", "dropped", "success", "qualified", "booked", "not_interested", "callback_requested"]);
const FAILED = new Set(["no_answer", "busy", "voicemail", "failed", "dropped"]);
const ANSWERED = new Set(["in_progress", "completed", "dropped", "success", "qualified", "booked", "not_interested", "callback_requested", "do_not_call"]);

function dayKey(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function callTime(call) {
  return call.startedAt || call.createdAt || call.updatedAt;
}

function durationSeconds(call) {
  if (Number(call.durationSeconds) > 0) return Number(call.durationSeconds);
  if (call.startedAt && call.endedAt) {
    return Math.max(0, Math.round((Date.parse(call.endedAt) - Date.parse(call.startedAt)) / 1000));
  }
  return 0;
}

function isConnected(call) {
  if (["no_answer", "busy", "failed", "voicemail"].includes(call.status)) return false;
  if (["no_answer", "busy", "failed", "voicemail"].includes(call.disposition)) return false;
  if (CONNECTED.has(call.status) || CONNECTED.has(call.disposition)) return true;
  return (call.messages || []).some((message) => message.role === "user" || message.role === "assistant");
}

function latencyMs(call) {
  const messages = call.messages || [];
  const user = messages.find((message) => message.role === "user" && message.timestamp);
  const bot = messages.find((message) => message.role === "assistant" && message.timestamp);
  if (user && bot) {
    const delta = Date.parse(bot.timestamp) - Date.parse(user.timestamp);
    if (delta >= 0 && delta < 120000) return delta;
  }
  if (call.startedAt) {
    const first = messages.find((message) => message.role === "assistant" && message.timestamp);
    if (first) {
      const delta = Date.parse(first.timestamp) - Date.parse(call.startedAt);
      if (delta >= 0 && delta < 120000) return delta;
    }
  }
  return null;
}

function turns(call) {
  const messages = call.messages || [];
  const users = messages.filter((message) => message.role === "user").length;
  const bots = messages.filter((message) => message.role === "assistant").length;
  return Math.max(users, bots);
}

function average(values) {
  const nums = values.filter((value) => Number.isFinite(value));
  if (!nums.length) return 0;
  return nums.reduce((sum, value) => sum + value, 0) / nums.length;
}

function outcomeBucket(call) {
  if (["busy"].includes(call.status) || call.disposition === "busy") return "Busy";
  if (["no_answer"].includes(call.status) || call.disposition === "no_answer") return "No answer";
  if (["voicemail"].includes(call.status) || call.disposition === "voicemail") return "Voicemail";
  if (["failed"].includes(call.status) || call.disposition === "failed") return "Failed";
  if (ANSWERED.has(call.status) || ANSWERED.has(call.disposition) || isConnected(call)) return "Answered";
  return "Other";
}

function failureReason(call) {
  if (!FAILED.has(call.disposition) && !FAILED.has(call.status)) return null;
  return call.outcomeReason || call.disposition || call.status;
}

function inRange(call, from, to) {
  const time = Date.parse(callTime(call) || 0);
  if (!time) return false;
  if (from && time < from) return false;
  if (to && time > to) return false;
  return true;
}

function emptyDays(from, to) {
  const days = [];
  let cursor = Date.parse(`${dayKey(new Date(from).toISOString())}T00:00:00+05:30`);
  const end = Date.parse(`${dayKey(new Date(to).toISOString())}T00:00:00+05:30`);
  while (cursor <= end) {
    days.push(dayKey(new Date(cursor).toISOString()));
    cursor += 86400000;
  }
  return days;
}

function summarize(calls) {
  const connected = calls.filter(isConnected);
  const latencies = connected.map(latencyMs).filter((value) => value != null);
  const durations = connected.map(durationSeconds).filter((value) => value > 0);
  const short = connected.filter((call) => durationSeconds(call) > 0 && durationSeconds(call) < 20);
  const unique = new Set(calls.map((call) => call.customer?.phone).filter(Boolean));
  const uniqueConnects = new Set(connected.map((call) => call.customer?.phone).filter(Boolean));
  return {
    attempted: calls.length,
    connected: connected.length,
    latencyMs: Math.round(average(latencies)),
    avgDuration: Math.round(average(durations)),
    totalMinutes: Math.round(durations.reduce((sum, value) => sum + value, 0) / 60),
    shortCalls: short.length,
    uniqueRecipients: unique.size,
    uniqueConnects: uniqueConnects.size,
    avgTurns: Number(average(connected.map(turns)).toFixed(1)),
    avgRetry: Number(average(calls.map((call) => Number(call.attempt || 1))).toFixed(1)),
    connectivity: calls.length ? Math.round((connected.length / calls.length) * 100) : 0,
  };
}

function seriesFor(calls, days, pick) {
  const buckets = Object.fromEntries(days.map((day) => [day, []]));
  for (const call of calls) {
    const day = dayKey(callTime(call));
    if (!buckets[day]) continue;
    buckets[day].push(call);
  }
  return days.map((date) => {
    const subset = buckets[date] || [];
    const stats = summarize(subset);
    return { date, value: pick(stats, subset) };
  });
}

function tableRow(id, name, calls) {
  const stats = summarize(calls);
  return {
    id,
    name,
    volume: stats.attempted,
    connected: stats.connected,
    connectivity: stats.connectivity,
    uniqueRecipients: stats.uniqueRecipients,
    uniqueConnects: stats.uniqueConnects,
    avgDuration: stats.avgDuration,
    avgTurns: stats.avgTurns,
    latencySec: Number((stats.latencyMs / 1000).toFixed(2)),
    avgRetry: stats.avgRetry,
  };
}

export function buildAnalytics({ calls, agents, campaigns, from, to, agentId, campaignId }) {
  const end = to || Date.now();
  const start = from || end - 6 * 86400000;
  const filtered = calls.filter((call) => {
    if (!inRange(call, start, end)) return false;
    if (agentId && call.agentId !== agentId) return false;
    if (campaignId === "none") return !call.campaignId;
    if (campaignId && call.campaignId !== campaignId) return false;
    return true;
  });

  const days = emptyDays(start, end);
  const kpis = summarize(filtered);
  const outcomes = {};
  for (const call of filtered) {
    const key = outcomeBucket(call);
    outcomes[key] = (outcomes[key] || 0) + 1;
  }
  const failures = {};
  for (const call of filtered) {
    const reason = failureReason(call);
    if (!reason) continue;
    failures[reason] = (failures[reason] || 0) + 1;
  }

  const byAgent = agents
    .map((agent) => tableRow(agent.id, agent.name, filtered.filter((call) => call.agentId === agent.id)))
    .filter((row) => row.volume)
    .sort((a, b) => b.volume - a.volume);

  const campaignRows = campaigns
    .map((campaign) => tableRow(campaign.id, campaign.name, filtered.filter((call) => call.campaignId === campaign.id)))
    .filter((row) => row.volume);
  const unassigned = filtered.filter((call) => !call.campaignId);
  if (unassigned.length) campaignRows.unshift(tableRow("none", "Studio / no campaign", unassigned));

  const logs = [...filtered]
    .sort((a, b) => String(callTime(b)).localeCompare(String(callTime(a))))
    .slice(0, 40)
    .map((call) => ({
      id: call.id,
      agentId: call.agentId,
      agentName: call.agentName,
      campaignName: call.campaignName || "",
      customer: call.customer,
      status: call.status,
      disposition: call.disposition,
      durationSeconds: durationSeconds(call),
      startedAt: call.startedAt || call.createdAt,
    }));

  return {
    range: { from: new Date(start).toISOString(), to: new Date(end).toISOString() },
    kpis,
    series: {
      attempted: seriesFor(filtered, days, (stats) => stats.attempted),
      connected: seriesFor(filtered, days, (stats) => stats.connected),
      latency: seriesFor(filtered, days, (stats) => stats.latencyMs),
      duration: seriesFor(filtered, days, (stats) => stats.avgDuration),
      minutes: seriesFor(filtered, days, (stats) => stats.totalMinutes),
      short: seriesFor(filtered, days, (stats) => stats.shortCalls),
    },
    outcomes,
    failures: Object.entries(failures)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([reason, count]) => ({ reason, count })),
    byAgent,
    byCampaign: campaignRows.sort((a, b) => b.volume - a.volume),
    agents: agents.map((agent) => ({ id: agent.id, name: agent.name })),
    campaigns: campaigns.map((campaign) => ({ id: campaign.id, name: campaign.name })),
    logs,
  };
}
