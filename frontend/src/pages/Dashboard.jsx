import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { AvatarMark, PageHeader, StatusBadge, relativeTime, when } from "../components/ui.jsx";

function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

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
  const name = data.workspaceName || data.telephony?.workspaceName || "";

  return (
    <>
      <PageHeader
        title={`${greeting()}${name ? `, ${name}` : ""}`}
        subtitle="Build an agent, attach knowledge, put a number on it, then watch every call land as transcript plus outcome."
        actions={
          <>
            <button className="btn ghost" onClick={() => navigate("/agents")}>Create agent</button>
            <button className="btn" onClick={() => navigate("/campaigns")}>Outbound campaigns</button>
          </>
        }
      />

      <div className="grid stats">
        <Stat label="Live now" value={stats.liveCalls} />
        <Stat label="Calls today" value={stats.todayCalls} />
        <Stat label="Successful" value={stats.successfulCalls} />
        <Stat label="Recall due" value={stats.recallDue} />
      </div>

      <div className="grid split" style={{ marginTop: 20 }}>
        <section className="product-sheet">
          <div className="sheet-toolbar">
            <h3>Recents</h3>
            <Link to="/agents" className="link-quiet">All agents</Link>
          </div>
          {agents.length === 0 ? (
            <p className="muted sheet-empty">No agents yet. Create one from the Agents page.</p>
          ) : (
            <table className="recents-table">
              <thead>
                <tr>
                  <th>Agent</th>
                  <th>Last edited</th>
                </tr>
              </thead>
              <tbody>
                {agents.slice(0, 6).map((agent) => (
                  <tr key={agent.id} className="clickable" onClick={() => navigate(`/agents/${agent.id}`)}>
                    <td>
                      <div className="entity-cell">
                        <AvatarMark name={agent.name} />
                        <div>
                          <strong>{agent.name}</strong>
                          <div className="muted">{agent.direction}</div>
                        </div>
                      </div>
                    </td>
                    <td className="muted">{relativeTime(agent.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="product-sheet">
          <div className="sheet-toolbar">
            <h3>Recent calls</h3>
            <Link to="/calls" className="link-quiet">View all</Link>
          </div>
          {recentCalls.length === 0 ? (
            <p className="muted sheet-empty">No calls yet.</p>
          ) : (
            <table className="recents-table">
              <thead>
                <tr>
                  <th>Customer</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentCalls.slice(0, 6).map((call) => (
                  <tr key={call.id} className="clickable" onClick={() => navigate(`/calls/${call.id}`)}>
                    <td>
                      <strong>{call.customer?.name}</strong>
                      <div className="muted">{call.agentName}</div>
                    </td>
                    <td><StatusBadge status={call.status} disposition={call.disposition} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {recallQueue.length ? (
            <>
              <hr className="sheet-rule" />
              <div className="sheet-toolbar">
                <h3>Recall due</h3>
                <Link to="/boards" className="link-quiet">Open boards</Link>
              </div>
              {recallQueue.slice(0, 4).map((call) => (
                <div key={call.id} className="row" style={{ justifyContent: "space-between", padding: "8px 0" }}>
                  <div>
                    <strong>{call.customer?.name}</strong>
                    <div className="muted">{when(call.recall?.scheduledAt)}</div>
                  </div>
                  <StatusBadge disposition={call.disposition} />
                </div>
              ))}
            </>
          ) : null}
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
