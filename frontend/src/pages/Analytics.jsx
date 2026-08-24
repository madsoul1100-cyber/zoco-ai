import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";

export default function Analytics() {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.analytics().then(setData).catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading analytics…</p>;

  return (
    <>
      <PageHeader
        title="Agent analytics"
        subtitle="See connect rate, successful outcomes, and which desk is actually closing the loop."
      />
      <div className="grid stats">
        <Stat label="Calls" value={data.overview.totalCalls} />
        <Stat label="Success rate" value={`${data.overview.successRate}%`} />
        <Stat label="Connect rate" value={`${data.overview.connectRate}%`} />
        <Stat label="Recall due" value={data.overview.recallDue} />
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>By agent</h3>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Calls</th>
              <th>Successful</th>
              <th>Live</th>
              <th>Success rate</th>
            </tr>
          </thead>
          <tbody>
            {data.byAgent.map((row) => (
              <tr key={row.id} className="clickable" onClick={() => navigate(`/agents/${row.id}`)}>
                <td>
                  <strong>{row.name}</strong>
                  <div className="muted">{row.direction}</div>
                </td>
                <td>{row.totalCalls}</td>
                <td>{row.successfulCalls}</td>
                <td>{row.liveCalls}</td>
                <td>{row.successRate}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="grid split" style={{ marginTop: 16 }}>
        <section className="card">
          <h3>Outcomes</h3>
          {Object.entries(data.dispositions).map(([key, value]) => (
            <div key={key} className="row" style={{ justifyContent: "space-between" }}>
              <span>{key.replaceAll("_", " ")}</span>
              <strong>{value}</strong>
            </div>
          ))}
        </section>
        <section className="card">
          <h3>Last 14 days</h3>
          {data.days.map((day) => (
            <div key={day.date} className="row" style={{ justifyContent: "space-between" }}>
              <span>{day.date}</span>
              <span className="muted">{day.calls} calls · {day.success} successful</span>
            </div>
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
