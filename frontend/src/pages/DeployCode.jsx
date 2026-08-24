import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";

export default function DeployCode() {
  const [agents, setAgents] = useState([]);
  const [telephony, setTelephony] = useState(null);
  const [agentId, setAgentId] = useState("");

  useEffect(() => {
    Promise.all([api.agents(), api.telephony()]).then(([list, tel]) => {
      setAgents(list);
      setTelephony(tel);
      setAgentId(list[0]?.id || "");
    });
  }, []);

  const origin = window.location.origin.replace("5173", "8787");
  const snippet = `curl -X POST ${origin}/api/calls \\
  -H "Content-Type: application/json" \\
  -d '{
    "agentId": "${agentId || "agt_xxx"}",
    "channel": "voice",
    "mode": "phone",
    "customer": { "name": "Riya Shah", "phone": "+919876543210" }
  }'`;

  return (
    <>
      <PageHeader
        title="Deploy with code"
        subtitle="Trigger the same agent from your CRM, website, or backend. The call JSON and recording stay in Zoco."
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
          <p className="muted">POST /api/calls starts an outbound dial when Twilio is connected. Without it, the studio still runs in the browser.</p>
          <p className="muted">Live line: {telephony?.twilioReady ? "ready" : "not connected"} · From {telephony?.fromNumber || "—"}</p>
        </section>
        <section className="card">
          <h3>Start a call</h3>
          <pre className="json">{snippet}</pre>
        </section>
      </div>
    </>
  );
}
