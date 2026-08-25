import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { EmptyState, Modal, PageHeader, relativeTime } from "../components/ui.jsx";
import { formatBytes } from "../lib/files.js";

export default function Knowledge() {
  const navigate = useNavigate();
  const [bases, setBases] = useState([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [form, setForm] = useState({ name: "", description: "" });
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    api.knowledge()
      .then((list) => {
        setBases(list);
        setReady(true);
      })
      .catch((err) => {
        setError(err.message);
        setReady(true);
      });
  }, []);

  async function createBase(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const kb = await api.createKnowledge(form);
      setForm({ name: "", description: "" });
      setCreateOpen(false);
      navigate(`/knowledge/${kb.id}`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  const visible = bases.filter((kb) =>
    `${kb.name} ${kb.description || ""}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <>
      <PageHeader
        title="Knowledge base"
        subtitle="Upload files, test retrieval, then attach the base so live answers stay grounded."
        actions={
          <button className="btn" type="button" onClick={() => setCreateOpen(true)}>
            + Create knowledge base
          </button>
        }
      />
      {error ? <p className="error">{error}</p> : null}

      {!ready ? (
        <p className="muted">Loading knowledge…</p>
      ) : bases.length === 0 ? (
        <EmptyState
          title="No knowledge bases yet"
          body="Create a base, upload .md / .txt / .csv files, then test retrieval before you attach it to an agent."
          action={
            <button className="btn" type="button" onClick={() => setCreateOpen(true)}>
              + Create knowledge base
            </button>
          }
        />
      ) : (
        <>
          <div className="sheet-toolbar" style={{ paddingTop: 0 }}>
            <p className="muted">{bases.length} knowledge {bases.length === 1 ? "base" : "bases"}</p>
            <input
              className="input search-input"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search knowledge bases"
            />
          </div>
          <div className="kb-card-grid">
            {visible.map((kb) => (
              <button
                key={kb.id}
                type="button"
                className="kb-card"
                onClick={() => navigate(`/knowledge/${kb.id}`)}
              >
                <span className="kb-card-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" fill="none">
                    <path d="M6 5h9a3 3 0 0 1 3 3v12H9a3 3 0 0 0-3 3V5z" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M9 9h6M9 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
                  </svg>
                </span>
                <strong>{kb.name}</strong>
                <p className="muted">{kb.description || "No description"}</p>
                <div className="kb-card-meta">
                  <span>{kb.stats?.files || 0} {(kb.stats?.files || 0) === 1 ? "file" : "files"}</span>
                  <span>{formatBytes(kb.stats?.bytes || 0)}</span>
                  <span className={`badge ${kb.stats?.status === "synced" ? "done" : "recall"}`}>
                    {kb.stats?.status === "synced" ? "Synced" : "Empty"}
                  </span>
                  <span className="muted">{relativeTime(kb.updatedAt || kb.createdAt)}</span>
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      <Modal
        open={createOpen}
        title="New knowledge base"
        onClose={() => setCreateOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button className="btn" type="submit" form="create-kb" disabled={busy || !form.name.trim()}>
              {busy ? "Creating…" : "Create"}
            </button>
          </>
        }
      >
        <form id="create-kb" className="grid" onSubmit={createBase}>
          <label>
            Name
            <input
              className="input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="mlc-graduates-priya-outbound"
              required
            />
          </label>
          <label>
            Description
            <input
              className="input"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Updated outbound version"
            />
          </label>
        </form>
      </Modal>
    </>
  );
}
