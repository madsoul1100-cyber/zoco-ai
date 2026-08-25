import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { EmptyState, Modal, PageHeader, StatusBadge, when } from "../components/ui.jsx";

export default function Inbound() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [form, setForm] = useState({ name: "", agentId: "", phoneNumber: "" });
  const [menu, setMenu] = useState("");

  async function refresh() {
    const [agentList, list, tel] = await Promise.all([api.agents(), api.inbounds(), api.telephony()]);
    setAgents(agentList);
    setItems(list);
    setForm((current) => ({
      ...current,
      agentId: current.agentId || agentList.find((agent) => agent.direction === "inbound")?.id || agentList[0]?.id || "",
      phoneNumber: current.phoneNumber || tel.fromNumber || "",
    }));
    setReady(true);
  }

  useEffect(() => {
    refresh().catch((err) => {
      setError(err.message);
      setReady(true);
    });
  }, []);

  async function create(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const created = await api.createInbound(form);
      setOpen(false);
      navigate(`/inbound/${created.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const visible = items.filter((item) =>
    `${item.name} ${item.appId} ${item.phoneNumber}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <PageHeader
        title="Inbound calls"
        actions={
          <button className="btn" type="button" onClick={() => setOpen(true)} disabled={!agents.length}>
            + Create inbound
          </button>
        }
      />
      {error && !open ? <p className="error">{error}</p> : null}

      {!ready ? (
        <p className="muted">Loading inbound…</p>
      ) : items.length === 0 ? (
        <EmptyState
          title="No inbound deployments"
          body="Create an inbound, assign an agent and number, then resume to start answering."
          action={<button className="btn" type="button" onClick={() => setOpen(true)}>+ Create inbound</button>}
        />
      ) : (
        <section className="product-sheet">
          <div className="sheet-toolbar">
            <input className="input search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search inbounds" />
          </div>
          <table className="recents-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Status</th>
                <th>App ID</th>
                <th>Phone numbers</th>
                <th>Created At</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {visible.map((item) => (
                <tr key={item.id} className="clickable" onClick={() => navigate(`/inbound/${item.id}`)}>
                  <td><strong>{item.name}</strong></td>
                  <td><StatusBadge status={item.status} /></td>
                  <td className="muted">{item.appId}</td>
                  <td>{item.phoneNumber || "—"}</td>
                  <td className="muted">{when(item.createdAt)}</td>
                  <td className="menu-wrap">
                    <button
                      className="icon-btn"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setMenu(menu === item.id ? "" : item.id);
                      }}
                    >
                      …
                    </button>
                    {menu === item.id ? (
                      <div className="menu-card">
                        <button type="button" onClick={(event) => { event.stopPropagation(); navigate(`/inbound/${item.id}`); }}>Open</button>
                        <button
                          type="button"
                          onClick={async (event) => {
                            event.stopPropagation();
                            await api.deleteInbound(item.id);
                            setMenu("");
                            await refresh();
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Modal
        open={open}
        title="Create inbound"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn" type="submit" form="create-inbound" disabled={busy}>Create inbound</button>
          </>
        }
      >
        {error ? <p className="error">{error}</p> : null}
        <form id="create-inbound" className="grid" onSubmit={create}>
          <label>Name<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="MLC Graduate Help - S1 Inbound Demo" required /></label>
          <label>
            Agent
            <select className="input" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label>Phone number<input className="input" value={form.phoneNumber} onChange={(e) => setForm({ ...form, phoneNumber: e.target.value })} placeholder="+91…" /></label>
        </form>
      </Modal>
    </>
  );
}
