import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";
import { normalizePhone } from "../lib/phone.js";

export default function DndList() {
  const [text, setText] = useState("");
  const [numbers, setNumbers] = useState([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    api.dnd().then((data) => {
      setNumbers(data.numbers || []);
      setText((data.numbers || []).join("\n"));
    }).catch((err) => setError(err.message));
  }, []);

  async function save(event) {
    event.preventDefault();
    setError("");
    const next = text.split(/\r?\n/).map((line) => normalizePhone(line)).filter(Boolean);
    const saved = await api.saveDnd({ numbers: next });
    setNumbers(saved.numbers || []);
    setNotice("DND list saved. Launch will skip these numbers.");
  }

  return (
    <>
      <div className="kb-crumb-bar">
        <div className="kb-crumb">
          <Link to="/campaigns">Outbound Campaigns</Link>
          <span>/</span>
          <strong>DND list</strong>
        </div>
      </div>
      <PageHeader title="DND list" subtitle="Numbers here are never dialed from outbound campaigns." />
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}
      <section className="product-sheet">
        <form className="grid" onSubmit={save}>
          <label>
            Phone numbers, one per line
            <textarea value={text} onChange={(e) => setText(e.target.value)} placeholder={"+9198…"} />
          </label>
          <div className="row">
            <button className="btn" type="submit">Save list</button>
            <span className="muted">{numbers.length} numbers</span>
          </div>
        </form>
      </section>
    </>
  );
}
