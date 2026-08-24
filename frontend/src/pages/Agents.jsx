import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";
import { SERVICE_TEMPLATES, TEMPLATE_CATEGORIES } from "../lib/templates.js";
import { languageLabel } from "../lib/languages.js";

export default function Agents() {
  const [agents, setAgents] = useState([]);
  const [prompt, setPrompt] = useState("");
  const [category, setCategory] = useState("all");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Describe a use case, start from a template, or open a studio and test in minutes."
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
        <section style={{ marginBottom: 28 }}>
          <h3 className="section-title">Your agents</h3>
          <div className="grid agent-grid">
            {agents.map((agent) => (
              <article key={agent.id} className="card agent-card" onClick={() => navigate(`/agents/${agent.id}`)}>
                <div className="badge live">{agent.direction}</div>
                <h3>{agent.name}</h3>
                <p className="muted">{agent.useCase}</p>
                <p className="muted">{languageLabel(agent.language || "en-IN")}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      <div className="tabs">
        {TEMPLATE_CATEGORIES.map((item) => (
          <button
            key={item.id}
            type="button"
            className={category === item.id ? "btn" : "btn ghost"}
            onClick={() => setCategory(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="grid agent-grid">
        {templates.map((template) => (
          <article key={template.id} className="card agent-card template-card">
            <div className="template-icon" aria-hidden="true">
              <span />
            </div>
            <div className="badge live">{template.direction}</div>
            <h3>{template.name}</h3>
            <p className="muted">{template.useCase}</p>
            <button className="btn ghost" type="button" onClick={() => createFromTemplate(template)}>
              Use template
            </button>
          </article>
        ))}
      </div>
    </>
  );
}
