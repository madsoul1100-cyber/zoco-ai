import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { col, fromDoc, toDoc } from "./infra/mongo.js";

const scrypt = promisify(scryptCb);
const COOKIE = "zoco_session";
const SECRET = () => process.env.SESSION_SECRET || process.env.OPENROUTER_API_KEY || "zoco-dev-secret";

function publicUser(user) {
  if (!user) return null;
  return { id: user.id, email: user.email, name: user.name || "", role: user.role || "member" };
}

export async function listUsers() {
  return (await col("users").find({}).sort({ createdAt: 1 }).toArray()).map(fromDoc);
}

export async function getUserByEmail(email) {
  return fromDoc(await col("users").findOne({ email: String(email || "").trim().toLowerCase() }));
}

export async function getUser(id) {
  return fromDoc(await col("users").findOne({ _id: id }));
}

async function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const hash = (await scrypt(String(password), salt, 32)).toString("hex");
  return `${salt}:${hash}`;
}

async function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const next = (await scrypt(String(password), salt, 32)).toString("hex");
  try {
    return timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(next, "hex"));
  } catch {
    return false;
  }
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function readToken(token) {
  const [body, sig] = String(token || "").split(".");
  if (!body || !sig) return null;
  const expect = createHmac("sha256", SECRET()).update(body).digest("base64url");
  try {
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  } catch {
    return null;
  }
  const data = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (data.exp && data.exp < Date.now()) return null;
  return data;
}

function cookieFrom(req) {
  const header = req.headers.cookie || "";
  const match = header.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${COOKIE}=`));
  return match ? decodeURIComponent(match.slice(COOKIE.length + 1)) : "";
}

export function setSession(res, user) {
  const token = sign({ id: user.id, exp: Date.now() + 14 * 86400000 });
  const secure = String(process.env.PUBLIC_BASE_URL || "").startsWith("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}${secure}`);
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

export async function currentUser(req) {
  const data = readToken(cookieFrom(req));
  if (!data?.id) return null;
  return publicUser(await getUser(data.id));
}

export async function createUser({ email, password, name, role }) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized || !password) throw new Error("Email and password are required");
  if (await getUserByEmail(normalized)) throw new Error("That email is already on this workspace");
  const now = new Date().toISOString();
  const users = await listUsers();
  const user = {
    id: `usr_${randomBytes(4).toString("hex")}`,
    email: normalized,
    name: name || normalized.split("@")[0],
    role: role || (users.length ? "member" : "owner"),
    passwordHash: await hashPassword(password),
    createdAt: now,
    updatedAt: now,
  };
  await col("users").replaceOne({ _id: user.id }, toDoc(user), { upsert: true });
  return user;
}

export async function authenticate(email, password) {
  const user = await getUserByEmail(email);
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error("Email or password is wrong");
  }
  return user;
}

export async function deleteUser(id) {
  await col("users").deleteOne({ _id: id });
}

const OPEN = [
  /^\/api\/auth\//,
  /^\/webhooks\//,
  /^\/widget/,
  /^\/embed/,
  /^\/api\/stt$/,
  /^\/api\/tts/,
  /^\/api\/health/,
  /^\/api\/calls\/[^/]+\/messages/,
];

export function authRequired(req) {
  return OPEN.some((re) => re.test(req.path)) === false;
}

export async function authMiddleware(req, res, next) {
  if (req.path.startsWith("/webhooks") || req.path.startsWith("/widget") || req.path.startsWith("/embed")) {
    return next();
  }
  if (req.path.startsWith("/api/auth")) return next();
  const users = await listUsers();
  req.authOpen = users.length === 0;
  req.user = await currentUser(req);
  if (!req.path.startsWith("/api")) return next();
  if (users.length === 0) return next();
  if (!authRequired(req)) return next();
  if (!req.user) return res.status(401).json({ error: "Please sign in", auth: true });
  next();
}

export { publicUser };
