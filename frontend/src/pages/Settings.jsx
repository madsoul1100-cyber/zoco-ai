import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";

export default function Settings() {
  const [rules, setRules] = useState(null);
  const [telephony, setTelephony] = useState(null);
  const [ai, setAi] = useState(null);
  const [keys, setKeys] = useState({ openrouter: "", sarvam: "", grok: "", openai: "" });
  const [saved, setSaved] = useState("");

  useEffect(() => {
    Promise.all([api.rules(), api.telephony(), api.aiSettings()]).then(([nextRules, tel, nextAi]) => {
      setRules(nextRules);
      setTelephony(tel);
      setAi(nextAi);
      setKeys(nextAi.keys || { openrouter: "", sarvam: "", grok: "", openai: "" });
    });
  }, []);

  async function saveRules(event) {
    event.preventDefault();
    setRules(await api.saveRules(rules));
    setSaved("rules");
    setTimeout(() => setSaved(""), 1600);
  }

  async function saveAi(event) {
    event.preventDefault();
    const next = await api.saveAi({
      defaultLlmProvider: ai.defaultLlmProvider,
      defaultTtsProvider: ai.defaultTtsProvider,
      keys,
    });
    setAi({ ...ai, ...next, catalog: next.catalog });
    setSaved("ai");
    setTimeout(() => setSaved(""), 1600);
  }

  function toggle(code) {
    const recallOn = rules.recallOn.includes(code)
      ? rules.recallOn.filter((item) => item !== code)
      : [...rules.recallOn, code];
    setRules({ ...rules, recallOn });
  }

  if (!rules || !telephony || !ai) return <p className="muted">Loading settings…</p>;
  const codes = ["no_answer", "busy", "dropped", "voicemail", "callback_requested", "failed"];
  const catalog = ai.catalog || { llm: [], tts: [] };

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="Choose default AI and voice providers, add API keys, then set recall rules."
      />

      <form className="card grid" onSubmit={saveAi} style={{ marginBottom: 16 }}>
        <h3>AI and voice</h3>
        <p className="muted">Each agent can override these in the studio. Keys can also come from `.env`.</p>
        <div className="grid split">
          <label>
            Default brain
            <select className="input" value={ai.defaultLlmProvider} onChange={(e) => setAi({ ...ai, defaultLlmProvider: e.target.value })}>
              {catalog.llm.map((item) => (
                <option key={item.id} value={item.id}>{item.label}{item.ready ? "" : " — not connected"}</option>
              ))}
            </select>
          </label>
          <label>
            Default voice
            <select className="input" value={ai.defaultTtsProvider} onChange={(e) => setAi({ ...ai, defaultTtsProvider: e.target.value })}>
              {catalog.tts.map((item) => (
                <option key={item.id} value={item.id}>{item.label}{item.ready ? "" : " — not connected"}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid split">
          <label>OpenRouter key<input className="input" type="password" value={keys.openrouter} onChange={(e) => setKeys({ ...keys, openrouter: e.target.value })} placeholder="sk-or-…" /></label>
          <label>Sarvam AI key<input className="input" type="password" value={keys.sarvam} onChange={(e) => setKeys({ ...keys, sarvam: e.target.value })} placeholder="sarvam subscription key" /></label>
          <label>Grok / xAI key<input className="input" type="password" value={keys.grok} onChange={(e) => setKeys({ ...keys, grok: e.target.value })} placeholder="xai-…" /></label>
          <label>OpenAI key<input className="input" type="password" value={keys.openai} onChange={(e) => setKeys({ ...keys, openai: e.target.value })} placeholder="sk-…" /></label>
        </div>
        <button className="btn" type="submit">{saved === "ai" ? "Saved" : "Save AI providers"}</button>
      </form>

      <form className="grid split" onSubmit={saveRules}>
        <section className="card grid">
          <h3>Call rules</h3>
          <label>
            Max attempts
            <input className="input" type="number" min="1" max="8" value={rules.maxAttempts} onChange={(e) => setRules({ ...rules, maxAttempts: Number(e.target.value) })} />
          </label>
          <div>
            <p className="muted">Recall when the call ends as</p>
            <div className="row">
              {codes.map((code) => (
                <button type="button" key={code} className={rules.recallOn.includes(code) ? "btn" : "btn ghost"} onClick={() => toggle(code)}>
                  {code.replaceAll("_", " ")}
                </button>
              ))}
            </div>
          </div>
          <p className="muted">Business hours {rules.businessHours.start}–{rules.businessHours.end} {rules.businessHours.timezone}</p>
          <button className="btn" type="submit">{saved === "rules" ? "Saved" : "Save rules"}</button>
        </section>
        <section className="card grid">
          <h3>Delay before recall</h3>
          {codes.map((code) => (
            <label key={code}>
              {code.replaceAll("_", " ")} (minutes)
              <input
                className="input"
                type="number"
                min="1"
                value={rules.delaysMinutes[code] || 60}
                onChange={(e) => setRules({
                  ...rules,
                  delaysMinutes: { ...rules.delaysMinutes, [code]: Number(e.target.value) },
                })}
              />
            </label>
          ))}
          <p className="muted">Workspace line: {telephony.workspacePhone || "not registered"} · Provider {telephony.twilioReady ? "ready" : "not connected"}</p>
        </section>
      </form>
    </>
  );
}
