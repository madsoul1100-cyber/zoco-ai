import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader, StatusBadge } from "../components/ui.jsx";

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

  async function refresh() {
    const [agentList, list] = await Promise.all([api.agents(), api.campaigns()]);
    setAgents(agentList);
    setCampaigns(list);
    setForm((current) => ({ ...current, agentId: current.agentId || agentList[0]?.id || "" }));
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
    const campaign = await api.createCampaign({
      name: form.name,
      agentId: form.agentId,
      contacts,
    });
    navigate(`/campaigns/${campaign.id}`);
  }

  return (
    <>
      <PageHeader
        title="Outbound campaigns"
        subtitle="Upload a list, pick an agent, then launch. Missed calls go to the recall queue automatically."
      />
      {error ? <p className="error">{error}</p> : null}

      <form className="card grid" onSubmit={create} style={{ marginBottom: 16 }}>
        <div className="grid split">
          <label>
            Campaign name
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="August EMI reminders" required />
          </label>
          <label>
            Agent
            <select className="input" value={form.agentId} onChange={(e) => setForm({ ...form, agentId: e.target.value })}>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Contact list (CSV)
          <textarea
            value={form.csv}
            onChange={(e) => setForm({ ...form, csv: e.target.value })}
            placeholder={"Riya Shah,+919876543210,EMI due 21 Aug\nArjun Mehta,8888111222,follow up"}
            required
          />
        </label>
        <button className="btn" type="submit">Create campaign</button>
      </form>

      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Campaign</th>
              <th>Agent</th>
              <th>Contacts</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((campaign) => (
              <tr key={campaign.id} className="clickable" onClick={() => navigate(`/campaigns/${campaign.id}`)}>
                <td><strong>{campaign.name}</strong></td>
                <td>{campaign.agentName}</td>
                <td>{campaign.contacts?.length || 0}</td>
                <td><StatusBadge status={campaign.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
        {campaigns.length === 0 ? <p className="muted">No campaigns yet.</p> : null}
      </section>
    </>
  );
}
