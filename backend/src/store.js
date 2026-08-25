import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { cacheDel, cacheGet, cacheSet } from "./infra/cache.js";
import { col, fromDoc, mongoState, toDoc } from "./infra/mongo.js";
import { retrieveFromKnowledge } from "./engine/knowledge.js";
import { defaultTelephony } from "./phone.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const DATA_DIR = path.join(root, "data");

export function defaultRules() {
  return {
    maxAttempts: 3,
    recallOn: ["no_answer", "busy", "dropped", "voicemail", "callback_requested"],
    successDispositions: ["success", "qualified", "booked", "not_interested", "do_not_call"],
    delaysMinutes: {
      no_answer: 60,
      busy: 15,
      dropped: 5,
      voicemail: 1440,
      callback_requested: 120,
      failed: 30,
    },
    businessHours: {
      timezone: "Asia/Kolkata",
      start: "09:00",
      end: "19:00",
    },
  };
}

export async function ensureStore() {
  await mkdir(path.join(DATA_DIR, "recordings"), { recursive: true });
  await mkdir(path.join(DATA_DIR, "tts"), { recursive: true });
  if (mongoState.ready) {
    await migrateFilesIfNeeded();
  }
}

async function readJsonFile(filePath, fallback = null) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

async function migrateDir(dir, collection) {
  const folder = path.join(DATA_DIR, dir);
  let files = [];
  try {
    files = (await readdir(folder)).filter((file) => file.endsWith(".json"));
  } catch {
    return 0;
  }
  let count = 0;
  for (const file of files) {
    const item = await readJsonFile(path.join(folder, file));
    if (!item?.id) continue;
    await col(collection).updateOne({ _id: item.id }, { $setOnInsert: toDoc(item) }, { upsert: true });
    count += 1;
  }
  return count;
}

async function migrateFilesIfNeeded() {
  const agents = await col("agents").countDocuments();
  if (agents > 0) return;
  const imported = await migrateDir("agents", "agents");
  await migrateDir("calls", "calls");
  await migrateDir("contacts", "contacts");
  const rules = await readJsonFile(path.join(DATA_DIR, "rules.json"));
  if (rules) await col("settings").updateOne({ _id: "rules" }, { $set: rules }, { upsert: true });
  const telephony = await readJsonFile(path.join(DATA_DIR, "telephony.json"));
  if (telephony) await col("settings").updateOne({ _id: "telephony" }, { $set: telephony }, { upsert: true });
  if (imported) console.log(`Migrated ${imported} agents from data/ into MongoDB`);
}

export async function listAgents() {
  const cached = await cacheGet("agents");
  if (cached) return cached;
  const agents = (await col("agents").find({}).sort({ updatedAt: -1 }).toArray()).map(fromDoc);
  await cacheSet("agents", agents, 20);
  return agents;
}

export async function getAgent(id) {
  const cached = await cacheGet(`agent:${id}`);
  if (cached) return cached;
  const agent = fromDoc(await col("agents").findOne({ _id: id }));
  if (agent) await cacheSet(`agent:${id}`, agent, 60);
  return agent;
}

export async function saveAgent(agent) {
  agent.updatedAt = new Date().toISOString();
  await col("agents").replaceOne({ _id: agent.id }, toDoc(agent), { upsert: true });
  await cacheDel("agents", `agent:${agent.id}`);
  return agent;
}

export async function deleteAgent(id) {
  await col("agents").deleteOne({ _id: id });
  await cacheDel("agents", `agent:${id}`);
}

export async function listCalls() {
  return (await col("calls").find({}).sort({ updatedAt: -1 }).limit(500).toArray()).map(fromDoc);
}

export async function getCall(id) {
  const cached = await cacheGet(`call:${id}`);
  if (cached) return cached;
  const call = fromDoc(await col("calls").findOne({ _id: id }));
  if (call) await cacheSet(`call:${id}`, call, 8);
  return call;
}

export async function getCallByTwilioSid(sid) {
  if (!sid) return null;
  return fromDoc(await col("calls").findOne({ twilioSid: sid }));
}

export async function saveCall(call) {
  call.updatedAt = new Date().toISOString();
  await col("calls").replaceOne({ _id: call.id }, toDoc(call), { upsert: true });
  await cacheDel(`call:${call.id}`);
  return call;
}

export async function getRules() {
  const cached = await cacheGet("rules");
  if (cached) return cached;
  const fallback = defaultRules();
  const stored = (await col("settings").findOne({ _id: "rules" })) || {};
  const { _id, ...rest } = stored;
  const rules = {
    ...fallback,
    ...rest,
    delaysMinutes: { ...fallback.delaysMinutes, ...(rest.delaysMinutes || {}) },
  };
  await cacheSet("rules", rules, 60);
  return rules;
}

export async function saveRules(rules) {
  const next = { ...defaultRules(), ...rules };
  await col("settings").replaceOne({ _id: "rules" }, { _id: "rules", ...next }, { upsert: true });
  await cacheDel("rules");
  return next;
}

export async function listContacts() {
  return (await col("contacts").find({}).sort({ name: 1 }).toArray()).map(fromDoc);
}

export async function getContact(id) {
  return fromDoc(await col("contacts").findOne({ _id: id }));
}

