import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { Modal, StatusBadge, aboutTime, when } from "../components/ui.jsx";

export default function InboundDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [item, setItem] = useState(null);
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [form, setForm] = useState({ name: "", agentId: "", phoneNumber: "", start: "", end: "", days: "", timezone: "" });

  async function refresh() {
    const [detail, agentList] = await Promise.all([api.inboundDetail(id), api.agents()]);
    setItem(detail);
    setAgents(agentList);
    setForm({
      name: detail.name || "",
      agentId: detail.agentId || "",
      phoneNumber: detail.phoneNumber || "",
      start: detail.schedule?.start || "00:00:00",
      end: detail.schedule?.end || "23:59:00",
      days: detail.schedule?.days || "Every day",
      timezone: detail.schedule?.timezone || "Asia/Kolkata",
    });
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [id]);

  async function act(fn) {
    setBusy(true);
    setError("");
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(event) {
    event.preventDefault();
    await act(async () => {
      await api.updateInbound(id, {
        name: form.name,
        agentId: form.agentId,
        phoneNumber: form.phoneNumber,
        schedule: { start: form.start, end: form.end, days: form.days, timezone: form.timezone },
      });
      setEditOpen(false);
    });
  }

  function copy(value) {
    navigator.clipboard?.writeText(value);
  }

  if (error && !item) return <p className="error">{error}</p>;
  if (!item) return <p className="muted">Loading inbound…</p>;

  const live = item.status === "live";
  const connections = item.connections?.length || (item.phoneNumber ? 1 : 0);

  return (
    <>
      <div className="kb-crumb-bar">
        <div className="kb-crumb">
          <Link to="/inbound">Inbound Calls</Link>
          <span>/</span>
          <strong>{item.name}</strong>
          <StatusBadge status={item.status} />
        </div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => setEditOpen(true)}>Edit</button>
          {live ? (
            <button className="btn ghost" type="button" disabled={busy} onClick={() => act(() => api.pauseInbound(id))}>
              {busy ? "Pausing…" : "Pause"}
            </button>
          ) : (
            <button className="btn" type="button" disabled={busy} onClick={() => act(() => api.resumeInbound(id))}>
              {busy ? "Resuming…" : "Resume"}
            </button>
          )}
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>
        {live ? `Live ${aboutTime(item.updatedAt)}` : `Paused ${aboutTime(item.pausedAt || item.updatedAt)}`}
      </p>
      {error ? <p className="error">{error}</p> : null}

      <section className="product-sheet" style={{ marginTop: 16 }}>
        <h3>Identity</h3>
        <div className="id-grid">
          <div>
            <span className="stat-label">Deployment ID</span>
            <button className="copy-id" type="button" onClick={() => copy(item.deploymentId)}>{item.deploymentId}</button>
          </div>
          <div>
            <span className="stat-label">App ID</span>
            <button className="copy-id" type="button" onClick={() => copy(item.appId)}>{item.appId}</button>
          </div>
        </div>
      </section>

      <section className="product-sheet" style={{ marginTop: 16 }}>
        <h3>Configuration</h3>
        <div className="config-grid">
          <div>
            <span className="stat-label">Agent</span>
            <Link to={`/agents/${item.agentId}`}>{item.agentName || "Unassigned"}</Link>
          </div>
          <div>
            <span className="stat-label">Connection</span>
            <p>{connections} connection - {connections} number</p>
            <p className="muted">{item.phoneNumber || "No number"}</p>
          </div>
          <div>
            <span className="stat-label">Schedule</span>
            <p>{item.scheduleLabel}</p>
          </div>
        </div>
      </section>

      <details className="product-sheet" style={{ marginTop: 16 }}>
        <summary className="sheet-toolbar" style={{ cursor: "pointer" }}>
          <h3>Known callers</h3>
        </summary>
        <p className="muted sheet-empty">Known callers appear after repeat inbound numbers are recognized.</p>
      </details>

      <section className="product-sheet" style={{ marginTop: 16 }}>
        <h3>Recent Calls</h3>
        <table className="recents-table">
          <thead>
            <tr>
              <th>Caller</th>
              <th>Number dialed</th>
              <th>Duration</th>
              <th>Started</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(item.recentCalls || []).map((call) => (
              <tr key={call.id}>
                <td className="muted">{call.caller}…</td>
                <td>{call.numberDialed}</td>
                <td>{call.duration}</td>
                <td className="muted">{when(call.startedAt)}</td>
                <td><button className="link-quiet" type="button" onClick={() => navigate(`/calls/${call.id}`)}>View</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {(item.recentCalls || []).length === 0 ? <p className="muted sheet-empty">No inbound calls yet.</p> : null}
      </section>

      <Modal
        open={editOpen}
        title="Edit inbound"
        onClose={() => setEditOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setEditOpen(false)}>Cancel</button>
            <button className="btn" type="submit" form="edit-inbound" disabled={busy}>Save</button>
          </>
        }
      >
        <form id="edit-inbound" className="grid" onSubmit={saveEdit}>
          <label>Name<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>
            Agent
            <select className="input" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label>Phone<input className="input" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} /></label>
          <label>Start<input className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
          <label>End<input className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
          <label>Days<input className="input" value={form.days} onChange={(e) => setForm({ ...form, days: e.target.value })} /></label>
          <label>Timezone<input className="input" value={form.timezone} onChange={(e) => setForm({ ...form, timezone: e.target.value })} /></label>
        </form>
      </Modal>
    </>
  );
}
