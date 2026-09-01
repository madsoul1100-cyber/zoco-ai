const DEFAULT_PRIVATE_BASE = "https://api.pipecat.daily.co/v1";
const DEFAULT_PUBLIC_BASE = "https://api.pipecat.daily.co/v1/public";

function isPlaceholder(value) {
  const raw = String(value || "").trim();
  return !raw || raw === "..." || /^<.*>$/.test(raw);
}

function envValue(...keys) {
  for (const key of keys) {
    const raw = String(process.env[key] || "").trim();
    if (!isPlaceholder(raw)) return raw;
  }
  return "";
}

function stripSlash(value) {
  return String(value || "").replace(/\/$/, "");
}

export class PipecatCloudError extends Error {
  constructor(message, { status = 400, code = "", body = null } = {}) {
    super(message);
    this.name = "PipecatCloudError";
    this.status = status;
    this.code = code;
    this.body = body;
  }
}

export function pipecatCloudConfig() {
  const privateBase = stripSlash(envValue("PIPECAT_CLOUD_BASE", "PIPECAT_CLOUD_API_URL")) || DEFAULT_PRIVATE_BASE;
  const publicBase = stripSlash(envValue("PIPECAT_CLOUD_PUBLIC_BASE")) || `${privateBase}/public`;
  let publicKey = envValue("PIPECAT_CLOUD_PUBLIC_KEY", "PIPECAT_PUBLIC_API_KEY");
  let privateKey = envValue("PIPECAT_CLOUD_PRIVATE_KEY", "PIPECAT_PRIVATE_API_KEY");
  const genericKey = envValue("PIPECAT_API_KEY");
  if (!publicKey && genericKey.startsWith("pk_")) publicKey = genericKey;
  if (!privateKey && genericKey && !genericKey.startsWith("pk_")) privateKey = genericKey;
  return {
    privateBase: privateBase || DEFAULT_PRIVATE_BASE,
    publicBase: publicBase || DEFAULT_PUBLIC_BASE,
    publicKey,
    privateKey,
    agentName: envValue("PIPECAT_CLOUD_AGENT_NAME", "PIPECAT_AGENT_NAME") || "zoco-voice",
  };
}

export function pipecatCloudConfigured() {
  return Boolean(pipecatCloudConfig().publicKey);
}

export function pipecatCloudPrivateReady() {
  return Boolean(pipecatCloudConfig().privateKey);
}

function queryString(query = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query || {})) {
    if (value == null || value === "") continue;
    params.set(key, String(value));
  }
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export async function cloudRequest({
  auth = "private",
  method = "GET",
  path,
  query,
  body,
  raw = false,
} = {}) {
  const cfg = pipecatCloudConfig();
  const key = auth === "public" ? cfg.publicKey : cfg.privateKey;
  const base = auth === "public" ? cfg.publicBase : cfg.privateBase;
  if (!key) {
    throw new PipecatCloudError(
      auth === "public"
        ? "Pipecat Cloud public API key is not configured. Set PIPECAT_CLOUD_PUBLIC_KEY."
        : "Pipecat Cloud private API key is not configured. Set PIPECAT_CLOUD_PRIVATE_KEY.",
      { status: 503, code: "NOT_CONFIGURED" }
    );
  }

  const url = `${base}${path.startsWith("/") ? path : `/${path}`}${queryString(query)}`;
  const headers = { Authorization: `Bearer ${key}` };
  const init = { method: String(method || "GET").toUpperCase(), headers };
  if (body !== undefined && init.method !== "GET" && init.method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    init.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const response = await fetch(url, init);
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }

  if (!response.ok) {
    const message = parsed && typeof parsed === "object"
      ? (parsed.error || parsed.message || parsed.detail || `Pipecat Cloud request failed (${response.status})`)
      : `Pipecat Cloud request failed (${response.status})`;
    throw new PipecatCloudError(message, {
      status: response.status,
      code: parsed && typeof parsed === "object" ? String(parsed.code || "") : "",
      body: parsed,
    });
  }

  if (raw) {
    return { status: response.status, body: parsed, text };
  }
  return parsed == null ? {} : parsed;
}

function agentPath(agentName) {
  const name = encodeURIComponent(String(agentName || pipecatCloudConfig().agentName).trim());
  if (!name || name === "undefined") {
    throw new PipecatCloudError("Agent name is required", { status: 400, code: "GENERIC_BAD_REQUEST" });
  }
  return name;
}

export function startSession(agentName, payload = {}) {
  return cloudRequest({
    auth: "public",
    method: "POST",
    path: `/${agentPath(agentName)}/start`,
    body: payload,
  });
}

