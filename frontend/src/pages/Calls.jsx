import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader, StatusBadge, when } from "../components/ui.jsx";

export default function Calls() {
  const [calls, setCalls] = useState([]);
  const [filter, setFilter] = useState("");
  const navigate = useNavigate();

  useEffect(() => {
    api.calls().then(setCalls);
  }, []);

  const visible = calls.filter((call) => {
    if (!filter) return true;
    if (filter === "recall") return Boolean(call.recall?.needed);
    return call.status === filter || call.disposition === filter;
  });

  return (
    <>
      <PageHeader
        title="Call logs"
        subtitle="Every call is a JSON document: customer, status, disposition, recording, and a message-wise transcript."
      />
      <div className="row" style={{ marginBottom: 16 }}>
        {["", "in_progress", "completed", "dropped", "no_answer", "recall"].map((value) => (
          <button key={value || "all"} className={filter === value ? "btn" : "btn ghost"} onClick={() => setFilter(value)}>
            {value ? value.replaceAll("_", " ") : "All"}
          </button>
        ))}
      </div>
      <section className="card">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Agent</th>
              <th>Channel</th>
              <th>Outcome</th>
              <th>Messages</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((call) => (
              <tr key={call.id} className="clickable" onClick={() => navigate(`/calls/${call.id}`)}>
                <td>
                  <strong>{call.customer?.name}</strong>
                  <div className="muted">{call.customer?.phone}</div>
                </td>
                <td>{call.agentName}</td>
                <td className="muted">{call.channel} · {call.direction}</td>
                <td><StatusBadge status={call.status} disposition={call.disposition} /></td>
                <td>{call.messages?.length || 0}</td>
                <td className="muted">{when(call.startedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
