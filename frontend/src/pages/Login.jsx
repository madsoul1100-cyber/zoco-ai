import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export default function Login({ setup, methods: initialMethods, onReady }) {
  const [tab, setTab] = useState(setup ? "create" : "signin");
  const [methods, setMethods] = useState(initialMethods || { email: true, google: false, phone: false });
  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "", code: "" });
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const googleBtn = useRef(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("authError");
    if (authError) setError(authError);
    if (!initialMethods) {
      api.authMe().then((data) => {
        if (data.methods) setMethods(data.methods);
      }).catch(() => {});
    }
  }, [initialMethods]);

  useEffect(() => {
    if (!methods.googleClientId || !googleBtn.current) return undefined;
    let cancelled = false;
    const start = () => {
      if (cancelled || !window.google?.accounts?.id) return;
      window.google.accounts.id.initialize({
        client_id: methods.googleClientId,
        callback: async (response) => {
          setBusy(true);
          setError("");
          try {
            const result = await api.googleLogin({ credential: response.credential });
            onReady(result.user);
          } catch (err) {
            setError(err.message);
          } finally {
            setBusy(false);
          }
        },
      });
      googleBtn.current.innerHTML = "";
      window.google.accounts.id.renderButton(googleBtn.current, {
        theme: "outline",
        size: "large",
        width: 360,
        text: setup ? "signup_with" : "continue_with",
      });
    };
    if (window.google?.accounts?.id) {
      start();
      return () => { cancelled = true; };
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.async = true;
    script.onload = start;
    document.head.appendChild(script);
    return () => { cancelled = true; };
  }, [methods.googleClientId, onReady, setup]);

  async function submitEmail(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const payload = { email: form.email, password: form.password, name: form.name };
      const result = tab === "create" || setup
        ? await api.register(payload)
        : await api.login(payload);
      onReady(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function sendCode(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api.sendPhoneOtp({ phone: form.phone });
      setOtpSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.verifyPhoneOtp({ phone: form.phone, code: form.code });
      onReady(result.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-shell">
      <div className="card login-card grid">
        <div className="brand">
          <h1>Zoco.ai</h1>
          <small>{setup ? "Create your workspace to get started" : "Sign in, create an account, or skip for testing"}</small>
        </div>
        {error ? <p className="error">{error}</p> : null}

        {methods.skip !== false ? (
          <button
            className="btn ghost skip-login"
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                const result = await api.skipLogin();
                onReady(result.user);
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Skip for now
          </button>
        ) : null}

        {methods.googleClientId ? (
          <div ref={googleBtn} className="google-btn" />
        ) : (
          <p className="muted">Add GOOGLE_CLIENT_ID in `.env` to turn on Continue with Google.</p>
        )}

        <p className="login-or">or</p>

        <form className="grid" onSubmit={otpSent ? verifyCode : sendCode}>
          <label>
            Phone number
            <input
              className="input"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+91 98765 43210"
              required
            />
          </label>
          {otpSent ? (
            <label>
              SMS code
              <input
                className="input"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="6-digit code"
                inputMode="numeric"
                required
              />
            </label>
          ) : null}
          <button className="btn ghost" type="submit" disabled={busy || !methods.phone}>
            {busy ? "Please wait…" : otpSent ? "Verify and continue" : "Send SMS code"}
          </button>
          {!methods.phone ? <p className="muted">Phone login needs Twilio SMS connected.</p> : null}
          {otpSent ? (
            <button className="link-quiet" type="button" onClick={() => setOtpSent(false)}>Use a different number</button>
          ) : null}
        </form>

        <p className="login-or">or use email</p>

        <div className="pill-tabs login-tabs">
          <button type="button" className={tab === "signin" ? "on" : ""} onClick={() => setTab("signin")}>Sign in</button>
          <button type="button" className={tab === "create" ? "on" : ""} onClick={() => setTab("create")}>Create account</button>
        </div>

        <form className="grid" onSubmit={submitEmail}>
          {tab === "create" ? (
            <label>
              Name
              <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Anurag" />
            </label>
          ) : null}
          <label>
            Email
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </label>
          <label>
            Password
            <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
          </label>
          <button className="btn" type="submit" disabled={busy}>
            {busy ? "Please wait…" : tab === "create" ? (setup ? "Create workspace" : "Create account") : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
