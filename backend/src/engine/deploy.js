import { v4 as uuid } from "uuid";
import { campaignMetrics, durationSeconds, isConnected, outcomeBucket } from "./analytics.js";
import { normalizePhone } from "../phone.js";

export function defaultSchedule() {
  return {
    start: "00:00:00",
    end: "23:59:00",
    days: "Every day",
    timezone: "Asia/Kolkata",
  };
}

export function formatSchedule(schedule = defaultSchedule()) {
  const next = { ...defaultSchedule(), ...schedule };
  return `${next.start}-${next.end} - ${next.days} - ${next.timezone}`;
}

export function makeCode(name, id = uuid()) {
  const slug = String(name || "Item")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12) || "Item";
  return `${slug}-${String(id).replace(/[^a-z0-9]/gi, "").slice(-6) || uuid().slice(0, 6)}`;
}

export function hashCaller(phone) {
  const raw = String(phone || "unknown");
  let hash = 0;
  for (let i = 0; i < raw.length; i += 1) hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  return Math.abs(hash).toString(16).padStart(12, "0").slice(0, 12);
}

export function parseContactRows(rows = [], columnMap = {}) {
  const mapped = applyColumnMap(rows, columnMap);
  const valid = [];
  const invalid = [];
  for (const item of mapped) {
    const phone = normalizePhone(item?.phone || item);
    if (!phone) {
      invalid.push(item);
      continue;
    }
    const reserved = new Set(["id", "name", "phone", "notes", "cohortId", "vars"]);
    const vars = { ...(item.vars || {}) };
    for (const [key, value] of Object.entries(item)) {
      if (reserved.has(key) || value == null || value === "") continue;
      vars[key] = value;
    }
    valid.push({
      id: item.id || `row_${uuid().slice(0, 6)}`,
      name: item.name || vars.customer_name || "Customer",
      phone,
      notes: item.notes || "",
      cohortId: item.cohortId || "",
      vars,
    });
  }
  return { valid, invalid };
}

export function applyColumnMap(rows = [], columnMap = {}) {
  if (!columnMap || !Object.keys(columnMap).length) return rows;
  return rows.map((row) => {
    if (!row || typeof row !== "object") return row;
    const next = { ...row };
    for (const [target, source] of Object.entries(columnMap)) {
      if (!source) continue;
      const value = row[source] ?? row[target];
      if (value != null && value !== "") next[target] = value;
    }
    return next;
  });
}

export function ensureCampaignShape(campaign = {}) {
  const contacts = Array.isArray(campaign.contacts) ? campaign.contacts : [];
  let cohorts = Array.isArray(campaign.cohorts) ? campaign.cohorts : [];
  if (!cohorts.length && contacts.length) {
    cohorts = [{
      id: `coh_${uuid().slice(0, 8)}`,
      name: "cohort_sample_cohort",
      status: "completed",
      validRecords: contacts.length,
      invalidRecords: 0,
      uploadedAt: campaign.createdAt || new Date().toISOString(),
      contacts,
    }];
  }
  const flattened = cohorts.length
    ? cohorts.flatMap((cohort) => (cohort.contacts || []).map((row) => ({ ...row, cohortId: row.cohortId || cohort.id })))
    : contacts;
  return {
    ...campaign,
    schedule: { ...defaultSchedule(), ...(campaign.schedule || {}) },
    concurrency: Math.max(1, Number(campaign.concurrency || 1)),
    columnMap: campaign.columnMap && typeof campaign.columnMap === "object" ? campaign.columnMap : {},
    agentVersion: campaign.agentVersion || null,
    cohorts,
    contacts: flattened,
  };
}

export function ensureInboundShape(item = {}, tel = {}) {
  const id = item.id || `inb_${uuid().slice(0, 8)}`;
  const name = item.name || "Inbound";
  const live = item.status === "live" || item.enabled === true;
  return {
    id,
    name,
    status: live ? "live" : "paused",
    enabled: live,
    agentId: item.agentId || "",
    agentName: item.agentName || "",
    phoneNumber: item.phoneNumber || tel.fromNumber || "",
    greeting: item.greeting || "",
    record: item.record !== false,
    appId: item.appId || makeCode(name, `${id}app`),
    deploymentId: item.deploymentId || id,
    schedule: { ...defaultSchedule(), ...(item.schedule || {}) },
    connections: item.connections?.length
      ? item.connections
      : [{ phone: item.phoneNumber || tel.fromNumber || "" }].filter((row) => row.phone),
    agentVersion: item.agentVersion || null,
    createdAt: item.createdAt || new Date().toISOString(),
    pausedAt: live ? null : item.pausedAt || item.updatedAt || null,
    updatedAt: item.updatedAt || null,
  };
}

export function toLegacyInbound(item) {
  return {
    enabled: item.status === "live" || item.enabled === true,
    agentId: item.agentId || "",
    phoneNumber: item.phoneNumber || "",
    greeting: item.greeting || "",
    record: item.record !== false,
    updatedAt: item.updatedAt || null,
    inboundId: item.id,
  };
}

export function retryBreakdown(calls = []) {
  const groups = { connected: 0, no_answer: 0, busy: 0, failed: 0 };
  for (const call of calls) {
    const outcome = outcomeBucket(call);
    if (outcome === "Answered") groups.connected += 1;
    else if (outcome === "No answer") groups.no_answer += 1;
    else if (outcome === "Busy") groups.busy += 1;
    else groups.failed += 1;
  }
  return { ...groups, total: calls.length };
}

export function publicCampaign(campaign, calls = []) {
  const shaped = ensureCampaignShape(campaign);
  const metrics = campaignMetrics(shaped, calls);
  return {
    ...shaped,
    stats: {
      ...metrics,
      totalCalls: calls.length,
      successfulCalls: metrics.completed,
    },
    calls,
  };
}

export function publicInboundCall(call, numberDialed = "") {
  const total = durationSeconds(call);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return {
    id: call.id,
    caller: hashCaller(call.customer?.phone),
    phone: call.customer?.phone || "",
    numberDialed: numberDialed || call.toNumber || "",
    duration: `${minutes}m ${String(seconds).padStart(2, "0")}s`,
    durationSeconds: total,
    status: call.status,
    disposition: call.disposition,
    startedAt: call.startedAt || call.createdAt,
  };
}

export function isDndListed(phone, numbers = []) {
  const target = normalizePhone(phone);
  return numbers.some((item) => normalizePhone(item) === target);
}
