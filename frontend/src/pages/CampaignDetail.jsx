import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader, StatusBadge, when } from "../components/ui.jsx";

export default function CampaignDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [campaign, setCampaign] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh() {
    setCampaign(await api.campaign(id));
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, [id]);

  async function launch() {
    setBusy(true);
    setError("");
    try {
      await api.launchCampaign(id);
      await refresh();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (error && !campaign) return <p className="error">{error}</p>;
  if (!campaign) return <p className="muted">Loading campaign…</p>;

  return (
    <>
      <PageHeader
        title={campaign.name}
        subtitle={`${campaign.agentName} · ${campaign.contacts?.length || 0} contacts`}
        actions={
          <>
            <StatusBadge status={campaign.status} />
            <button className="btn" type="button" onClick={launch} disabled={busy}>
              {busy ? "Launching…" : "Launch campaign"}
            </button>
          </>
        }
      />
      {error ? <p className="error">{error}</p> : null}

      <div className="grid stats" style={{ marginBottom: 16 }}>
        <article className="card lift"><div className="stat-label">Calls</div><div className="stat-value">{campaign.stats?.totalCalls || 0}</div></article>
        <article className="card lift"><div className="stat-label">Successful</div><div className="stat-value">{campaign.stats?.successfulCalls || 0}</div></article>
        <article className="card lift"><div className="stat-label">Recall due</div><div className="stat-value">{campaign.stats?.recallDue || 0}</div></article>
      </div>

      <div className="grid split">
        <section className="card">
          <h3>List</h3>
          <table>
            <thead>
              <tr><th>Name</th><th>Phone</th><th>Notes</th></tr>
            </thead>
            <tbody>
              {(campaign.contacts || []).map((row) => (
                <tr key={row.id}>
                  <td>{row.name}</td>
                  <td>{row.phone}</td>
                  <td className="muted">{row.notes}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <section className="card">
          <h3>Call results</h3>
          {(campaign.calls || []).length === 0 ? <p className="muted">Launch to start dialing.</p> : null}
          <table>
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
        </section>
      </div>
    </>
  );
}
