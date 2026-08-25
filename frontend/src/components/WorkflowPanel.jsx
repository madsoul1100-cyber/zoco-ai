import { STAGE_TYPES, patchWorkflow, seedWorkflow, workflowOf } from "../lib/workflow.js";
import { EmptyState } from "./ui.jsx";

function glyph(type) {
  if (type === "greeting") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M5 10.5C5 7 8 4.5 12 4.5s7 2.5 7 6c0 4.2-3.2 6.4-7 10-3.8-3.6-7-5.8-7-10z" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (type === "knowledge") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M6 5h9a3 3 0 0 1 3 3v11H9a3 3 0 0 0-3 3V5z" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 9h6M9 13h4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "condition") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <path d="M12 4 20 12l-8 8-8-8 8-8z" stroke="currentColor" strokeWidth="1.6" />
      </svg>
    );
  }
  if (type === "end") {
    return (
      <svg viewBox="0 0 24 24" fill="none">
        <circle cx="12" cy="12" r="7" stroke="currentColor" strokeWidth="1.6" />
        <path d="M9 12h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" fill="none">
      <rect x="5" y="6" width="14" height="12" rx="3" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 10h8M8 14h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function WorkflowPanel({ agent, onChange }) {
  const flow = workflowOf(agent);

  function updateNode(id, patch) {
    onChange(patchWorkflow(agent, {
      nodes: flow.nodes.map((node) => (node.id === id ? { ...node, ...patch } : node)),
    }));
  }

  function moveNode(id, dir) {
    const index = flow.nodes.findIndex((node) => node.id === id);
    const next = index + dir;
    if (index < 0 || next < 0 || next >= flow.nodes.length) return;
    const nodes = [...flow.nodes];
    [nodes[index], nodes[next]] = [nodes[next], nodes[index]];
    onChange(patchWorkflow(agent, { nodes }));
  }

  function removeNode(id) {
    const nodes = flow.nodes.filter((node) => node.id !== id);
    onChange(patchWorkflow(agent, { enabled: nodes.length > 0 && flow.enabled, nodes }));
  }

  function addBranch() {
    const yesId = `stage_${Math.random().toString(36).slice(2, 8)}`;
    const noId = `stage_${Math.random().toString(36).slice(2, 8)}`;
    const branchId = `if_${Math.random().toString(36).slice(2, 8)}`;
    onChange(patchWorkflow(agent, {
      enabled: true,
      nodes: [
        ...flow.nodes,
        { id: branchId, type: "condition", title: "If interested", match: "yes or interested", yes: yesId, no: noId, body: "" },
        { id: yesId, type: "stage", title: "Yes path", body: "Continue toward the goal." },
        { id: noId, type: "end", title: "No path", body: "Close politely and hang up." },
      ],
    }));
  }

  function addStage() {
    onChange(patchWorkflow(agent, {
      enabled: true,
      nodes: [
        ...flow.nodes,
        {
          id: `stage_${Math.random().toString(36).slice(2, 8)}`,
          type: "stage",
          title: "New stage",
          body: "What should the agent do in this part of the call?",
        },
      ],
    }));
  }

  if (!flow.nodes.length) {
    return (
      <section className="builder-panel workflow-panel">
        <div className="panel-head">
          <div>
            <h3>Workflow</h3>
            <p className="muted">Build agent behavior by defining a call flow. Stages run in order on live calls.</p>
          </div>
        </div>
        <EmptyState
          title="No workflow defined"
          body="Start with greeting, conversation, knowledge lookup, and hang-up. You can edit every stage."
          action={
            <button className="btn" type="button" onClick={() => onChange({ ...agent, workflow: seedWorkflow(agent) })}>
              + Create workflow
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section className="builder-panel workflow-panel">
      <div className="panel-head">
        <div>
          <h3>Workflow</h3>
          <p className="muted">The agent follows stages and branches. It will not name the stages out loud.</p>
        </div>
        <label className="toggle-inline">
          <input
            type="checkbox"
            checked={flow.enabled}
            onChange={(e) => onChange(patchWorkflow(agent, { enabled: e.target.checked }))}
          />
          Use on live calls
        </label>
      </div>

      <ol className="flow-rail">
        {flow.nodes.map((node, index) => (
          <li key={node.id} className="flow-node">
            {index < flow.nodes.length - 1 ? <span className="flow-line" aria-hidden="true" /> : null}
            <div className="flow-card">
              <div className="flow-card-head">
                <span className={`flow-glyph ${node.type}`}>{glyph(node.type)}</span>
                <select
                  className="input flow-type"
                  value={node.type}
                  onChange={(e) => updateNode(node.id, { type: e.target.value })}
                >
                  {STAGE_TYPES.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
                <div className="row flow-move">
                  <button className="btn ghost" type="button" onClick={() => moveNode(node.id, -1)} disabled={index === 0}>↑</button>
                  <button className="btn ghost" type="button" onClick={() => moveNode(node.id, 1)} disabled={index === flow.nodes.length - 1}>↓</button>
                  <button className="btn ghost" type="button" onClick={() => removeNode(node.id)}>Remove</button>
                </div>
              </div>
              <input
                className="input"
                value={node.title || ""}
                onChange={(e) => updateNode(node.id, { title: e.target.value })}
                placeholder="Stage name"
              />
              <textarea
                value={node.body || ""}
                onChange={(e) => updateNode(node.id, { body: e.target.value })}
                placeholder="What happens in this stage"
              />
              {node.type === "condition" ? (
                <div className="flow-branch">
                  <label>Match<input className="input" value={node.match || ""} onChange={(e) => updateNode(node.id, { match: e.target.value })} placeholder="yes, interested, callback" /></label>
                  <label>Yes →
                    <select className="input" value={node.yes || ""} onChange={(e) => updateNode(node.id, { yes: e.target.value })}>
                      {flow.nodes.filter((item) => item.id !== node.id).map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                  </label>
                  <label>No →
                    <select className="input" value={node.no || ""} onChange={(e) => updateNode(node.id, { no: e.target.value })}>
                      {flow.nodes.filter((item) => item.id !== node.id).map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                  </label>
                </div>
              ) : null}
            </div>
          </li>
        ))}
      </ol>

      <div className="row">
        <button className="btn ghost add-row" type="button" onClick={addStage}>
          + Add stage
        </button>
        <button className="btn ghost add-row" type="button" onClick={addBranch}>
          + Add branch
        </button>
      </div>
    </section>
  );
}