export async function saveContact(contact) {
  contact.updatedAt = new Date().toISOString();
  await col("contacts").replaceOne({ _id: contact.id }, toDoc(contact), { upsert: true });
  return contact;
}

export async function deleteContact(id) {
  await col("contacts").deleteOne({ _id: id });
}

export async function getTelephony() {
  const cached = await cacheGet("telephony");
  if (cached) return cached;
  const stored = (await col("settings").findOne({ _id: "telephony" })) || {};
  const { _id, ...rest } = stored;
  const telephony = { ...defaultTelephony(), ...rest };
  await cacheSet("telephony", telephony, 20);
  return telephony;
}

export async function saveTelephony(config) {
  const next = { ...defaultTelephony(), ...config, updatedAt: new Date().toISOString() };
  await col("settings").replaceOne({ _id: "telephony" }, { _id: "telephony", ...next }, { upsert: true });
  await cacheDel("telephony");
  return next;
}

export async function getAiSettings() {
  const cached = await cacheGet("ai");
  if (cached) return cached;
  const { defaultAiSettings } = await import("./engine/providers.js");
  const fallback = defaultAiSettings();
  const stored = (await col("settings").findOne({ _id: "ai" })) || {};
  const { _id, ...rest } = stored;
  const next = {
    ...fallback,
    ...rest,
    keys: { ...fallback.keys, ...(rest.keys || {}) },
  };
  await cacheSet("ai", next, 30);
  return next;
}

export async function saveAiSettings(update = {}) {
  const current = await getAiSettings();
  const keys = { ...current.keys };
  for (const name of Object.keys(keys)) {
    const value = update.keys?.[name];
    if (!value) continue;
    if (String(value).includes("•")) continue;
    keys[name] = String(value).trim();
  }
  const next = {
    ...current,
    defaultLlmProvider: update.defaultLlmProvider || current.defaultLlmProvider,
    defaultTtsProvider: update.defaultTtsProvider || current.defaultTtsProvider,
    keys,
    updatedAt: new Date().toISOString(),
  };
  await col("settings").replaceOne({ _id: "ai" }, { _id: "ai", ...next }, { upsert: true });
  await cacheDel("ai");
  return next;
}

export function recordingPath(callId, ext = "webm") {
  return path.join(DATA_DIR, "recordings", `${callId}.${ext}`);
}

export async function listKnowledgeBases() {
  return (await col("knowledgeBases").find({}).sort({ updatedAt: -1 }).toArray()).map(fromDoc);
}

export async function getKnowledgeBase(id) {
  return fromDoc(await col("knowledgeBases").findOne({ _id: id }));
}

export async function saveKnowledgeBase(kb) {
  kb.updatedAt = new Date().toISOString();
  await col("knowledgeBases").replaceOne({ _id: kb.id }, toDoc(kb), { upsert: true });
  return kb;
}

export async function deleteKnowledgeBase(id) {
  await col("knowledgeBases").deleteOne({ _id: id });
}

export async function knowledgeContextForAgent(agent, question = "") {
  const ids = agent?.knowledgeBaseIds || [];
  if (!ids.length) return "";
  const bases = (await Promise.all(ids.map((id) => getKnowledgeBase(id)))).filter(Boolean);
  if (!bases.length) return "";
  const retrieved = question
    ? bases.flatMap((kb) =>
        retrieveFromKnowledge(kb, question, 4).map((hit) => `${kb.name} / ${hit.name}:\n${hit.excerpt}`)
      )
    : [];
  if (retrieved.length) return retrieved.join("\n\n").slice(0, 4000);
  return bases
    .map((kb) => {
      const body = (kb.documents || [])
        .map((doc) => `${doc.name || "note"}:\n${doc.text || ""}`)
        .join("\n\n");
      return `${kb.name}\n${kb.description || ""}\n${body}`.trim();
    })
    .join("\n\n")
    .slice(0, 6000);
}

export function defaultInbound() {
  return {
    enabled: false,
    agentId: "",
    phoneNumber: "",
    greeting: "",
    record: true,
    updatedAt: null,
  };
}

export async function getInbound() {
  const stored = (await col("settings").findOne({ _id: "inbound" })) || {};
  const { _id, ...rest } = stored;
  return { ...defaultInbound(), ...rest };
}

export async function saveInbound(config) {
  const next = { ...defaultInbound(), ...config, updatedAt: new Date().toISOString() };
  await col("settings").replaceOne({ _id: "inbound" }, { _id: "inbound", ...next }, { upsert: true });
  return next;
}

export async function listCampaigns() {
  return (await col("campaigns").find({}).sort({ updatedAt: -1 }).toArray()).map(fromDoc);
}

export async function getCampaign(id) {
  return fromDoc(await col("campaigns").findOne({ _id: id }));
}

export async function saveCampaign(campaign) {
  campaign.updatedAt = new Date().toISOString();
  await col("campaigns").replaceOne({ _id: campaign.id }, toDoc(campaign), { upsert: true });
  return campaign;
}

export async function deleteCampaign(id) {
  await col("campaigns").deleteOne({ _id: id });
}

export async function listCallsByCampaign(campaignId) {
  return (await col("calls").find({ campaignId }).sort({ updatedAt: -1 }).limit(500).toArray()).map(fromDoc);
}
