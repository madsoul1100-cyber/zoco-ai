import { useEffect, useState } from "react";
import { api } from "../api.js";

export default function Login({ setup, onReady }) {
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { email: form.email, password: form.password, name: form.name };
      const result = setup ? await api.setupWorkspace(payload) : await api.login(payload);
      onReady(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <form className="card login-card grid" onSubmit={submit}>
        <div className="brand">
          <h1>Zoco.ai</h1>
          <small>{setup ? "Create the first workspace owner" : "Sign in to this workspace"}</small>
        </div>
        {error ? <p className="error">{error}</p> : null}
        {setup ? (
          <label>Name<input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Anurag" /></label>
        ) : null}
        <label>Email<input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required /></label>
        <label>Password<input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required /></label>
        <button className="btn" type="submit" disabled={busy}>{busy ? "Please wait…" : setup ? "Create workspace" : "Sign in"}</button>
      </form>
    </div>
  );
}
