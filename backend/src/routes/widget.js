import { v4 as uuid } from "uuid";
import { generateReply } from "../engine/conversation.js";
import { renderGreeting } from "../engine/template.js";
import { applyOutcome } from "../engine/rules.js";
import { attachTurn } from "../services/calling.js";
import { getAgent, getCall, getCallAgent, getRules, knowledgeContextForAgent, saveCall } from "../store.js";

function embedPage(agent, origin) {
  const name = String(agent?.name || "Zoco").replace(/[<>]/g, "");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Talk to ${name}</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 0; background: #0b1220; color: #eef3ff; min-height: 100vh; display: grid; place-items: center; }
    .card { width: min(420px, 92vw); background: #141c2f; border-radius: 20px; padding: 24px; box-shadow: 0 20px 50px rgba(0,0,0,.35); }
    button { width: 100%; margin-top: 12px; border: 0; border-radius: 12px; padding: 12px 16px; font-weight: 700; cursor: pointer; background: #c8f031; }
    p { color: #9aa7c2; line-height: 1.45; }
    #log { white-space: pre-wrap; min-height: 80px; font-size: 14px; }
  </style>
</head>
<body>
  <div class="card">
    <h2>${name}</h2>
    <p>${String(agent?.useCase || "Voice agent").replace(/[<>]/g, "")}</p>
    <div id="log">Tap start, then speak after the greeting.</div>
    <button id="go" type="button">Start call</button>
  </div>
  <script src="${origin}/widget.js" data-agent="${agent.id}" data-origin="${origin}"></script>
</body>
</html>`;
}

async function knowledgeFn(agent, question) {
  return knowledgeContextForAgent(agent, question);
}

export function mountWidgetRoutes(app) {
  app.get("/embed/:agentId", async (req, res) => {
    const agent = await getAgent(req.params.agentId);
    if (!agent) return res.status(404).send("Agent not found");
    const origin = `${req.protocol}://${req.get("host")}`;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(embedPage(agent, origin));
  });

  app.get("/widget.js", (_req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.send(widgetScript());
  });

  app.post("/widget/:agentId/start", async (req, res) => {
    const agent = await getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    const now = new Date().toISOString();
    const name = String(req.body?.name || "Website visitor").slice(0, 80);
    const call = {
      id: `call_${uuid().slice(0, 10)}`,
      agentId: agent.id,
      agentName: agent.name,
      agentVersion: agent.version || 1,
      direction: "inbound",
      channel: "widget",
      customer: { name, phone: String(req.body?.phone || "") },
      status: "in_progress",
      disposition: "in_progress",
      attempt: 1,
      startedAt: now,
      gathered: {},
      language: agent.language || "en-IN",
      createdAt: now,
      messages: [],
    };
    const greeting = renderGreeting(agent, call.customer) || agent.greeting || "Hi, how can I help?";
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "assistant",
      text: greeting,
      timestamp: now,
      audioOffsetMs: null,
    }, "widget");
    res.json(await saveCall(call));
  });

  app.post("/widget/:agentId/message", async (req, res) => {
    const call = await getCall(req.body?.callId);
    if (!call) return res.status(404).json({ error: "Call not found" });
    const agent = await getCallAgent(call);
    const userText = String(req.body?.text || "").trim();
    if (!userText) return res.status(400).json({ error: "Message text is required" });
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "user",
      text: userText,
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
    }, "widget");
    const reply = await generateReply({
      agent,
      call,
      userText,
      knowledge: await knowledgeContextForAgent(agent, userText),
      knowledgeFn,
    });
    call.gathered = { ...(call.gathered || {}), ...(reply.slots || {}) };
    await attachTurn(call, {
      id: `msg_${uuid().slice(0, 8)}`,
      role: "assistant",
      text: reply.text,
      timestamp: new Date().toISOString(),
      audioOffsetMs: null,
      provider: reply.provider,
    }, "widget");
    let next = call;
    if (reply.endCall) {
      next = applyOutcome(
        call,
        { status: "completed", disposition: reply.disposition || agent.defaultSuccessDisposition, reason: "Widget closed" },
        await getRules()
      );
    }
    res.json({ call: await saveCall(next), reply: reply.text, endCall: reply.endCall });
  });
}

function widgetScript() {
  return `(() => {
  const script = document.currentScript;
  const agentId = script?.dataset.agent || new URLSearchParams(location.search).get("agent");
  const origin = (script?.dataset.origin || location.origin).replace(/\\/$/, "");
  const log = document.getElementById("log");
  const go = document.getElementById("go");
  let callId = "";
  let recorder = null;
  let stream = null;
  const say = (text) => { if (log) log.textContent = text; };

  async function playTts(text) {
    const clip = await fetch(origin + "/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, agentId }),
    }).then((r) => r.json());
    if (!clip?.audioUrl) return;
    await new Promise((resolve, reject) => {
      const audio = new Audio(clip.audioUrl.startsWith("http") ? clip.audioUrl : origin + clip.audioUrl);
      audio.onended = resolve;
      audio.onerror = reject;
      audio.play().catch(reject);
    });
  }

  async function transcribe(blob) {
    const data = new FormData();
    data.append("audio", blob, "speech.webm");
    const out = await fetch(origin + "/api/stt", { method: "POST", body: data }).then((r) => r.json());
    return String(out.transcript || "").trim();
  }

  async function listenOnce() {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    recorder.start();
    say("Listening…");
    await new Promise((resolve) => setTimeout(resolve, 4500));
    if (recorder.state === "recording") recorder.stop();
    const blob = await new Promise((resolve) => { recorder.onstop = () => resolve(new Blob(chunks, { type: "audio/webm" })); });
    stream.getTracks().forEach((t) => t.stop());
    return transcribe(blob);
  }

  async function turn() {
    const spoken = await listenOnce();
    if (!spoken) { say("I missed that. Tap start to try again."); return; }
    say("You: " + spoken);
    const data = await fetch(origin + "/widget/" + agentId + "/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ callId, text: spoken }),
    }).then((r) => r.json());
    callId = data.call?.id || callId;
    say(data.reply || "");
    if (data.reply) await playTts(data.reply);
    if (!data.endCall) turn().catch((err) => say(err.message));
  }

  async function start() {
    if (!agentId) return say("Missing agent id");
    go.disabled = true;
    const call = await fetch(origin + "/widget/" + agentId + "/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Website visitor" }),
    }).then((r) => r.json());
    callId = call.id;
    const greeting = (call.messages || []).filter((m) => m.role === "assistant").at(-1)?.text || "Hi";
    say(greeting);
    await playTts(greeting);
    await turn();
  }

  if (go) go.addEventListener("click", () => start().catch((err) => { say(err.message); go.disabled = false; }));

  window.ZocoWidget = {
    mount(target, opts = {}) {
      const id = opts.agentId || agentId;
      const root = typeof target === "string" ? document.querySelector(target) : target;
      if (!root) return;
      const btn = document.createElement("button");
      btn.textContent = opts.label || "Talk to us";
      btn.style.cssText = "position:fixed;right:20px;bottom:20px;z-index:9999;border:0;border-radius:999px;padding:12px 18px;background:#c8f031;font-weight:700;cursor:pointer";
      btn.onclick = () => window.open(origin + "/embed/" + id, "zoco", "width=420,height=640");
      root.appendChild(btn);
    }
  };
})();`;
}
