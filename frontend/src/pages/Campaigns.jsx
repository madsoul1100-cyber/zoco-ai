import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { StackedBars } from "../components/BarChart.jsx";
import { AvatarMark, EmptyState, Modal, PageHeader, StatusBadge, aboutTime } from "../components/ui.jsx";
import { parseCsvTable, guessColumnMap } from "../lib/csv.js";

const PAST = new Set(["completed", "ended", "archived"]);

export default function Campaigns() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [overview, setOverview] = useState(null);
  const [form, setForm] = useState({
    name: "",
    agentId: "",
    csv: "",
    concurrency: 1,
    start: "09:00:00",
    end: "19:00:00",
    timezone: "Asia/Kolkata",
    agentVersion: "",
  });
  const [step, setStep] = useState(1);
  const [headers, setHeaders] = useState([]);
  const [columnMap, setColumnMap] = useState({ phone: "", name: "" });
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
    if (step === 1) {
      setStep(2);
      return;
    }
    if (step === 2) {
      if (!String(form.csv || "").trim()) {
        setBusy(true);
        try {
          const campaign = await api.createCampaign({
            name: form.name,
            agentId: form.agentId,
            agentVersion: form.agentVersion || undefined,
            concurrency: Number(form.concurrency || 1),
            schedule: { start: form.start, end: form.end, timezone: form.timezone, days: "Every day" },
            contacts: [],
          });
          setOpen(false);
          setStep(1);
          navigate(`/campaigns/${campaign.id}`);
        } catch (err) {
          setError(err.message);
        } finally {
          setBusy(false);
        }
        return;
      }
      const table = parseCsvTable(form.csv);
      const agent = agents.find((item) => item.id === form.agentId);
      const guessed = guessColumnMap(table.headers, agent?.inputVariables || []);
      setHeaders(table.headers);
      setColumnMap((current) => ({ ...guessed, ...current }));
      setStep(3);
      return;
    }
    setError("");
    setBusy(true);
    try {
      const table = parseCsvTable(form.csv);
      const campaign = await api.createCampaign({
        name: form.name,
        agentId: form.agentId,
        agentVersion: form.agentVersion || undefined,
        concurrency: Number(form.concurrency || 1),
        schedule: { start: form.start, end: form.end, timezone: form.timezone, days: "Every day" },
        columnMap,
        contacts: table.rows,
      });
      setOpen(false);
      setStep(1);
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
        title={step === 1 ? "Create campaign" : step === 2 ? "Upload audience" : "Map columns"}
        onClose={() => { setOpen(false); setStep(1); }}
        footer={
          <>
            {step > 1 ? <button className="btn ghost" type="button" onClick={() => setStep((n) => n - 1)}>Back</button> : (
              <button className="btn ghost" type="button" onClick={() => { setOpen(false); setStep(1); }}>Cancel</button>
            )}
            <button className="btn" type="submit" form="create-campaign" disabled={busy}>
              {busy ? "Creating…" : step < 3 ? "Continue" : "Create campaign"}
            </button>
          </>
        }
      >
        {error ? <p className="error">{error}</p> : null}
        <ol className="wizard-steps">
          <li className={step === 1 ? "on" : ""}>Agent</li>
          <li className={step === 2 ? "on" : ""}>CSV</li>
          <li className={step === 3 ? "on" : ""}>Map variables</li>
        </ol>
        <form id="create-campaign" className="grid" onSubmit={create}>
          {step === 1 ? (
            <>
              <label>
                Campaign name
                <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Priya - outbound test" required />
              </label>
              <label>
                Agent
                <select className="input" value={form.agentId} onChange={(e) => {
                  const agent = agents.find((item) => item.id === e.target.value);
                  setForm({ ...form, agentId: e.target.value, agentVersion: agent?.version || "" });
                }}>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>{agent.name} (v{agent.version || 1})</option>
                  ))}
                </select>
              </label>
              <label>
                Pin agent version
                <input className="input" type="number" min="1" value={form.agentVersion} onChange={(e) => setForm({ ...form, agentVersion: e.target.value })} placeholder="Latest" />
              </label>
              <label>
                Max concurrent calls
                <input className="input" type="number" min="1" max="50" value={form.concurrency} onChange={(e) => setForm({ ...form, concurrency: e.target.value })} />
              </label>
              <div className="grid split">
                <label>Window start<input className="input" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></label>
                <label>Window end<input className="input" value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} /></label>
              </div>
            </>
          ) : null}
          {step === 2 ? (
            <label>
              CSV with a header row
              <textarea value={form.csv} onChange={(e) => setForm({ ...form, csv: e.target.value })} placeholder={"name,phone,city\nRiya Shah,+919876543210,Hyderabad"} required={false} />
            </label>
          ) : null}
          {step === 3 ? (
            <>
              <p className="muted">Map CSV columns onto this agent’s input variables. Phone is required.</p>
              {["phone", "name", ...((agents.find((item) => item.id === form.agentId)?.inputVariables || []).map((item) => item.key).filter((key) => key && key !== "name" && key !== "phone"))].map((key) => (
                <label key={key}>
                  {key}
                  <select className="input" value={columnMap[key] || ""} onChange={(e) => setColumnMap({ ...columnMap, [key]: e.target.value })}>
                    <option value="">Skip</option>
                    {headers.map((header) => (
                      <option key={header} value={header}>{header}</option>
                    ))}
                  </select>
                </label>
              ))}
            </>
          ) : null}
        </form>
      </Modal>
    </>
  );
}
