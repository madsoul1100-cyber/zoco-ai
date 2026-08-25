import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { AvatarMark, PageHeader, relativeTime } from "../components/ui.jsx";
import { SERVICE_TEMPLATES, TEMPLATE_CATEGORIES } from "../lib/templates.js";
import { languageLabel } from "../lib/languages.js";

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showAllTemplates, setShowAllTemplates] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    api.agents().then(setAgents);
  }, []);

  async function createFromPrompt(event) {
    event.preventDefault();
    if (!prompt.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const agent = await api.generateAgent(prompt.trim());
      navigate(`/agents/${agent.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function createBlank() {
    const agent = await api.createAgent({
      name: "Untitled agent",
      direction: "inbound",
      useCase: "Answer calls and complete the customer's request.",
      successCriteria: "Resolve the request or capture a callback.",
      category: "support",
    });
    navigate(`/agents/${agent.id}`);
  }

  async function createFromTemplate(template) {
    const { id: _id, ...rest } = template;
    const agent = await api.createAgent(rest);
    navigate(`/agents/${agent.id}`);
  }

  const templates = SERVICE_TEMPLATES.filter((item) => category === "all" || item.category === category);
  const visibleTemplates = showAllTemplates ? templates : templates.slice(0, 3);
  const recents = agents
    .filter((agent) => `${agent.name} ${agent.useCase || ""}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));

  return (
    <>
      <PageHeader
        title="Agents"
        actions={
          <button className="btn" type="button" onClick={createBlank}>
            + Create from scratch
          </button>
        }
      />

      {error ? <p className="error">{error}</p> : null}

      <section className="prompt-hero">
        <h3>What should your voice agent do?</h3>
        <form className="prompt-bar" onSubmit={createFromPrompt}>
          <input
            className="input"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="Create a voice agent to answer calls and confirm appointments."
          />
          <button className="btn" type="submit" disabled={busy || prompt.trim().length < 8}>
            {busy ? "Building…" : "Create"}
          </button>
        </form>
      </section>

      {agents.length ? (
        <section className="product-sheet">
          <div className="sheet-toolbar">
            <h3>Recents</h3>
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
                <th>Last edited</th>
              </tr>
            </thead>
            <tbody>
              {recents.map((agent) => (
                <tr key={agent.id} className="clickable" onClick={() => navigate(`/agents/${agent.id}`)}>
                  <td>
                    <div className="entity-cell">
                      <AvatarMark name={agent.name} />
                      <div>
                        <strong>{agent.name}</strong>
                        <div className="muted">{languageLabel(agent.language || "en-IN")} · {agent.direction}</div>
                      </div>
                    </div>
                  </td>
                  <td className="muted">{relativeTime(agent.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}

      <section className="templates-block">
        <div className="sheet-toolbar">
          <h3>Agent templates</h3>
          <div className="tabs">
            {TEMPLATE_CATEGORIES.map((item) => (
              <button
                key={item.id}
                type="button"
                className={category === item.id ? "chip on" : "chip"}
                onClick={() => setCategory(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>
        <div className="grid agent-grid">
          {visibleTemplates.map((template) => (
            <article key={template.id} className="card agent-card template-card" onClick={() => createFromTemplate(template)}>
              <div className="template-icon" aria-hidden="true">
                <span />
              </div>
              <h3>{template.name}</h3>
              <p className="muted">{template.useCase}</p>
            </article>
          ))}
        </div>
        {templates.length > 3 ? (
          <button className="link-quiet view-more" type="button" onClick={() => setShowAllTemplates((value) => !value)}>
            {showAllTemplates ? "View less" : "View more"}
          </button>
        ) : null}
      </section>
    </>
  );
}
