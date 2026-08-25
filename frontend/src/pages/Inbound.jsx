import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { EmptyState, MessageTimeline, PageHeader, StatusBadge, when } from "../components/ui.jsx";

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
    const saved = await api.saveInbound({ agentId: created.id, enabled: true });
    setInbound(saved);
    navigate(`/agents/${created.id}`);
  }

  async function saveLine(patch = {}) {
    setError("");
    setSaving(true);
    try {
      const next = { ...inbound, ...patch };
      const saved = await api.saveInbound({
        enabled: next.enabled,
        agentId: next.agentId,
      });
      setInbound(saved);
      setNotice(
        saved.live
          ? `Live. Dial ${saved.phoneNumber || saved.telephony?.fromNumber} — ${agent?.name || "the agent"} will answer.`
          : saved.enabled
            ? "Saved. Finish the phone number checks to go live."
            : "Answering is off."
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
    navigate(`/agents/${agent.id}?call=${call.id}&tab=tests`);
  }

  if (!inbound) return <p className="muted">Loading inbound…</p>;

  const line = inbound.line || {};
  const checks = [
    { ok: Boolean(inbound.telephony?.twilioReady), label: "Twilio is connected", to: "/phone-numbers" },
    { ok: Boolean(inbound.telephony?.publicBaseUrl), label: "Public URL is set", to: "/phone-numbers" },
    { ok: Boolean(line.publicReachable), label: "Twilio can reach this API" },
    { ok: Boolean(line.wired), label: "Voice webhook points at Zoco" },
    { ok: Boolean(inbound.agentId && agent), label: "An agent is assigned" },
    { ok: Boolean(inbound.enabled), label: "Answering is on" },
  ];
  const number = inbound.phoneNumber || inbound.telephony?.fromNumber || "";

  return (
    <>
      <PageHeader
        title="Inbound calls"
        subtitle="Assign an agent to your number. Edit greeting, voice, and instructions in studio — this page is the live line."
        actions={
          <>
            <span className={`badge ${inbound.live ? "done" : "recall"}`}>
              {inbound.live ? "Live — answering" : "Not answering"}
            </span>
            <Link className="btn ghost" to="/phone-numbers">Phone numbers</Link>
          </>
        }
      />
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className={inbound.live ? "success" : "muted"}>{notice}</p> : null}

      <div className="grid split">
        <section className="product-sheet inbound-hero">
          <div className="sheet-toolbar">
            <div>
              <p className="eyebrow">{inbound.live ? "Ready for a live call" : "Connect the line"}</p>
              <h3>{number || "No number yet"}</h3>
              <p className="muted">
                {inbound.live
                  ? `Dial this number. ${agent?.name || "The assigned agent"} will greet and talk.`
                  : "Pick an agent, turn answering on, and save. The Twilio webhook is pointed here automatically."}
              </p>
            </div>
            <label className="toggle-inline">
              <input
                type="checkbox"
                checked={Boolean(inbound.enabled)}
                onChange={(e) => setInbound({ ...inbound, enabled: e.target.checked })}
              />
              Answer live calls
            </label>
          </div>

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

          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn" type="button" disabled={saving || !inbound.agentId} onClick={() => saveLine()}>
              {saving ? "Saving…" : inbound.live ? "Save line" : "Go live"}
            </button>
            {agent ? (
              <button className="btn ghost" type="button" onClick={() => navigate(`/agents/${agent.id}`)}>
                Edit in studio
              </button>
            ) : null}
            <button className="btn ghost" type="button" onClick={testBrowser}>Test in browser</button>
          </div>

          <ul className="checks compact">
            {checks.map((item) => (
              <li key={item.label} className={item.ok ? "ok" : "no"}>
                <span>{item.ok ? "●" : "○"}</span>
                {item.to && !item.ok ? <Link to={item.to}>{item.label}</Link> : item.label}
              </li>
            ))}
          </ul>
        </section>

        <div className="grid" style={{ alignContent: "start", gap: 16 }}>
          {liveCall && ["queued", "ringing", "in_progress"].includes(liveCall.status) ? (
            <section className="product-sheet">
              <div className="sheet-toolbar">
                <h3>Live inbound · {liveCall.customer?.phone}</h3>
                <StatusBadge status={liveCall.status} disposition={liveCall.disposition} />
              </div>
              <MessageTimeline messages={liveCall.messages || []} />
            </section>
          ) : (
            <EmptyState
              title="Waiting for a call"
              body={`After you go live, dial ${number || "the Twilio number"}. The transcript appears here.`}
            />
          )}

          <section className="product-sheet">
            <div className="sheet-toolbar">
              <h3>Recent inbound</h3>
              <Link className="link-quiet" to="/calls">View all</Link>
            </div>
            {calls.length === 0 ? (
              <p className="muted sheet-empty">No inbound calls yet.</p>
            ) : (
              <table className="recents-table">
                <thead>
                  <tr>
                    <th>Caller</th>
                    <th>Status</th>
                    <th>When</th>
                  </tr>
                </thead>
                <tbody>
                  {calls.map((call) => (
                    <tr key={call.id} className="clickable" onClick={() => navigate(`/calls/${call.id}`)}>
                      <td>{call.customer?.phone || "Unknown"}</td>
                      <td><StatusBadge status={call.status} disposition={call.disposition} /></td>
                      <td className="muted">{when(call.startedAt || call.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