export function startConfiguredSession(payload = {}) {
  return startSession(pipecatCloudConfig().agentName, payload);
}

export function sessionProxy(agentName, sessionId, method, restPath = "", { body, query } = {}) {
  const suffix = String(restPath || "").replace(/^\//, "");
  const path = `/${agentPath(agentName)}/sessions/${encodeURIComponent(sessionId)}${suffix ? `/${suffix}` : ""}`;
  return cloudRequest({
    auth: "public",
    method,
    path,
    query,
    body,
    raw: true,
  });
}

export function listAgents(query = {}) {
  return cloudRequest({ auth: "private", method: "GET", path: "/agents", query });
}

export function createAgent(payload = {}) {
  return cloudRequest({ auth: "private", method: "POST", path: "/agents", body: payload });
}

export function getAgent(agentName, query = {}) {
  return cloudRequest({ auth: "private", method: "GET", path: `/agents/${agentPath(agentName)}`, query });
}

export function updateAgent(agentName, payload = {}) {
  return cloudRequest({ auth: "private", method: "POST", path: `/agents/${agentPath(agentName)}`, body: payload });
}

export function deleteAgent(agentName) {
  return cloudRequest({ auth: "private", method: "DELETE", path: `/agents/${agentPath(agentName)}` });
}

export function getAgentLogs(agentName, query = {}) {
  return cloudRequest({ auth: "private", method: "GET", path: `/agents/${agentPath(agentName)}/logs`, query });
}

export function listSessions(agentName, query = {}) {
  return cloudRequest({ auth: "private", method: "GET", path: `/agents/${agentPath(agentName)}/sessions`, query });
}

export function getSession(agentName, sessionId, query = {}) {
  return cloudRequest({
    auth: "private",
    method: "GET",
    path: `/agents/${agentPath(agentName)}/sessions/${encodeURIComponent(sessionId)}`,
    query,
  });
}

export function stopSession(agentName, sessionId) {
  return cloudRequest({
    auth: "private",
    method: "DELETE",
    path: `/agents/${agentPath(agentName)}/sessions/${encodeURIComponent(sessionId)}`,
  });
}

export function listSecrets() {
  return cloudRequest({ auth: "private", method: "GET", path: "/secrets" });
}

export function getSecretSet(setName) {
  return cloudRequest({ auth: "private", method: "GET", path: `/secrets/${encodeURIComponent(setName)}` });
}

export function upsertSecretSet(setName, payload = {}) {
  return cloudRequest({
    auth: "private",
    method: "PUT",
    path: `/secrets/${encodeURIComponent(setName)}`,
    body: payload,
  });
}

export function deleteSecretSet(setName) {
  return cloudRequest({ auth: "private", method: "DELETE", path: `/secrets/${encodeURIComponent(setName)}` });
}

export function deleteSecret(setName, secretKey) {
  return cloudRequest({
    auth: "private",
    method: "DELETE",
    path: `/secrets/${encodeURIComponent(setName)}/${encodeURIComponent(secretKey)}`,
  });
}

export function getUploadUrl(payload = {}) {
  return cloudRequest({ auth: "private", method: "POST", path: "/builds/upload-url", body: payload });
}

export function createBuild(payload = {}) {
  return cloudRequest({ auth: "private", method: "POST", path: "/builds", body: payload });
}

export function listBuilds(query = {}) {
  return cloudRequest({ auth: "private", method: "GET", path: "/builds", query });
}

export function getBuild(buildId) {
  return cloudRequest({ auth: "private", method: "GET", path: `/builds/${encodeURIComponent(buildId)}` });
}

export function getBuildLogs(buildId) {
  return cloudRequest({ auth: "private", method: "GET", path: `/builds/${encodeURIComponent(buildId)}/logs` });
}

export function getProperties() {
  return cloudRequest({ auth: "private", method: "GET", path: "/properties" });
}

export function updateProperties(payload = {}) {
  return cloudRequest({ auth: "private", method: "PUT", path: "/properties", body: payload });
}

export function getPropertiesSchema() {
  return cloudRequest({ auth: "private", method: "GET", path: "/properties/schema" });
}

export function listRegions() {
  return cloudRequest({ auth: "private", method: "GET", path: "/regions" });
}

export function publicPipecatCloudStatus() {
  const cfg = pipecatCloudConfig();
  return {
    configured: pipecatCloudConfigured(),
    privateReady: pipecatCloudPrivateReady(),
    agentName: cfg.agentName,
    publicBase: cfg.publicBase,
    privateBase: cfg.privateBase,
    publicKey: Boolean(cfg.publicKey),
    privateKey: Boolean(cfg.privateKey),
  };
}
