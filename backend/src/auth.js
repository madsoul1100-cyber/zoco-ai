import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { col, fromDoc, toDoc } from "./infra/mongo.js";
import { normalizePhone } from "./phone.js";
import { checkVerifySms, resolveTelephony, sendSms, sendVerifySms } from "./telephony/index.js";

const scrypt = promisify(scryptCb);
const COOKIE = "zoco_session";
const SECRET = () => process.env.SESSION_SECRET || process.env.OPENROUTER_API_KEY || "zoco-dev-secret";

const GUEST_ID = "guest";

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email || "",
    phone: user.phone || "",
    name: user.name || "",
    role: user.role || "member",
    picture: user.picture || "",
    guest: Boolean(user.guest),
    providers: {
      password: Boolean(user.passwordHash),
      google: Boolean(user.googleId),
      phone: Boolean(user.phone),
    },
  };
}

export function skipLoginAllowed() {
  return String(process.env.REQUIRE_LOGIN || "").trim().toLowerCase() !== "true";
}

export function guestUser() {
  return {
    id: GUEST_ID,
    name: "Guest",
    email: "",
    phone: "",
    role: "owner",
    guest: true,
  };
}

export async function listUsers() {
  return (await col("users").find({}).sort({ createdAt: 1 }).toArray()).map(fromDoc);
}

export async function getUserByEmail(email) {
  const normalized = String(email || "").trim().toLowerCase();
  if (!normalized) return null;
  return fromDoc(await col("users").findOne({ email: normalized }));
}

export async function getUserByPhone(phone) {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;
  return fromDoc(await col("users").findOne({ phone: normalized }));
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

function writeSessionCookie(res, token) {
  const secure = String(process.env.PUBLIC_BASE_URL || "").startsWith("https") ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${14 * 86400}${secure}`);
}

export function setSession(res, user) {
  writeSessionCookie(res, sign({ id: user.id, exp: Date.now() + 14 * 86400000 }));
}

export function setGuestSession(res) {
  writeSessionCookie(res, sign({ id: GUEST_ID, guest: true, exp: Date.now() + 14 * 86400000 }));
}

export function clearSession(res) {
  res.setHeader("Set-Cookie", `${COOKIE}=; Path=/; HttpOnly; Max-Age=0`);
}

export async function currentUser(req) {
  const data = readToken(cookieFrom(req));
  if (!data) return null;
  if (data.guest) return skipLoginAllowed() ? publicUser(guestUser()) : null;
  if (!data.id) return null;
  return publicUser(await getUser(data.id));
}

function compactUser(user) {
  const next = { ...user };
  if (!next.email) delete next.email;
  if (!next.phone) delete next.phone;
  if (!next.googleId) delete next.googleId;
  if (!next.passwordHash) delete next.passwordHash;
  if (!next.picture) delete next.picture;
  return next;
}

export async function upsertIdentity({ email, phone, googleId, name, picture, password } = {}) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  let user = null;
  if (googleId) user = fromDoc(await col("users").findOne({ googleId }));
  if (!user && normalizedEmail) user = await getUserByEmail(normalizedEmail);
  if (!user && normalizedPhone) user = await getUserByPhone(normalizedPhone);

  if (user) {
    const patch = { updatedAt: new Date().toISOString() };
    if (googleId && !user.googleId) patch.googleId = googleId;
    if (normalizedEmail && !user.email) patch.email = normalizedEmail;
    if (normalizedPhone && !user.phone) patch.phone = normalizedPhone;
    if (name && !user.name) patch.name = name;
    if (picture && !user.picture) patch.picture = picture;
    if (Object.keys(patch).length > 1) {
      await col("users").updateOne({ _id: user.id }, { $set: patch });
    }
    return { ...user, ...patch };
  }

  const users = await listUsers();
  const now = new Date().toISOString();
  const created = compactUser({
    id: `usr_${randomBytes(4).toString("hex")}`,
    email: normalizedEmail,
    phone: normalizedPhone,
    googleId: googleId || "",
    name: name || (normalizedEmail ? normalizedEmail.split("@")[0] : normalizedPhone || "Member"),
    picture: picture || "",
    role: users.length ? "member" : "owner",
    passwordHash: password ? await hashPassword(password) : "",
    createdAt: now,
    updatedAt: now,
  });
  await col("users").replaceOne({ _id: created.id }, toDoc(created), { upsert: true });
  return created;
}

export async function createUser({ email, password, name, role, phone }) {
  const normalized = String(email || "").trim().toLowerCase();
  const normalizedPhone = phone ? normalizePhone(phone) : "";
  if (!normalized && !normalizedPhone) throw new Error("Email or phone number is required");
  if (normalized && !password) throw new Error("Email and password are required");
  if (normalized && String(password).length < 6) throw new Error("Password must be at least 6 characters");
  if (normalized && (await getUserByEmail(normalized))) throw new Error("That email already has an account. Sign in instead.");
  if (normalizedPhone && (await getUserByPhone(normalizedPhone))) throw new Error("That phone number already has an account. Sign in instead.");
  const now = new Date().toISOString();
  const users = await listUsers();
  const user = compactUser({
    id: `usr_${randomBytes(4).toString("hex")}`,
    email: normalized,
    phone: normalizedPhone,
    name: name || (normalized ? normalized.split("@")[0] : normalizedPhone),
    role: role || (users.length ? "member" : "owner"),
    passwordHash: password ? await hashPassword(password) : "",
    createdAt: now,
    updatedAt: now,
  });
  await col("users").replaceOne({ _id: user.id }, toDoc(user), { upsert: true });
  return user;
}

export async function authenticate(email, password) {
  const user = await getUserByEmail(email);
  if (!user?.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    throw new Error("Email or password is wrong");
  }
  return user;
}

export async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google sign-in is not configured. Add GOOGLE_CLIENT_ID.");
  const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.aud !== clientId) throw new Error("Google sign-in could not be verified");
  if (data.email_verified !== "true" && data.email_verified !== true) {
    throw new Error("That Google account email is not verified");
  }
  return {
    googleId: data.sub,
    email: data.email,
    name: data.name || data.email?.split("@")[0] || "Google user",
    picture: data.picture || "",
  };
}

export function googleAuthUrl(req) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error("Google sign-in is not configured. Add GOOGLE_CLIENT_ID.");
  const redirectUri = googleRedirectUri(req);
  const state = sign({ t: "google", exp: Date.now() + 10 * 60 * 1000 });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "online",
    prompt: "select_account",
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export function googleRedirectUri(req) {
  const configured = String(process.env.PUBLIC_APP_URL || "").replace(/\/$/, "");
  const origin = configured || `${req.protocol}://${req.get("host")}`;
  return `${origin}/api/auth/google/callback`;
}

export async function exchangeGoogleCode(req, code) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const secret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !secret) throw new Error("Google sign-in needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: secret,
      redirect_uri: googleRedirectUri(req),
      grant_type: "authorization_code",
    }),
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.id_token) {
    throw new Error(tokens.error_description || "Google sign-in failed");
  }
  return verifyGoogleIdToken(tokens.id_token);
}

