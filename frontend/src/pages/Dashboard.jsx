import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader, StatusBadge, when } from "../components/ui.jsx";

export default function Dashboard() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.dashboard().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading Zoco…</p>;

  const { stats, recentCalls, recallQueue, agents } = data;

  return (
    <>
      <PageHeader
        title="Build. Test. Go live."
        subtitle="Describe an agent, test it in the studio, put a number on it, then watch every call land as transcript plus outcome."
        actions={
          <>
            <button className="btn ghost" onClick={() => navigate("/agents")}>Create agent</button>
            <button className="btn" onClick={() => navigate("/campaigns")}>Outbound campaigns</button>
          </>
        }
      />

      <div className="grid stats">
        <Stat label="Calls today" value={stats.todayCalls} />
        <Stat label="Live now" value={stats.liveCalls} />
        <Stat label="Successful" value={stats.successfulCalls} />
        <Stat label="Recall due" value={stats.recallDue} />
        <Stat label="Scheduled" value={stats.scheduledCalls || 0} />
      </div>

      <div className="grid split" style={{ marginTop: 16 }}>
        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Recent calls</h3>
            <Link to="/calls" className="link-quiet">View all</Link>
          </div>
          <table>
            <thead>
              <tr>
                <th>Customer</th>
                <th>Agent</th>
                <th>Status</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {recentCalls.map((call) => (
                <tr key={call.id} className="clickable" onClick={() => navigate(`/calls/${call.id}`)}>
                  <td>
                    <strong>{call.customer?.name}</strong>
                    <div className="muted">{call.customer?.phone || call.channel}</div>
                  </td>
                  <td>{call.agentName}</td>
                  <td><StatusBadge status={call.status} disposition={call.disposition} /></td>
                  <td className="muted">{when(call.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="card">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Recall queue</h3>
            <Link to="/boards" className="link-quiet">Open boards</Link>
          </div>
          {recallQueue.length === 0 ? <p className="muted">Nothing waiting.</p> : null}
          <div className="grid">
            {recallQueue.slice(0, 5).map((call) => (
              <div key={call.id} className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <strong>{call.customer?.name}</strong>
                  <div className="muted">{call.recall?.reason?.replaceAll("_", " ")} · {when(call.recall?.scheduledAt)}</div>
                </div>
                <StatusBadge disposition={call.disposition} />
              </div>
            ))}
          </div>
          <hr style={{ borderColor: "var(--line)", margin: "20px 0" }} />
          <h3>Agents</h3>
          {agents.map((agent) => (
            <p key={agent.id}>
              <Link to={`/agents/${agent.id}`}>{agent.name}</Link>
              <span className="muted"> · {agent.direction}</span>
            </p>
          ))}
        </section>
      </div>
    </>
  );
}

function Stat({ label, value }) {
  return (
    <article className="card lift">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
    </article>
  );
}
