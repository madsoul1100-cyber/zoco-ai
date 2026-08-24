import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader, StatusBadge, when } from "../components/ui.jsx";

export default function Boards() {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [queue, setQueue] = useState({ due: [], upcoming: [], recallDue: [], recallLater: [] });
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api.dashboard(), api.queue()])
      .then(([dash, queued]) => {
        setData(dash);
        setQueue(queued);
      })
      .catch((err) => setError(err.message));
  }, []);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading boards…</p>;

  const live = (data.recentCalls || []).filter((call) => ["queued", "ringing", "in_progress"].includes(call.status));

  return (
    <>
      <PageHeader
        title="Boards"
        subtitle="Live calls, due recalls, and the next scheduled dials — the operations view for a running desk."
      />
      <div className="grid trio">
        <Board title="Live now" items={live} empty="No live calls." onOpen={(call) => navigate(`/calls/${call.id}`)} />
        <Board
          title="Recall due"
          items={[...queue.recallDue]}
          empty="Nothing due."
          onOpen={(call) => navigate(`/calls/${call.id}`)}
        />
        <Board
          title="Scheduled"
          items={[...queue.due, ...queue.upcoming]}
          empty="No scheduled dials."
          onOpen={(call) => navigate(`/calls/${call.id}`)}
        />
      </div>
    </>
  );
}

function Board({ title, items, empty, onOpen }) {
  return (
    <section className="card">
      <h3>{title}</h3>
      {!items.length ? <p className="muted">{empty}</p> : null}
      {items.map((call) => (
        <button key={call.id} type="button" className="board-row" onClick={() => onOpen(call)}>
          <div>
            <strong>{call.customer?.name}</strong>
            <div className="muted">{call.agentName} · {when(call.scheduledAt || call.recall?.scheduledAt || call.startedAt)}</div>
          </div>
          <StatusBadge status={call.status} disposition={call.disposition} />
        </button>
      ))}
    </section>
  );
}
