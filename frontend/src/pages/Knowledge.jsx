import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";

export default function Knowledge() {
  const [bases, setBases] = useState([]);
  const [selected, setSelected] = useState(null);
  const [form, setForm] = useState({ name: "", description: "" });
  const [note, setNote] = useState({ name: "", text: "" });
  const [error, setError] = useState("");

  async function refresh(id) {
    const list = await api.knowledge();
    setBases(list);
    if (id) setSelected(await api.knowledgeBase(id));
    else if (list[0]) setSelected(await api.knowledgeBase(list[0].id));
    else setSelected(null);
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function createBase(event) {
    event.preventDefault();
    setError("");
    const kb = await api.createKnowledge(form);
    setForm({ name: "", description: "" });
    await refresh(kb.id);
  }

  async function addNote(event) {
    event.preventDefault();
    if (!selected) return;
    setError("");
    const kb = await api.addDocument(selected.id, note);
    setNote({ name: "", text: "" });
    setSelected(kb);
    setBases((current) => current.map((item) => (item.id === kb.id ? kb : item)));
  }

  async function addFile(event) {
    const file = event.target.files?.[0];
    if (!file || !selected) return;
    setError("");
    try {
      const kb = await api.addDocument(selected.id, { file, name: file.name });
      setSelected(kb);
    } catch (err) {
      setError(err.message);
    }
    event.target.value = "";
  }

  async function removeDoc(docId) {
    const kb = await api.deleteDocument(selected.id, docId);
    setSelected(kb);
  }

  return (
    <>
      <PageHeader
        title="Knowledge base"
        subtitle="Upload notes, FAQs, and policies. Attach a base to an agent so answers stay grounded in your business."
      />
      {error ? <p className="error">{error}</p> : null}
      <div className="grid split">
        <section className="card grid">
          <h3>New knowledge base</h3>
          <form className="grid" onSubmit={createBase}>
            <label>
              Name
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Appointments FAQ" required />
            </label>
            <label>
              Description
              <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Hours, slots, cancellation rules" />
            </label>
            <button className="btn" type="submit">Create</button>
          </form>
          <hr style={{ borderColor: "var(--line)", width: "100%" }} />
          {bases.map((kb) => (
            <button
              key={kb.id}
              type="button"
              className={selected?.id === kb.id ? "btn" : "btn ghost"}
              onClick={() => api.knowledgeBase(kb.id).then(setSelected)}
            >
              {kb.name}
            </button>
          ))}
        </section>

        <section className="card grid">
          {selected ? (
            <>
              <h3>{selected.name}</h3>
              <p className="muted">{selected.description || "No description"}</p>
              <form className="grid" onSubmit={addNote}>
                <label>
                  Document title
                  <input className="input" value={note.name} onChange={(e) => setNote({ ...note, name: e.target.value })} placeholder="Cancellation policy" />
                </label>
                <label>
                  Paste text
                  <textarea value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} placeholder="Our clinic is open 9am to 7pm IST..." required />
                </label>
                <div className="row">
                  <button className="btn" type="submit">Add note</button>
                  <label className="btn ghost" style={{ cursor: "pointer" }}>
                    Upload file
                    <input type="file" accept=".txt,.md,.csv,.json" hidden onChange={addFile} />
                  </label>
                </div>
              </form>
              {(selected.documents || []).map((doc) => (
                <article key={doc.id} className="card" style={{ boxShadow: "none" }}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <strong>{doc.name}</strong>
                    <button className="btn ghost" type="button" onClick={() => removeDoc(doc.id)}>Remove</button>
                  </div>
                  <p className="muted">{String(doc.text || "").slice(0, 280)}</p>
                </article>
              ))}
            </>
          ) : (
            <p className="muted">Create a knowledge base to ground agent answers in your documents.</p>
          )}
        </section>
      </div>
    </>
  );
}
