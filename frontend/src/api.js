const API = "";

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
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
  sendMessage: (id, text, source = "chat") =>
    request(`/api/calls/${id}/messages`, { method: "POST", body: JSON.stringify({ text, source }) }),
  sendMessageStream: async (id, text, { onDelta, onUser, source = "chat" } = {}) => {
    const response = await fetch(`/api/calls/${id}/messages/stream`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, source }),
    });
    if (!response.ok || !response.body) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.error || "Stream failed");
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let call = null;
    while (true) {
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
        if (event.type === "done") call = event.call;
        if (event.type === "error") throw new Error(event.error);
      }
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
    const response = await fetch(`/api/knowledge/${id}/documents`, { method: "POST", body: data });
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
  campaigns: () => request("/api/campaigns"),
  campaign: (id) => request(`/api/campaigns/${id}`),
  createCampaign: (payload) => request("/api/campaigns", { method: "POST", body: JSON.stringify(payload) }),
  updateCampaign: (id, payload) => request(`/api/campaigns/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  launchCampaign: (id) => request(`/api/campaigns/${id}/launch`, { method: "POST", body: "{}" }),
  pauseCampaign: (id) => request(`/api/campaigns/${id}/pause`, { method: "POST", body: "{}" }),
  analytics: (query = "") => request(`/api/analytics${query}`),
  usage: () => request("/api/usage"),
  providers: () => request("/api/providers"),
  aiSettings: () => request("/api/ai"),
  saveAi: (payload) => request("/api/ai", { method: "PUT", body: JSON.stringify(payload) }),
  translate: (payload) => request("/api/translate", { method: "POST", body: JSON.stringify(payload) }),
  speak: (payload) => request("/api/tts", { method: "POST", body: JSON.stringify(payload) }),
  uploadRecording: async (id, blob) => {
    const data = new FormData();
    data.append("audio", blob, `${id}.webm`);
    const response = await fetch(`/api/calls/${id}/recording`, { method: "POST", body: data });
    if (!response.ok) throw new Error("Recording upload failed");
    return response.json();
  },
};
