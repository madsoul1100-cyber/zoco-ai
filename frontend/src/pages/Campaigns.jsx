import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { AvatarMark, EmptyState, Modal, PageHeader, StatusBadge, relativeTime } from "../components/ui.jsx";

function parseCsv(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, phone, notes] = line.split(",").map((part) => part.trim());
      if (!phone && name) return { name: "Customer", phone: name, notes: "" };
      return { name: name || "Customer", phone, notes: notes || "" };
    })
    .filter((row) => row.phone);
}

export default function Campaigns() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [form, setForm] = useState({ name: "", agentId: "", csv: "" });
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  async function refresh() {
    const [agentList, list] = await Promise.all([api.agents(), api.campaigns()]);
    setAgents(agentList);
    setCampaigns(list);
    setForm((current) => ({ ...current, agentId: current.agentId || agentList[0]?.id || "" }));
    setReady(true);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function create(event) {
    event.preventDefault();
    setError("");
    const contacts = parseCsv(form.csv);
    if (!contacts.length) {
      setError("Paste a list: name,phone,notes — one customer per line.");
      return;
    }
    setBusy(true);
    try {
      const campaign = await api.createCampaign({
        name: form.name,
        agentId: form.agentId,
        contacts,
      });
      setOpen(false);
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const visible = campaigns.filter((campaign) =>
    `${campaign.name} ${campaign.agentName || ""}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <PageHeader
        title="Outbound campaigns"
        subtitle="Upload a list, pick an agent, then launch. Missed calls go to the recall queue automatically."
        actions={
          <button className="btn" type="button" onClick={() => setOpen(true)} disabled={!agents.length}>
            + Create campaign
          </button>
        }
      />
      {error && !open ? <p className="error">{error}</p> : null}

      {!ready ? (
        <p className="muted">Loading campaigns…</p>
      ) : campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          body={agents.length
            ? "Create a campaign, paste contacts, and launch. Each row becomes a live outbound call."
            : "Create an outbound agent first, then come back to launch a list."}
          action={
            agents.length ? (
              <button className="btn" type="button" onClick={() => setOpen(true)}>+ Create campaign</button>
            ) : (
              <button className="btn" type="button" onClick={() => navigate("/agents")}>Create an agent</button>
            )
          }
        />
      ) : (
        <section className="product-sheet">
          <div className="sheet-toolbar">
            <h3>Campaigns</h3>
            <input
              className="input search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
            />
          </div>
          <table className="recents-table">
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Agent</th>
                <th>Contacts</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((campaign) => (
                <tr key={campaign.id} className="clickable" onClick={() => navigate(`/campaigns/${campaign.id}`)}>
                  <td>
                    <div className="entity-cell">
                      <AvatarMark name={campaign.name} />
                      <strong>{campaign.name}</strong>
                    </div>
                  </td>
                  <td>{campaign.agentName}</td>
                  <td>{campaign.contacts?.length || 0}</td>
                  <td><StatusBadge status={campaign.status} /></td>
                  <td className="muted">{relativeTime(campaign.updatedAt || campaign.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <Modal
        open={open}
        title="Create campaign"
        onClose={() => setOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn" type="submit" form="create-campaign" disabled={busy}>
              {busy ? "Creating…" : "Create campaign"}
            </button>
          </>
        }
      >
        {error ? <p className="error">{error}</p> : null}
        <form id="create-campaign" className="grid" onSubmit={create}>
          <label>
            Campaign name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="August EMI reminders"
              required
            />
          </label>
          <label>
            Agent
            <select className="input" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label>
            Contact list (CSV)
            <textarea
              value={form.csv}
              onChange={(e) => setForm({ ...form, csv: e.target.value })}
              placeholder={"Riya Shah,+919876543210,EMI due 21 Aug\nArjun Mehta,8888111222,follow up"}
              required
            />
          </label>
        </form>
      </Modal>
    </>
  );
}
