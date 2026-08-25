import { MongoClient } from "mongodb";

let client;
let db;
export const mongoState = { ready: false, error: null };

async function ensureUserIndexes(database) {
  try {
    await database.collection("users").dropIndex("email_1");
  } catch {
    /* sparse rebuild */
  }
  await Promise.all([
    database.collection("users").createIndex({ email: 1 }, { unique: true, sparse: true }),
    database.collection("users").createIndex({ phone: 1 }, { unique: true, sparse: true }),
    database.collection("users").createIndex({ googleId: 1 }, { unique: true, sparse: true }),
  ]);
}

export async function connectMongo() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/zoco";
  client = new MongoClient(uri, { ignoreUndefined: true });
  await client.connect();
  db = client.db(process.env.MONGODB_DB || "zoco");
  await Promise.all([
    db.collection("agents").createIndex({ updatedAt: -1 }),
    db.collection("calls").createIndex({ updatedAt: -1 }),
    db.collection("calls").createIndex({ status: 1, startedAt: -1 }),
    db.collection("calls").createIndex({ "recall.needed": 1, "recall.scheduledAt": 1 }),
    db.collection("contacts").createIndex({ name: 1 }),
    db.collection("knowledgeBases").createIndex({ updatedAt: -1 }),
    db.collection("campaigns").createIndex({ updatedAt: -1 }),
    db.collection("campaigns").createIndex({ status: 1 }),
    db.collection("inbounds").createIndex({ updatedAt: -1 }),
    db.collection("inbounds").createIndex({ status: 1 }),
    db.collection("calls").createIndex({ twilioSid: 1 }),
    db.collection("turns").createIndex({ callId: 1, timestamp: 1 }),
    db.collection("turns").createIndex({ createdAt: -1 }),
    ensureUserIndexes(db),
    db.collection("agentVersions").createIndex({ agentId: 1, version: -1 }),
    db.collection("calls").createIndex({ campaignId: 1, status: 1 }),
    db.collection("phoneOtps").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
  mongoState.ready = true;
  mongoState.error = null;
  return db;
}

export function getDb() {
  if (!db) throw new Error("MongoDB is not connected. Run docker compose up -d");
  return db;
}

export function col(name) {
  return getDb().collection(name);
}

export async function pingMongo() {
  if (!db) return false;
  await db.command({ ping: 1 });
  return true;
}

export function fromDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { id: _id, ...rest };
}

export function toDoc(item) {
  const { id, ...rest } = item;
  return { _id: id, ...rest };
}
