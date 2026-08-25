import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { AvatarMark, EmptyState, PageHeader, relativeTime } from "../components/ui.jsx";
import { workflowSummary } from "../lib/workflow.js";

export default function Workflows() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.agents()
      .then((list) => {
        setAgents(list);
        setReady(true);
      })
      .catch((err) => {
        setError(err.message);
        setReady(true);
      });
  }, []);

  const visible = agents.filter((agent) =>
    `${agent.name} ${agent.useCase || ""}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <PageHeader
        title="Workflows"
        subtitle="Define the call flow for each agent — greeting, conversation stages, knowledge lookup, hang-up."
      />
      {error ? <p className="error">{error}</p> : null}

      {!ready ? (
        <p className="muted">Loading workflows…</p>
      ) : agents.length === 0 ? (
        <EmptyState
          title="No agents yet"
          body="Create an agent first, then add a workflow from its studio."
          action={
            <button className="btn" type="button" onClick={() => navigate("/agents")}>
              Go to agents
            </button>
          }
        />
      ) : (
        <section className="product-sheet">
          <div className="sheet-toolbar">
            <h3>Agents</h3>
            <input
              className="input search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search"
            />
          </div>
          <table className="recents-table">
            <thead>
              <tr>
                <th>Agent</th>
                <th>Workflow</th>
                <th>Last edited</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((agent) => (
                <tr
                  key={agent.id}
                  className="clickable"
                  onClick={() => navigate(`/agents/${agent.id}?tab=workflow`)}
                >
                  <td>
                    <div className="entity-cell">
                      <AvatarMark name={agent.name} />
                      <div>
                        <strong>{agent.name}</strong>
                        <div className="muted">{agent.useCase}</div>
                      </div>
                    </div>
                  </td>
                  <td>{workflowSummary(agent)}</td>
                  <td className="muted">{relativeTime(agent.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {visible.length === 0 ? <p className="muted sheet-empty">No matching agents.</p> : null}
        </section>
      )}
    </>
  );
}
