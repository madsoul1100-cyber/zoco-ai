import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";

export default function Usage() {
  const [usage, setUsage] = useState(null);

  useEffect(() => {
    api.usage().then(setUsage);
  }, []);

  if (!usage) return <p className="muted">Loading usage…</p>;
  const remaining = Math.max(0, usage.includedMinutes - usage.minutes);

  return (
    <>
      <PageHeader
        title="Usage"
        subtitle="Minutes, recordings, and live calls on this workspace. Upgrade when you outgrow the builder plan."
        actions={<Link className="btn ghost" to="/pricing">View plans</Link>}
      />
      <div className="grid stats">
        <article className="card lift"><div className="stat-label">Calls</div><div className="stat-value">{usage.calls}</div></article>
        <article className="card lift"><div className="stat-label">Minutes used</div><div className="stat-value">{usage.minutes}</div></article>
        <article className="card lift"><div className="stat-label">Included left</div><div className="stat-value">{remaining}</div></article>
        <article className="card lift"><div className="stat-label">Recordings</div><div className="stat-value">{usage.recordings}</div></article>
      </div>
      <section className="card" style={{ marginTop: 16 }}>
        <h3>Builder plan</h3>
        <p className="muted">{usage.includedMinutes} minutes included. Live calls right now: {usage.live}.</p>
      </section>
    </>
  );
}
