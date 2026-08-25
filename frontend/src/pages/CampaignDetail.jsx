import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { ChartLegend, StackedBars } from "../components/BarChart.jsx";
import { Modal, StatusBadge, aboutTime, when } from "../components/ui.jsx";
import { parseCsv } from "../lib/csv.js";

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [hours, setHours] = useState(24);
  const [grain, setGrain] = useState("hour");
  const [attemptsOpen, setAttemptsOpen] = useState(false);
  const [cohortOpen, setCohortOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [retry, setRetry] = useState(null);
  const [cohortForm, setCohortForm] = useState({ name: "cohort_sample_cohort", csv: "" });

  async function refresh(nextHours = hours, nextGrain = grain) {
    const query = `?hours=${nextHours}&grain=${nextGrain === "minute" ? "minute" : "hour"}`;
    setCampaign(await api.campaign(id, query));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [id]);

  useEffect(() => {
    if (!campaign) return;
    refresh(hours, grain).catch((err) => setError(err.message));
  }, [hours, grain]);

  async function act(fn) {
    setBusy(true);
    setError("");
    setMenuOpen(false);
    try {
      await fn();
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function addCohort(event) {
    event.preventDefault();
    const contacts = parseCsv(cohortForm.csv);
    if (!contacts.length) {
      setError("Paste name,phone rows for this cohort.");
      return;
    }
    await act(async () => {
      await api.addCohort(id, { name: cohortForm.name, contacts });
      setCohortOpen(false);
      setCohortForm({ name: "cohort_sample_cohort", csv: "" });
    });
  }

  async function openRetries(cohort) {
    setRetry(await api.campaignRetries(id, cohort?.id || ""));
    setAttemptsOpen(true);
  }

  if (error && !campaign) return <p className="error">{error}</p>;
  if (!campaign) return <p className="muted">Loading campaign…</p>;

  const running = ["running", "launching", "in_progress"].includes(campaign.status);
  const stats = campaign.stats || {};

  return (
    <>
      <div className="kb-crumb-bar">
        <div className="kb-crumb">
          <Link to="/campaigns">Outbound Campaigns</Link>
          <span>/</span>
          <strong>{campaign.name}</strong>
          <StatusBadge status={campaign.status} />
        </div>
        <div className="row">
          <Link className="btn ghost" to={`/analytics?campaignId=${campaign.id}`}>View Full Analytics</Link>
          <Link className="btn ghost" to={`/campaigns/${campaign.id}/schedules`}>View details</Link>
          <div className="menu-wrap">
            <button className="btn ghost" type="button" onClick={() => setMenuOpen((open) => !open)}>Actions</button>
            {menuOpen ? (
              <div className="menu-card">
                {running ? (
                  <button type="button" onClick={() => act(() => api.pauseCampaign(id))}>Pause</button>
                ) : (
                  <button type="button" onClick={() => act(() => api.resumeCampaign(id))}>Resume</button>
                )}
                <Link to={`/agents/${campaign.agentId}`}>Edit agent</Link>
                <Link to={`/campaigns/${campaign.id}/schedules`}>Schedules</Link>
                <button type="button" onClick={() => act(async () => { await api.deleteCampaign(id); navigate("/campaigns"); })}>Delete</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <p className="muted" style={{ marginTop: -8 }}>
        {campaign.status === "paused" ? `Paused ${aboutTime(campaign.pausedAt || campaign.updatedAt)}` : aboutTime(campaign.updatedAt)}
      </p>
      {error ? <p className="error">{error}</p> : null}

      <div className="grid stats" style={{ margin: "16px 0" }}>
        <article className="card lift"><div className="stat-label">Audience size</div><div className="stat-value">{stats.audienceSize || 0}</div></article>
        <article className="card lift"><div className="stat-label">Completion rate</div><div className="stat-value">{stats.completionRate || 0}%</div></article>
        <article className="card lift"><div className="stat-label">Pick up rate</div><div className="stat-value">{stats.pickupRate || 0}%</div></article>
      </div>

      <section className="product-sheet deploy-card">
        <div className="sheet-toolbar">
          <h3>Number of calls</h3>
          <div className="row">
            <div className="unit-toggle">
              <button type="button" className={hours === 24 ? "on" : ""} onClick={() => setHours(24)}>24h</button>
              <button type="button" className={hours === 24 * 30 ? "on" : ""} onClick={() => setHours(24 * 30)}>All time</button>
            </div>
            <select className="input filter-input" value={grain} onChange={(e) => setGrain(e.target.value)}>
              <option value="hour">By hour</option>
              <option value="minute">By minute</option>
            </select>
          </div>
        </div>
        <ChartLegend items={[
          { key: "connected", label: "Connected" },
          { key: "no_answer", label: "No answer" },
          { key: "busy", label: "Busy" },
          { key: "failed", label: "Failed" },
        ]} />
        <StackedBars points={campaign.activity || []} keys={["connected", "no_answer", "busy", "failed"]} />
      </section>

      <section className="product-sheet" style={{ marginTop: 16 }}>
        <div className="sheet-toolbar">
          <h3>Cohorts</h3>
          <button className="btn" type="button" onClick={() => setCohortOpen(true)}>+ Add cohort</button>
        </div>
        <table className="recents-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Upload status</th>
              <th>Valid records</th>
              <th>Invalid records</th>
              <th>Uploaded on</th>
            </tr>
          </thead>
          <tbody>
            {(campaign.cohorts || []).map((cohort) => (
              <tr key={cohort.id} className="clickable" onClick={() => openRetries(cohort).catch((err) => setError(err.message))}>
                <td>{cohort.name}</td>
                <td><StatusBadge status={cohort.status || "completed"} /></td>
                <td>{cohort.validRecords ?? cohort.contacts?.length ?? 0}</td>
                <td>{cohort.invalidRecords || 0}</td>
                <td className="muted">{when(cohort.uploadedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {(campaign.cohorts || []).length === 0 ? <p className="muted sheet-empty">Add a cohort to start dialing.</p> : null}
      </section>

      <details className="product-sheet" style={{ marginTop: 16 }}>
        <summary className="sheet-toolbar" style={{ cursor: "pointer" }}>
          <h3>Attempted Calls</h3>
        </summary>
        {(campaign.calls || []).length === 0 ? (
          <p className="muted sheet-empty">No attempts yet.</p>
        ) : (
          <table className="recents-table">
            <thead>
              <tr><th>Customer</th><th>Outcome</th><th>When</th></tr>
            </thead>
            <tbody>
              {(campaign.calls || []).map((call) => (
                <tr key={call.id} className="clickable" onClick={() => navigate(`/calls/${call.id}`)}>
                  <td>{call.customer?.name}<div className="muted">{call.customer?.phone}</div></td>
                  <td><StatusBadge status={call.status} disposition={call.disposition} /></td>
                  <td className="muted">{when(call.startedAt || call.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </details>

      <Modal
        open={attemptsOpen}
        title="Retry attempts"
        onClose={() => setAttemptsOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setAttemptsOpen(false)}>Close</button>
            <button className="btn" type="button" onClick={() => setAttemptsOpen(false)}>Got it</button>
          </>
        }
      >
        <p className="muted">
          {(campaign.cohorts || []).find((cohort) => cohort.id === retry?.cohortId)?.name || "Cohort"} — {retry?.numbers || 0} numbers — dialled at each attempt, by connectivity status.
        </p>
        {retry?.breakdown?.total ? (
          <div className="retry-grid">
            <span>Connected {retry.breakdown.connected}</span>
            <span>No answer {retry.breakdown.no_answer}</span>
            <span>Busy {retry.breakdown.busy}</span>
            <span>Failed {retry.breakdown.failed}</span>
          </div>
        ) : (
          <p className="muted">No attempt data yet. Retry breakdown will appear once dialing starts for this cohort.</p>
        )}
      </Modal>

      <Modal
        open={cohortOpen}
        title="Add cohort"
        onClose={() => setCohortOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setCohortOpen(false)}>Cancel</button>
            <button className="btn" type="submit" form="add-cohort" disabled={busy}>Upload</button>
          </>
        }
      >
        <form id="add-cohort" className="grid" onSubmit={addCohort}>
          <label>Name<input className="input" value={cohortForm.name} onChange={(e) => setCohortForm({ ...cohortForm, name: e.target.value })} /></label>
          <label>CSV<textarea value={cohortForm.csv} onChange={(e) => setCohortForm({ ...cohortForm, csv: e.target.value })} placeholder={"name,phone,notes"} required /></label>
        </form>
      </Modal>
    </>
  );
}
