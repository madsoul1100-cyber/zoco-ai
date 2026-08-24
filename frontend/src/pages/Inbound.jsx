import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { AgentEditor } from "../components/AgentEditor.jsx";
import { MessageTimeline, PageHeader, StatusBadge, when } from "../components/ui.jsx";

export default function Inbound() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [inbound, setInbound] = useState(null);
  const [agent, setAgent] = useState(null);
  const [calls, setCalls] = useState([]);
  const [liveCall, setLiveCall] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadLine() {
    const [agentList, config] = await Promise.all([api.agents(), api.inbound()]);
    setAgents([...new Map(agentList.map((item) => [item.id, item])).values()]);
    setInbound(config);
    return config;
  }

  async function loadCalls() {
    const inboundCalls = await api.calls("?direction=inbound");
    setCalls(inboundCalls.slice(0, 8));
    const active = inboundCalls.find((call) => ["queued", "ringing", "in_progress"].includes(call.status));
    setLiveCall(active || null);
  }

  useEffect(() => {
    (async () => {
      try {
        const config = await loadLine();
        if (config.agentId) setAgent(await api.agent(config.agentId));
        await loadCalls();
      } catch (err) {
        setError(err.message);
      }
    })();
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      loadCalls().catch(() => {});
      api.inbound().then((config) => {
        setInbound((current) => ({
          ...current,
          ...config,
          enabled: current?.enabled ?? config.enabled,
          agentId: current?.agentId ?? config.agentId,
        }));
      }).catch(() => {});
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!liveCall?.id) return;
    const timer = setInterval(async () => {
      const next = await api.call(liveCall.id);
      setLiveCall(next);
      if (!["queued", "ringing", "in_progress"].includes(next.status)) clearInterval(timer);
    }, 1500);
    return () => clearInterval(timer);
  }, [liveCall?.id]);

  async function selectAgent(agentId) {
    setError("");
    setInbound((current) => ({ ...current, agentId }));
    if (!agentId) {
      setAgent(null);
      return;
    }
    setAgent(await api.agent(agentId));
  }

  async function createInboundAgent() {
    setError("");
    const created = await api.createAgent({
      name: "Inbound agent",
      direction: "inbound",
      useCase: "Answer live inbound calls and complete the customer's request.",
      persona: "Warm, concise, professional. Answer the phone as a live receptionist.",
      greeting: "Thank you for calling. How can I help you today?",
      successCriteria: "Resolve the request or capture a callback number.",
    });
    setAgents((current) => [created, ...current.filter((item) => item.id !== created.id)]);
    setAgent(created);
    setInbound((current) => ({ ...current, agentId: created.id, enabled: true }));
    setNotice("New inbound agent created. Edit it below, then save.");
  }

  async function saveAll(payload) {
    setError("");
    setSaving(true);
    try {
      const savedAgent = await api.updateAgent(payload.id, payload);
      setAgent(savedAgent);
      setAgents((current) => current.map((item) => (item.id === savedAgent.id ? savedAgent : item)));
      const saved = await api.saveInbound({
        ...inbound,
        enabled: inbound.enabled,
        agentId: savedAgent.id,
        greeting: "",
      });
      setInbound(saved);
      setNotice(
        saved.live
          ? `Live. Dial ${saved.phoneNumber || saved.telephony?.fromNumber} — ${savedAgent.name} will answer.`
          : saved.enabled
            ? "Agent saved, but the live line is not fully wired yet."
            : "Agent saved. Turn on answering to take live calls."
      );
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function testBrowser() {
    if (!agent?.id) {
      setError("Choose or create an inbound agent first.");
      return;
    }
    const call = await api.startCall({
      agentId: agent.id,
      channel: "voice",
      direction: "inbound",
      customer: { name: "Test caller", phone: inbound.telephony?.workspacePhone || "+910000000000" },
    });
    navigate(`/agents/${agent.id}?call=${call.id}`);
  }

  if (!inbound) return <p className="muted">Loading inbound…</p>;

  const line = inbound.line || {};
  const checks = [
    { ok: Boolean(inbound.telephony?.twilioReady), label: "Twilio is connected" },
    { ok: Boolean(inbound.telephony?.publicBaseUrl), label: "Public URL (ngrok) is set" },
    { ok: Boolean(line.publicReachable), label: "Twilio can reach this API over the public URL" },
    { ok: Boolean(line.wired), label: "This number’s voice webhook points at Zoco" },
    { ok: Boolean(inbound.agentId && agent), label: "An agent is assigned" },
    { ok: Boolean(inbound.enabled), label: "Answer live inbound calls is on" },
  ];
  const number = inbound.phoneNumber || inbound.telephony?.fromNumber || "";

  return (
    <>
      <PageHeader
        title="Inbound calls"
        subtitle="Pick the agent that answers this number, then edit it the same way as in studio. Greeting, voice, language, and brain all apply to live inbound calls."
        actions={
          <>
            <span className={`badge ${inbound.live ? "done" : "recall"}`}>
              {inbound.live ? "Live — answering" : "Inbound answering is off"}
            </span>
            <Link className="btn ghost" to="/phone-numbers">Phone numbers</Link>
          </>
        }
      />
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className={inbound.live ? "success" : "muted"}>{notice}</p> : null}

      <section className="card" style={{ marginBottom: 16 }}>
        <h3>{inbound.live ? "Ready for a live inbound call" : "Not answering yet"}</h3>
        <p className="muted">
          {inbound.live
            ? `Dial ${number} from another phone. ${agent?.name || "The assigned agent"} will greet and talk.`
            : "Edit the agent, turn answering on, and save. That also points the Twilio number at this webhook."}
        </p>
        <ul className="checks">
          {checks.map((item) => (
            <li key={item.label} className={item.ok ? "ok" : "no"}>
              <span>{item.ok ? "●" : "○"}</span>
              {item.label}
            </li>
          ))}
        </ul>
        {line.error ? <p className="error">{line.error}</p> : null}
        <p className="muted" style={{ marginTop: 12 }}>
          Number: {number || "Connect a provider number first"}.
          Webhook: <code>{line.expectedUrl || `${inbound.telephony?.publicBaseUrl || "https://your-public-url"}/webhooks/twilio/inbound`}</code>
        </p>
      </section>

      <div className="grid split studio">
        {agent ? (
          <AgentEditor
            agent={agent}
            onChange={setAgent}
            onSubmit={saveAll}
            onError={setError}
            busy={saving}
            submitLabel="Save inbound agent"
            extra={
              <>
                <label className="row" style={{ justifyContent: "space-between" }}>
                  <span>Answer live inbound calls</span>
                  <input
                    type="checkbox"
                    checked={Boolean(inbound.enabled)}
                    onChange={(e) => setInbound({ ...inbound, enabled: e.target.checked })}
                  />
                </label>
                <label>
                  Agent on this number
                  <div className="row">
                    <select
                      className="input"
                      style={{ flex: 1 }}
                      value={inbound.agentId || ""}
                      onChange={(e) => selectAgent(e.target.value).catch((err) => setError(err.message))}
                    >
                      <option value="">Select an agent</option>
                      {agents.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.direction}
                        </option>
                      ))}
                    </select>
                    <button className="btn ghost" type="button" onClick={createInboundAgent}>New inbound agent</button>
                  </div>
                </label>
              </>
            }
            actions={
              <>
                {!inbound.enabled ? (
                  <button
                    className="btn ghost"
                    type="button"
                    disabled={saving}
                    onClick={() => setInbound({ ...inbound, enabled: true })}
                  >
                    Turn answering on
                  </button>
                ) : null}
                <button className="btn ghost" type="button" onClick={testBrowser}>Test in browser</button>
              </>
            }
          />
        ) : (
          <section className="card grid">
            <h3>Agent on this number</h3>
            <p className="muted">Select an existing agent or create an inbound agent, then edit greeting, voice, language, and brain here — same as studio.</p>
            <label>
              Agent
              <select className="input" value={inbound.agentId || ""} onChange={(e) => selectAgent(e.target.value)}>
                <option value="">Select an agent</option>
                {agents.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.direction}
                  </option>
                ))}
              </select>
            </label>
            <div className="row">
              <button className="btn" type="button" onClick={createInboundAgent}>New inbound agent</button>
            </div>
          </section>
        )}

        <div className="grid" style={{ alignContent: "start", gap: 16 }}>
          {liveCall && ["queued", "ringing", "in_progress"].includes(liveCall.status) ? (
            <section className="card">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>Live inbound · {liveCall.customer?.phone}</h3>
                <StatusBadge status={liveCall.status} disposition={liveCall.disposition} />
              </div>
              <MessageTimeline messages={liveCall.messages || []} />
            </section>
          ) : (
            <section className="card">
              <h3>Live inbound</h3>
              <p className="muted">
                After you save, dial {number || "the Twilio number"}. The transcript appears here the same way outbound studio shows a live call.
              </p>
            </section>
          )}

          <section className="card">
            <h3>Recent inbound calls</h3>
            {calls.length === 0 ? (
              <p className="muted">No inbound calls yet.</p>
            ) : (
              <ul className="plain-list">
                {calls.map((call) => (
                  <li key={call.id} className="row" style={{ justifyContent: "space-between" }}>
                    <span>
                      {call.customer?.phone || "Unknown"} · {when(call.startedAt || call.createdAt)}
                    </span>
                    <StatusBadge status={call.status} disposition={call.disposition} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
