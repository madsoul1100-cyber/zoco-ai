import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { StackedBars } from "../components/BarChart.jsx";
import { AvatarMark, EmptyState, Modal, PageHeader, StatusBadge, aboutTime } from "../components/ui.jsx";
import { parseCsv } from "../lib/csv.js";

const PAST = new Set(["completed", "ended", "archived"]);

export default function Campaigns() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState({ name: "", agentId: "", csv: "" });
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [tab, setTab] = useState("active");
  const [metric, setMetric] = useState("calls");
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  async function refresh(nextHours = hours) {
    const [agentList, data] = await Promise.all([api.agents(), api.campaignOverview(nextHours)]);
    setAgents(agentList);
    setOverview(data);
    setForm((current) => ({ ...current, agentId: current.agentId || agentList[0]?.id || "" }));
    setReady(true);
  }

  useEffect(() => {
    refresh().catch((err) => {
      setError(err.message);
      setReady(true);
    });
  }, []);

  useEffect(() => {
    if (!ready) return;
    api.campaignOverview(hours).then(setOverview).catch((err) => setError(err.message));
  }, [hours, ready]);

  async function create(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const campaign = await api.createCampaign({
        name: form.name,
        agentId: form.agentId,
        contacts: parseCsv(form.csv),
      });
      setOpen(false);
      navigate(`/campaigns/${campaign.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const campaigns = overview?.campaigns || [];
  const active = campaigns.filter((campaign) => !PAST.has(campaign.status));
  const past = campaigns.filter((campaign) => PAST.has(campaign.status));
  const pool = tab === "past" ? past : active;
  const visible = pool.filter((campaign) => {
    const text = `${campaign.name} ${campaign.agentName || ""}`.toLowerCase();
    if (query && !text.includes(query.toLowerCase())) return false;
    if (status !== "all" && campaign.status !== status) return false;
    return true;
  });
  const points = metric === "concurrency" ? overview?.concurrency || [] : overview?.activity || [];

  const statuses = useMemo(
    () => [...new Set(pool.map((campaign) => campaign.status).filter(Boolean))],
    [pool]
  );

  return (
    <>
      <PageHeader
        title="Outbound campaigns"
        actions={
          <>
            <Link className="link-quiet" to="/campaigns/dnd">DND list</Link>
            <button className="btn" type="button" onClick={() => setOpen(true)} disabled={!agents.length}>
              + Create campaign
            </button>
          </>
        }
      />
      {error && !open ? <p className="error">{error}</p> : null}

      {!ready ? (
        <p className="muted">Loading campaigns…</p>
      ) : (
        <>
          <section className="product-sheet deploy-card">
            <div className="sheet-toolbar">
              <div className="pill-tabs">
                <button type="button" className={metric === "calls" ? "on" : ""} onClick={() => setMetric("calls")}>Calls</button>
                <button type="button" className={metric === "concurrency" ? "on" : ""} onClick={() => setMetric("concurrency")}>Concurrency</button>
              </div>
              <div className="unit-toggle">
                <button type="button" className={hours === 12 ? "on" : ""} onClick={() => setHours(12)}>12h</button>
                <button type="button" className={hours === 24 ? "on" : ""} onClick={() => setHours(24)}>24h</button>
              </div>
            </div>
            <div className="deploy-metric">
              <strong>{metric === "calls" ? overview?.total || 0 : Math.max(0, ...points.map((point) => point.live || 0))}</strong>
              <span className="muted">{metric === "calls" ? "Number of calls" : "Live concurrency"}</span>
            </div>
            <StackedBars points={points} keys={metric === "calls" ? ["total"] : ["live"]} />
          </section>

          <section className="product-sheet" style={{ marginTop: 16 }}>
            <div className="dash-tabs" style={{ marginBottom: 8 }}>
              <button type="button" className={tab === "active" ? "on" : ""} onClick={() => setTab("active")}>Active campaigns</button>
              <button type="button" className={tab === "past" ? "on" : ""} onClick={() => setTab("past")}>Past campaigns</button>
            </div>
            <div className="filter-bar">
              <input className="input search-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search active campaigns" />
              <select className="input filter-input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="all">All statuses</option>
                {statuses.map((item) => (
                  <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
                ))}
              </select>
              <span className="chip on">All time</span>
            </div>
            {campaigns.length === 0 ? (
              <EmptyState
                title="No campaigns yet"
                body={agents.length ? "Create a campaign, add a cohort, then launch." : "Create an outbound agent first."}
                action={
                  agents.length
                    ? <button className="btn" type="button" onClick={() => setOpen(true)}>+ Create campaign</button>
                    : <button className="btn" type="button" onClick={() => navigate("/agents")}>Create an agent</button>
                }
              />
            ) : (
              <table className="recents-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Agent type</th>
                    <th>Status</th>
                    <th>When</th>
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
                      <td>
                        <div className="entity-cell">
                          <AvatarMark name={campaign.agentName} />
                          {campaign.agentName}
                        </div>
                      </td>
                      <td><StatusBadge status={campaign.status} /></td>
                      <td className="muted">{aboutTime(campaign.updatedAt || campaign.pausedAt || campaign.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {visible.length === 0 && campaigns.length ? <p className="muted sheet-empty">No campaigns match these filters.</p> : null}
          </section>
        </>
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
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Priya - outbound test" required />
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
            First cohort (CSV, optional)
            <textarea value={form.csv} onChange={(e) => setForm({ ...form, csv: e.target.value })} placeholder={"Riya Shah,+919876543210,notes"} />
          </label>
        </form>
      </Modal>
    </>
  );
}
