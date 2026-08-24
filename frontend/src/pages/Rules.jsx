import { useEffect, useState } from "react";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";

export default function Rules() {
  const [rules, setRules] = useState(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.rules().then(setRules);
  }, []);

  async function save(event) {
    event.preventDefault();
    setRules(await api.saveRules(rules));
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  }

  function toggle(code) {
    const recallOn = rules.recallOn.includes(code)
      ? rules.recallOn.filter((item) => item !== code)
      : [...rules.recallOn, code];
    setRules({ ...rules, recallOn });
  }

  if (!rules) return <p className="muted">Loading rules…</p>;

  const codes = ["no_answer", "busy", "dropped", "voicemail", "callback_requested", "failed"];

  return (
    <>
      <PageHeader
        title="Call rules"
        subtitle="Decide what success means, when a live call should be recovered, and how soon Zoco should recall the customer."
      />
      <form className="grid split" onSubmit={save}>
        <section className="card grid">
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
          <button className="btn" type="submit">{saved ? "Saved" : "Save rules"}</button>
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
        </section>
      </form>
    </>
  );
}
