import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { EmptyState, Modal, relativeTime } from "../components/ui.jsx";
import { fileLabel, formatBytes } from "../lib/files.js";

export default function KnowledgeDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const fileRef = useRef(null);
  const [bases, setBases] = useState([]);
  const [agents, setAgents] = useState([]);
  const [kb, setKb] = useState(null);
  const [error, setError] = useState("");
  const [fileQuery, setFileQuery] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [preview, setPreview] = useState(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [note, setNote] = useState({ name: "", text: "" });
  const [question, setQuestion] = useState("");
  const [hits, setHits] = useState(null);
  const [searching, setSearching] = useState(false);
  const [menu, setMenu] = useState("");

  async function load(nextId = id) {
    const [detail, list, agentList] = await Promise.all([
      api.knowledgeBase(nextId),
      api.knowledge(),
      api.agents(),
    ]);
    setKb(detail);
    setBases(list);
    setAgents(agentList);
    setForm({ name: detail.name || "", description: detail.description || "" });
    return detail;
  }

  useEffect(() => {
    setHits(null);
    setFileQuery("");
    load().catch((err) => setError(err.message));
  }, [id]);

  async function saveEdit(event) {
    event.preventDefault();
    const saved = await api.updateKnowledge(kb.id, { name: form.name, description: form.description });
    setKb(saved);
    setEditOpen(false);
  }

  async function uploadFiles(event) {
    const files = [...(event.target.files || [])];
    event.target.value = "";
    if (!files.length) return;
    setError("");
    try {
      setKb(await api.addDocument(kb.id, { files }));
    } catch (err) {
      setError(err.message);
    }
  }

  async function addNote(event) {
    event.preventDefault();
    setError("");
    const saved = await api.addDocument(kb.id, note);
    setKb(saved);
    setNote({ name: "", text: "" });
    setNoteOpen(false);
  }

  async function removeDoc(docId) {
    setKb(await api.deleteDocument(kb.id, docId));
    setMenu("");
    setPreview(null);
  }

  async function removeBase() {
    if (!window.confirm(`Delete “${kb.name}”? Agents will stop reading these files.`)) return;
    await api.deleteKnowledge(kb.id);
    navigate("/knowledge");
  }

  async function toggleAgent(agent) {
    const ids = new Set(agent.knowledgeBaseIds || []);
    if (ids.has(kb.id)) ids.delete(kb.id);
    else ids.add(kb.id);
    const saved = await api.updateAgent(agent.id, { knowledgeBaseIds: [...ids] });
    setAgents((current) => current.map((item) => (item.id === saved.id ? saved : item)));
  }

  async function testRetrieval(event) {
    event.preventDefault();
    if (question.trim().length < 3) return;
    setSearching(true);
    setError("");
    try {
      const result = await api.queryKnowledge(kb.id, question.trim());
      setHits(result.matches || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setSearching(false);
    }
  }

  function copyId() {
    navigator.clipboard?.writeText(kb.id).catch(() => {});
  }

  if (error && !kb) return <p className="error">{error}</p>;
  if (!kb) return <p className="muted">Loading knowledge base…</p>;

  const docs = (kb.documents || []).filter((doc) =>
    `${doc.name} ${doc.text || ""}`.toLowerCase().includes(fileQuery.toLowerCase())
  );
  const stats = kb.stats || { files: 0, bytes: 0, status: "empty" };

  return (
    <div className="kb-page">
      <div className="kb-crumb-bar">
        <div className="kb-crumb">
          <Link to="/knowledge">Knowledge base</Link>
          <span>/</span>
          <select
            className="input kb-crumb-select"
            value={kb.id}
            onChange={(e) => navigate(`/knowledge/${e.target.value}`)}
          >
            {bases.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>
        <div className="row">
          <button className="btn ghost" type="button" onClick={() => setEditOpen(true)}>Edit</button>
          <button className="btn ghost" type="button" onClick={() => setNoteOpen(true)}>Add text note</button>
          <button className="btn" type="button" onClick={() => fileRef.current?.click()}>Upload files</button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            accept=".txt,.md,.csv,.json"
            onChange={uploadFiles}
          />
        </div>
      </div>

      {error ? <p className="error">{error}</p> : null}

      <section className="kb-summary">
        <span className="kb-card-icon large" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M6 5h9a3 3 0 0 1 3 3v12H9a3 3 0 0 0-3 3V5z" stroke="currentColor" strokeWidth="1.7" />
            <path d="M9 9h6M9 13h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
          </svg>
        </span>
        <div>
          <h2>{kb.name}</h2>
          <p className="muted">{kb.description || "No description"}</p>
          <dl className="kb-meta">
            <div>
              <dt>Files</dt>
              <dd>{stats.files} {stats.files === 1 ? "file" : "files"}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(stats.bytes)}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd><span className={`badge ${stats.status === "synced" ? "done" : "recall"}`}>{stats.status === "synced" ? "Synced" : "Empty"}</span></dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{relativeTime(kb.createdAt)}</dd>
            </div>
            <div>
              <dt>KB ID</dt>
              <dd>
                <button className="id-copy" type="button" onClick={copyId} title="Copy ID">
                  {kb.id}
                </button>
              </dd>
            </div>
          </dl>
        </div>
      </section>

      <section className="product-sheet kb-files">
        <div className="sheet-toolbar">
          <h3>Files</h3>
          <input
            className="input search-input"
            value={fileQuery}
            onChange={(e) => setFileQuery(e.target.value)}
            placeholder="Search files"
          />
        </div>
        {docs.length === 0 ? (
          <EmptyState
            title="No files yet"
            body="Upload .md, .txt, or .csv — or paste a note. Then test retrieval below."
            action={<button className="btn" type="button" onClick={() => fileRef.current?.click()}>Upload files</button>}
          />
        ) : (
          <table className="recents-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Size</th>
                <th>Status</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <div className="entity-cell">
                      <span className="file-kind">{fileLabel(doc.kind)}</span>
                      <strong>{doc.name}</strong>
                    </div>
                  </td>
                  <td className="muted">{formatBytes(doc.bytes)}</td>
                  <td><span className="badge done">Ready</span></td>
                  <td className="muted">{relativeTime(doc.createdAt)}</td>
                  <td className="row-actions">
                    <button className="icon-btn" type="button" onClick={() => setMenu(menu === doc.id ? "" : doc.id)} aria-label="File actions">⋯</button>
                    {menu === doc.id ? (
                      <div className="mini-menu">
                        <button type="button" onClick={() => { setPreview(doc); setMenu(""); }}>Preview</button>
                        <button type="button" onClick={() => removeDoc(doc.id)}>Remove</button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="product-sheet retrieval-card">
        <div className="sheet-toolbar">
          <div>
            <h3>Test retrieval</h3>
            <p className="muted">Ask a question to preview what agents will find in this knowledge base.</p>
          </div>
        </div>
        <form className="retrieval-bar" onSubmit={testRetrieval}>
          <input
            className="input"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="What does this knowledge base say about…?"
          />
          <button className="btn" type="submit" disabled={searching || question.trim().length < 3}>
            {searching ? "Searching…" : "Search"}
          </button>
        </form>
        {hits ? (
          hits.length === 0 ? (
            <p className="muted sheet-empty">Nothing matched. Try different words, or add a file that contains the answer.</p>
          ) : (
            <ul className="retrieval-hits">
              {hits.map((hit, index) => (
                <li key={`${hit.docId}-${index}`}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{hit.name}</strong>
                    <span className="muted">{hit.score}% match</span>
                  </div>
                  <p>{hit.excerpt}</p>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </section>

      <section className="product-sheet">
        <div className="sheet-toolbar">
          <div>
            <h3>Attached agents</h3>
            <p className="muted">Query Knowledge Base runs on live inbound and outbound calls for these agents.</p>
          </div>
          <button className="btn ghost" type="button" onClick={removeBase}>Delete knowledge base</button>
        </div>
        <div className="chip-list">
          {agents.map((agent) => {
            const on = (agent.knowledgeBaseIds || []).includes(kb.id);
            return (
              <button key={agent.id} type="button" className={`chip ${on ? "on" : ""}`} onClick={() => toggleAgent(agent)}>
                {agent.name}
              </button>
            );
          })}
          {agents.length === 0 ? (
            <Link className="btn ghost" to="/agents">Create an agent</Link>
          ) : null}
        </div>
      </section>

      <Modal open={editOpen} title="Edit knowledge base" onClose={() => setEditOpen(false)} footer={
        <>
          <button className="btn ghost" type="button" onClick={() => setEditOpen(false)}>Cancel</button>
          <button className="btn" type="submit" form="edit-kb">Save</button>
        </>
      }>
        <form id="edit-kb" className="grid" onSubmit={saveEdit}>
          <label>
            Name
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </label>
          <label>
            Description
            <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </label>
        </form>
      </Modal>

      <Modal open={noteOpen} title="Add text note" onClose={() => setNoteOpen(false)} footer={
        <>
          <button className="btn ghost" type="button" onClick={() => setNoteOpen(false)}>Cancel</button>
          <button className="btn" type="submit" form="add-note" disabled={!note.text.trim()}>Add note</button>
        </>
      }>
        <form id="add-note" className="grid" onSubmit={addNote}>
          <label>
            Title
            <input className="input" value={note.name} onChange={(e) => setNote({ ...note, name: e.target.value })} placeholder="Cancellation policy.md" />
          </label>
          <label>
            Text
            <textarea value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} placeholder="Paste the policy or FAQ…" required />
          </label>
        </form>
      </Modal>

      <Modal open={Boolean(preview)} title={preview?.name || "Preview"} onClose={() => setPreview(null)} footer={
        <button className="btn ghost" type="button" onClick={() => setPreview(null)}>Close</button>
      }>
        <pre className="kb-preview">{preview?.text}</pre>
      </Modal>
    </div>
  );
}
