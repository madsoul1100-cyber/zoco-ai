import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

const SUGGESTIONS = [
  "Rename this agent and tighten the greeting",
  "Switch the voice to Hindi and keep the greeting short",
  "Add a knowledge base for product FAQs",
];

export function GeniePanel({ agent, onApply, onClose, reviewNonce = 0 }) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef(null);
  const reviewRef = useRef(0);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy]);

  async function send(text) {
    const prompt = String(text || "").trim();
    if (!prompt || busy || !agent) return;
    setDraft("");
    setError("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", text: prompt }]);
    try {
      const result = await api.assistAgent(agent.id, { prompt, agent });
      const patch = result.patch && Object.keys(result.patch).length ? result.patch : null;
      if (patch) onApply?.(patch);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: result.reply || "Done. Review the draft, then click Finish update." },
      ]);
    } catch (err) {
      setError(err.message);
      setMessages((current) => [
        ...current,
        { role: "assistant", text: err.message || "Genie could not update this agent." },
      ]);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!reviewNonce || reviewNonce === reviewRef.current) return;
    reviewRef.current = reviewNonce;
    send("Review this agent. Find gaps in the greeting and instructions, then apply concrete edits.");
  }, [reviewNonce]);

  const empty = messages.length === 0 && !busy;

  return (
    <aside className="genie">
      <header className="genie-head">
        <div className="genie-title">
          <span className="genie-spark" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M12 3l1.4 6.1L19 12l-5.6 2.9L12 21l-1.4-6.1L5 12l5.6-2.9L12 3z" fill="currentColor" />
            </svg>
          </span>
          Genie
        </div>
        <div className="row">
          <button className="icon-btn" type="button" title="Clear" onClick={() => { setMessages([]); setError(""); }}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M4 5h16M8 5V4h8v1M7 5l1 15h8l1-15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
          <button className="icon-btn" type="button" title="Close Genie" onClick={onClose}>
            <svg viewBox="0 0 24 24" fill="none">
              <path d="M7 7l10 10M17 7L7 17" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </header>

      <div className="genie-body" ref={scroller}>
        {empty ? (
          <div className="genie-empty">
            <div className="genie-art" aria-hidden="true" />
            <h3>What's on your mind?</h3>
            <div className="genie-suggestions">
              {SUGGESTIONS.map((item) => (
                <button key={item} type="button" onClick={() => send(item)}>
                  {item}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="genie-thread">
            {messages.map((message, index) => (
              <div key={`${message.role}-${index}`} className={`genie-bubble ${message.role}`}>
                {message.text}
              </div>
            ))}
            {busy ? <div className="genie-bubble assistant muted">Working on it…</div> : null}
          </div>
        )}
        {error && empty ? <p className="error">{error}</p> : null}
      </div>

      <form
        className="genie-composer"
        onSubmit={(event) => {
          event.preventDefault();
          send(draft);
        }}
      >
        <input
          className="input"
          value={draft}
          placeholder="What's on your mind?"
          onChange={(e) => setDraft(e.target.value)}
          disabled={busy}
        />
        <button className="icon-btn send" type="submit" disabled={busy || !draft.trim()} aria-label="Send">
          <svg viewBox="0 0 24 24" fill="none">
            <path d="M12 19V7M6 11l6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </form>
    </aside>
  );
}
