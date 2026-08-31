import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";

export default function DeployCode() {
  const [agents, setAgents] = useState([]);
  const [telephony, setTelephony] = useState(null);
  const [agentId, setAgentId] = useState("");
  const [copied, setCopied] = useState("");

  useEffect(() => {
    Promise.all([api.agents(), api.telephony()]).then(([list, tel]) => {
      setAgents(list);
      setTelephony(tel);
      setAgentId(list[0]?.id || "");
    });
  }, []);

  const origin = window.location.origin;
  const widget = `<script src="${origin}/widget.js" data-agent="${agentId || "agt_xxx"}" data-origin="${origin}"></script>
<script>window.ZocoWidget.mount(document.body, { label: "Talk to us" });</script>`;
  const iframe = `<iframe src="${origin}/embed/${agentId || "agt_xxx"}" width="420" height="640" style="border:0;border-radius:16px" allow="microphone"></iframe>`;
  const snippet = `curl -X POST ${origin}/api/calls \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "${agentId || "agt_xxx"}",
    "channel": "voice",
    "mode": "phone",
    "customer": { "name": "Riya Shah", "phone": "+919876543210" }
  }'`;

  function copy(label, text) {
    navigator.clipboard?.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 1400);
  }

  return (
    <>
      <PageHeader
        title="Deploy with code"
        subtitle="Website widget, embed, or a backend call. The same agent, recordings, and transcripts stay in Zoco."
      />
      <div className="grid split">
        <section className="card grid">
          <label>
            Agent
            <select className="input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <p className="muted">Live line: {telephony?.exotelReady ? "ready" : "not connected"} · Exophone {telephony?.fromNumber || "—"}</p>
          <a className="btn ghost" href={`/embed/${agentId}`} target="_blank" rel="noreferrer">Open widget preview</a>
        </section>
        <section className="card grid">
          <h3>Website snippet</h3>
          <pre className="json">{widget}</pre>
          <button className="btn ghost" type="button" onClick={() => copy("widget", widget)}>{copied === "widget" ? "Copied" : "Copy snippet"}</button>
          <h3>Embed iframe</h3>
          <pre className="json">{iframe}</pre>
          <button className="btn ghost" type="button" onClick={() => copy("iframe", iframe)}>{copied === "iframe" ? "Copied" : "Copy iframe"}</button>
          <h3>Start a phone call</h3>
          <pre className="json">{snippet}</pre>
        </section>
      </div>
    </>
  );
}