export function readOAuthState(state) {
  return readToken(state);
}

export async function sendPhoneOtp(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("Enter a valid phone number");
  const tel = await resolveTelephony();
  const existing = await col("phoneOtps").findOne({ _id: phone });
  if (existing?.sentAt && Date.now() - Date.parse(existing.sentAt) < 45000) {
    throw new Error("Wait a moment before requesting another code");
  }
  if (process.env.TWILIO_VERIFY_SERVICE_SID && tel.accountSid) {
    await sendVerifySms(tel, phone);
    await col("phoneOtps").replaceOne(
      { _id: phone },
      { _id: phone, phone, provider: "twilio-verify", sentAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 10 * 60 * 1000) },
      { upsert: true }
    );
    return { sent: true, phone };
  }
  if (!tel.exotelReady && !tel.twilioReady) {
    throw new Error("Phone login needs SMS. Exotel voice is configured separately; use Google sign-in for now.");
  }
  const code = String(Math.floor(100000 + Math.random() * 900000));
  await col("phoneOtps").replaceOne(
    { _id: phone },
    {
      _id: phone,
      phone,
      hash: await hashPassword(code),
      attempts: 0,
      sentAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    },
    { upsert: true }
  );
  await sendSms({
    tel,
    to: phone,
    body: `Your Zoco sign-in code is ${code}. It expires in 10 minutes.`,
  });
  return { sent: true, phone };
}

export async function verifyPhoneOtp(rawPhone, code) {
  const phone = normalizePhone(rawPhone);
  const otp = String(code || "").trim();
  if (!phone || !otp) throw new Error("Enter the code we sent");
  const row = await col("phoneOtps").findOne({ _id: phone });
  if (!row) throw new Error("Send a code first");
  const tel = await resolveTelephony();
  let ok = false;
  if (row.provider === "twilio-verify") {
    ok = await checkVerifySms(tel, phone, otp);
  } else {
    if (row.expiresAt && new Date(row.expiresAt).getTime() < Date.now()) {
      throw new Error("That code expired. Send a new one.");
    }
    if ((row.attempts || 0) >= 5) throw new Error("Too many tries. Send a new code.");
    ok = await verifyPassword(otp, row.hash);
    if (!ok) {
      await col("phoneOtps").updateOne({ _id: phone }, { $inc: { attempts: 1 } });
    }
  }
  if (!ok) throw new Error("That code is wrong");
  await col("phoneOtps").deleteOne({ _id: phone });
  return upsertIdentity({ phone, name: phone });
}

export async function authMethods() {
  const tel = await resolveTelephony();
  const googleClientId = String(process.env.GOOGLE_CLIENT_ID || "").trim();
  const googleSecret = String(process.env.GOOGLE_CLIENT_SECRET || "").trim();
  return {
    email: true,
    google: Boolean(googleClientId && googleSecret),
    googleClientId: googleClientId && googleSecret ? googleClientId : "",
    phone: Boolean(tel.exotelReady || tel.twilioReady || process.env.TWILIO_VERIFY_SERVICE_SID),
    skip: skipLoginAllowed(),
  };
}

export async function deleteUser(id) {
  await col("users").deleteOne({ _id: id });
}

const OPEN = [
  /^\/api\/auth\//,
  /^\/api\/livekit\/status$/,
  /^\/api\/livekit\/sessions\//,
  /^\/api\/pipecat\/status$/,
  /^\/api\/pipecat\/sessions\//,
  /^\/webhooks\//,
  /^\/widget/,
  /^\/embed/,
  /^\/api\/stt$/,
  /^\/api\/tts/,
  /^\/api\/ambient\//,
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
