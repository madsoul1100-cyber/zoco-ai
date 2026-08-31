const API = "";

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    if (response.status === 401 && body.auth) {
      window.dispatchEvent(new Event("zoco-auth"));
    }
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json();
}

export const api = {
  dashboard: () => request("/api/dashboard"),
  agents: () => request("/api/agents"),
  agent: (id) => request(`/api/agents/${id}`),
  createAgent: (payload) => request("/api/agents", { method: "POST", body: JSON.stringify(payload) }),
  updateAgent: (id, payload) => request(`/api/agents/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  calls: (query = "") => request(`/api/calls${query}`),
  call: (id) => request(`/api/calls/${id}`),
  startCall: (payload) => request("/api/calls", { method: "POST", body: JSON.stringify(payload) }),
  connect: (id) => request(`/api/calls/${id}/connect`, { method: "POST", body: "{}" }),
  sendMessage: (id, text, source = "chat", languageHint = "") =>
    request(`/api/calls/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ text, source, languageHint: languageHint || undefined }),
    }),
  sendMessageStream: async (id, text, {
    onDelta,
    onUser,
    onLanguage,
    source = "chat",
    signal,
    languageHint = "",
  } = {}) => {
    const response = await fetch(`/api/calls/${id}/messages/stream`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source, languageHint: languageHint || undefined }),
      signal,
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Stream failed");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let call = null;
    try {
      while (true) {
        if (signal?.aborted) {
          try {
            await reader.cancel();
          } catch {
            /* ignore */
          }
          break;
        }
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";
        for (const chunk of chunks) {
          const line = chunk.split("\n").find((item) => item.startsWith("data: "));
          if (!line) continue;
          const event = JSON.parse(line.slice(6));
          if (event.type === "user") onUser?.(event.text);
          if (event.type === "delta") onDelta?.(event.text);
          if (event.type === "language") onLanguage?.(event.language, event.languageLocked);
          if (event.type === "done") call = event.call;
          if (event.type === "error") throw new Error(event.error);
        }
      }
    } catch (err) {
      if (err?.name === "AbortError" || signal?.aborted) return call;
      throw err;
    }
    return call;
  },
  outcome: (id, payload) =>
    request(`/api/calls/${id}/outcome`, { method: "POST", body: JSON.stringify(payload) }),
  recall: (id) => request(`/api/calls/${id}/recall`, { method: "POST", body: "{}" }),
  startOutbound: (id) => request(`/api/calls/${id}/start`, { method: "POST", body: "{}" }),
  queue: () => request("/api/queue"),
  contacts: () => request("/api/contacts"),
  createContact: (payload) => request("/api/contacts", { method: "POST", body: JSON.stringify(payload) }),
  deleteContact: (id) => request(`/api/contacts/${id}`, { method: "DELETE" }),
  telephony: () => request("/api/telephony"),
  saveTelephony: (payload) => request("/api/telephony", { method: "PUT", body: JSON.stringify(payload) }),
  rules: () => request("/api/rules"),
  saveRules: (payload) => request("/api/rules", { method: "PUT", body: JSON.stringify(payload) }),
  generateAgent: (prompt) => request("/api/agents/generate", { method: "POST", body: JSON.stringify({ prompt }) }),
  assistAgent: (id, payload) => request(`/api/agents/${id}/assist`, { method: "POST", body: JSON.stringify(payload) }),
  deleteAgent: (id) => request(`/api/agents/${id}`, { method: "DELETE" }),
  knowledge: () => request("/api/knowledge"),
  knowledgeBase: (id) => request(`/api/knowledge/${id}`),
  createKnowledge: (payload) => request("/api/knowledge", { method: "POST", body: JSON.stringify(payload) }),
  updateKnowledge: (id, payload) => request(`/api/knowledge/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteKnowledge: (id) => request(`/api/knowledge/${id}`, { method: "DELETE" }),
  addDocument: async (id, { name, text, file, files } = {}) => {
    const data = new FormData();
    if (name) data.append("name", name);
    if (text) data.append("text", text);
    const uploads = files?.length ? [...files] : file ? [file] : [];
    uploads.forEach((item) => data.append("file", item));
    const response = await fetch(`/api/knowledge/${id}/documents`, { method: "POST", body: data, credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Could not add document");
    }
    return response.json();
  },
  deleteDocument: (id, docId) => request(`/api/knowledge/${id}/documents/${docId}`, { method: "DELETE" }),
  queryKnowledge: (id, question) => request(`/api/knowledge/${id}/query`, { method: "POST", body: JSON.stringify({ question }) }),
  inbound: () => request("/api/inbound"),
  saveInbound: (payload) => request("/api/inbound", { method: "PUT", body: JSON.stringify(payload) }),
  inbounds: () => request("/api/inbounds"),
  inboundDetail: (id) => request(`/api/inbounds/${id}`),
  createInbound: (payload) => request("/api/inbounds", { method: "POST", body: JSON.stringify(payload) }),
  updateInbound: (id, payload) => request(`/api/inbounds/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  resumeInbound: (id) => request(`/api/inbounds/${id}/resume`, { method: "POST", body: "{}" }),
  pauseInbound: (id) => request(`/api/inbounds/${id}/pause`, { method: "POST", body: "{}" }),
  deleteInbound: (id) => request(`/api/inbounds/${id}`, { method: "DELETE" }),
  dnd: () => request("/api/dnd"),
  saveDnd: (payload) => request("/api/dnd", { method: "PUT", body: JSON.stringify(payload) }),
  campaigns: () => request("/api/campaigns"),
  campaignOverview: (hours = 24) => request(`/api/campaigns/overview?hours=${hours}`),
  campaign: (id, query = "") => request(`/api/campaigns/${id}${query}`),
  createCampaign: (payload) => request("/api/campaigns", { method: "POST", body: JSON.stringify(payload) }),
  updateCampaign: (id, payload) => request(`/api/campaigns/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  addCohort: (id, payload) => request(`/api/campaigns/${id}/cohorts`, { method: "POST", body: JSON.stringify(payload) }),
  campaignRetries: (id, cohortId = "") => request(`/api/campaigns/${id}/retries${cohortId ? `?cohortId=${encodeURIComponent(cohortId)}` : ""}`),
  launchCampaign: (id) => request(`/api/campaigns/${id}/launch`, { method: "POST", body: "{}" }),
  resumeCampaign: (id) => request(`/api/campaigns/${id}/resume`, { method: "POST", body: "{}" }),
  pauseCampaign: (id) => request(`/api/campaigns/${id}/pause`, { method: "POST", body: "{}" }),
  deleteCampaign: (id) => request(`/api/campaigns/${id}`, { method: "DELETE" }),
  analytics: (query = "") => request(`/api/analytics${query}`),
  usage: () => request("/api/usage"),
  providers: () => request("/api/providers"),
  aiSettings: () => request("/api/ai"),
  saveAi: (payload) => request("/api/ai", { method: "PUT", body: JSON.stringify(payload) }),
  translate: (payload) => request("/api/translate", { method: "POST", body: JSON.stringify(payload) }),
  speak: (payload) => request("/api/tts", { method: "POST", body: JSON.stringify(payload) }),
  transcribe: async (blob, language = "en-IN") => {
    const data = new FormData();
    data.append("audio", blob, "speech.webm");
    data.append("language", language);
    const response = await fetch("/api/stt", { method: "POST", body: data, credentials: "include" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Speech to text failed");
    return body;
  },
  agentVersions: (id) => request(`/api/agents/${id}/versions`),
  authMe: () => request("/api/auth/me"),
  login: (payload) => request("/api/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  register: (payload) => request("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  setupWorkspace: (payload) => request("/api/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  googleLogin: (payload) => request("/api/auth/google", { method: "POST", body: JSON.stringify(payload) }),
  sendPhoneOtp: (payload) => request("/api/auth/phone/send", { method: "POST", body: JSON.stringify(payload) }),
  verifyPhoneOtp: (payload) => request("/api/auth/phone/verify", { method: "POST", body: JSON.stringify(payload) }),
  skipLogin: () => request("/api/auth/skip", { method: "POST", body: "{}" }),
  logout: () => request("/api/auth/logout", { method: "POST", body: "{}" }),
  members: () => request("/api/members"),
  addMember: (payload) => request("/api/members", { method: "POST", body: JSON.stringify(payload) }),
  deleteMember: (id) => request(`/api/members/${id}`, { method: "DELETE" }),
  uploadRecording: async (id, blob) => {
    const data = new FormData();
    const ext = String(blob?.type || "").includes("mp4")
      ? "mp4"
      : String(blob?.type || "").includes("ogg")
        ? "ogg"
        : "webm";
    data.append("audio", blob, `${id}.${ext}`);
    const response = await fetch(`/api/calls/${id}/recording`, { method: "POST", body: data, credentials: "include" });
    if (!response.ok) throw new Error("Recording upload failed");
    return response.json();
  },
};
