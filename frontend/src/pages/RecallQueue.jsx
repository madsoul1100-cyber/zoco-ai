import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader, StatusBadge, when } from "../components/ui.jsx";

export default function RecallQueue() {
  const [calls, setCalls] = useState([]);
  const navigate = useNavigate();

  async function load() {
    setCalls(await api.calls("?recall=scheduled"));
  }

  useEffect(() => {
    load();
  }, []);

  async function recall(id) {
    const next = await api.recall(id);
    navigate(`/calls/${next.id}`);
  }

  const due = calls.filter((call) => Date.parse(call.recall?.scheduledAt) <= Date.now());
  const later = calls.filter((call) => Date.parse(call.recall?.scheduledAt) > Date.now());

  return (
    <>
      <PageHeader
        title="Recall queue"
        subtitle="No answer, busy, dropped mid-call, voicemail, or a promised callback — Zoco schedules the next dial instead of losing the lead."
      />
      <section className="card">
        <h3>Due now ({due.length})</h3>
        <QueueTable calls={due} onRecall={recall} onOpen={(id) => navigate(`/calls/${id}`)} />
      </section>
      <section className="card" style={{ marginTop: 16 }}>
        <h3>Scheduled ({later.length})</h3>
        <QueueTable calls={later} onRecall={recall} onOpen={(id) => navigate(`/calls/${id}`)} />
      </section>
    </>
  );
}

function QueueTable({ calls, onRecall, onOpen }) {
  if (!calls.length) return <p className="muted">Empty.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Customer</th>
          <th>Why</th>
          <th>Attempt</th>
          <th>When</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {calls.map((call) => (
          <tr key={call.id}>
            <td>
              <strong>{call.customer?.name}</strong>
              <div className="muted">{call.customer?.phone}</div>
            </td>
            <td><StatusBadge disposition={call.disposition} /></td>
            <td>{call.attempt} / {call.recall?.maxAttempts || 3}</td>
            <td className="muted">{when(call.recall?.scheduledAt)}</td>
            <td className="row">
              <button className="btn ghost" onClick={() => onOpen(call.id)}>JSON</button>
              <button className="btn" onClick={() => onRecall(call.id)}>Recall</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
