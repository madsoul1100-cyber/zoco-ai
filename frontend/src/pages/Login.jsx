import { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
      <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5c-.3 1.5-1.2 2.8-2.5 3.6v3h4c2.4-2.2 3.5-5.4 3.5-8.7z" />
      <path fill="#34A853" d="M12 24c3.2 0 5.9-1 7.9-2.9l-4-3c-1.1.8-2.5 1.2-3.9 1.2-3 0-5.6-2-6.5-4.8H1.4v3.1C3.4 21.4 7.4 24 12 24z" />
      <path fill="#FBBC05" d="M5.5 14.5c-.2-.7-.4-1.4-.4-2.5s.1-1.8.4-2.5V6.4H1.4C.5 8.2 0 10.1 0 12s.5 3.8 1.4 5.6l4.1-3.1z" />
      <path fill="#EA4335" d="M12 4.8c1.7 0 3.3.6 4.5 1.7l3.4-3.4C17.9 1.1 15.2 0 12 0 7.4 0 3.4 2.6 1.4 6.4l4.1 3.1C6.4 6.7 9 4.8 12 4.8z" />
    </svg>
  );
}

function PhoneIcon() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" aria-hidden="true">
      <path d="M8.2 3.5h7.6c.7 0 1.2.5 1.2 1.2v14.6c0 .7-.5 1.2-1.2 1.2H8.2c-.7 0-1.2-.5-1.2-1.2V4.7c0-.7.5-1.2 1.2-1.2z" stroke="currentColor" strokeWidth="1.7" />
      <path d="M11 18.2h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

function LoginArt() {
  const canvas = useRef(null);

  useEffect(() => {
    const node = canvas.current;
    if (!node) return undefined;
    const cols = 28;
    const rows = 36;
    node.width = cols;
    node.height = rows;
    const ctx = node.getContext("2d");
    const palette = ["#061714", "#0b2a22", "#133d32", "#1a5c40", "#1f8a4c", "#6fbf3a", "#c8f031", "#0e3a44", "#1a6b72", "#2aa39a"];

    const hash = (x, y) => {
      const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
      return s - Math.floor(s);
    };
    const value = (x, y) => {
      const nx = x / cols;
      const ny = y / rows;
      const ridge = 1 - Math.abs(ny - 0.46 + Math.sin(nx * 3.4) * 0.1);
      const n = Math.sin(nx * 7 + ny * 2.2) * 0.28 + hash(x * 0.35, y * 0.35) * 0.22;
      return Math.min(1, Math.max(0, ridge * 0.72 + n + 0.08));
    };

    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < cols; x += 1) {
        const t = value(x, y);
        const index = Math.min(palette.length - 1, Math.floor(t * (palette.length - 0.01)));
        ctx.fillStyle = palette[index];
        ctx.fillRect(x, y, 1, 1);
      }
    }
    return undefined;
  }, []);

  return <canvas ref={canvas} className="login-art-canvas" aria-hidden="true" />;
}

export default function Login({ setup, methods: initialMethods, onReady }) {
  const [tab, setTab] = useState(setup ? "create" : "signin");
  const [view, setView] = useState("home");
  const [methods, setMethods] = useState(initialMethods || { email: true, google: false, phone: false, skip: true });
  const [form, setForm] = useState({ email: "", password: "", name: "", phone: "", code: "" });
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get("authError");
    if (authError) setError(authError);
    if (initialMethods) {
      setMethods(initialMethods);
      return;
    }
    api.authMe().then((data) => {
      if (data.methods) setMethods(data.methods);
    }).catch(() => {});
  }, [initialMethods]);

  async function sendCode(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api.sendPhoneOtp({ phone: form.phone });
      if (result.phone) setForm((current) => ({ ...current, phone: result.phone }));
      setOtpSent(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  function continueGoogle() {
    if (!methods.google) {
      setError("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in `.env`, then restart the API.");
      return;
    }
    setBusy(true);
    setError("");
    // Full OAuth redirect — most reliable for local + production
    window.location.assign("/api/auth/google");
  }

  async function skipNow() {
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
  }

  async function submitEmail(event) {
    event.preventDefault();
    if (view !== "email") {
      if (!form.email) {
        setError("Enter your email to continue.");
        return;
      }
      setError("");
      setView("email");
      return;
    }
    if (String(form.password || "").length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const payload = { email: form.email, password: form.password, name: form.name };
      const result = tab === "create" || setup ? await api.register(payload) : await api.login(payload);
      onReady(result.user);
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

  const creating = tab === "create" || setup;
  const heading = view === "phone"
    ? "Continue with phone"
    : view === "email"
      ? (creating ? "Create your account" : "Welcome back")
      : (creating ? (setup ? "Create your workspace" : "Create your account") : "Log into your account");

  return (
    <div className="login-shell">
      <aside className="login-art">
        <LoginArt />
      </aside>

      <section className="login-side">
        <div className="login-panel">
          <div className="login-mark" aria-hidden="true">
            <svg viewBox="0 0 48 48" fill="none">
              <circle cx="24" cy="24" r="21.2" stroke="currentColor" strokeWidth="1.6" />
              <path d="M10 24c3.4-7 5.2-7 8 0s5.2 7 8 0 5.2-7 8 0" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
            </svg>
          </div>
          <h1>{heading}</h1>
          {error ? <p className="login-error">{error}</p> : null}

          {view === "home" ? (
            <>
              <button
                className="login-method"
                type="button"
                disabled={busy}
                onClick={continueGoogle}
              >
                <GoogleIcon />
                {busy ? "Opening Google…" : "Continue with Google"}
              </button>

              <button
                className="login-method"
                type="button"
                disabled={busy || !methods.phone}
                onClick={() => {
                  if (!methods.phone) {
                    setError("Phone login needs Twilio SMS connected.");
                    return;
                  }
                  setError("");
                  setOtpSent(false);
                  setView("phone");
                }}
              >
                <PhoneIcon />
                Continue with phone
              </button>
              {!methods.phone ? (
                <p className="login-hint">Phone needs Twilio SMS. Connect Twilio in Settings, then try again.</p>
              ) : null}

              <div className="login-or"><span>or</span></div>

              <form className="login-form" onSubmit={submitEmail}>
                <input
                  className="login-field"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                  placeholder="e.g., name@company.com"
                  autoComplete="email"
                  required
                />
                <button className="login-continue" type="submit" disabled={busy}>
                  {busy ? "Please wait…" : "Continue"}
                </button>
              </form>

              <p className="login-switch">
                {creating ? "Already have an account? " : "Don’t have an account? "}
                <button
                  type="button"
                  onClick={() => {
                    setTab(creating ? "signin" : "create");
                    setError("");
                  }}
                >
                  {creating ? "Sign in" : "Create one"}
                </button>
              </p>
            </>
          ) : null}

          {view === "phone" ? (
            <form className="login-form" onSubmit={otpSent ? verifyCode : sendCode}>
              {!otpSent ? (
                <input
                  className="login-field"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                  placeholder="+91 98765 43210"
                  autoComplete="tel"
                  inputMode="tel"
                  required
                  autoFocus
                />
              ) : (
                <>
                  <p className="login-email">Code sent to {form.phone}</p>
                  <input
                    className="login-field"
                    value={form.code}
                    onChange={(e) => setForm({ ...form, code: e.target.value.replace(/\D/g, "").slice(0, 6) })}
                    placeholder="6-digit code"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    required
                    autoFocus
                  />
                </>
              )}
              <button className="login-continue" type="submit" disabled={busy || !methods.phone}>
                {busy ? "Please wait…" : otpSent ? "Verify and continue" : "Send SMS code"}
              </button>
              {otpSent ? (
                <button
                  className="login-text"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setOtpSent(false);
                    setForm({ ...form, code: "" });
                    setError("");
                  }}
                >
                  Use a different number
                </button>
              ) : null}
              <button
                className="login-text"
                type="button"
                onClick={() => {
                  setView("home");
                  setOtpSent(false);
                  setForm({ ...form, code: "" });
                  setError("");
                }}
              >
                Back
              </button>
            </form>
          ) : null}

          {view === "email" ? (
            <form className="login-form" onSubmit={submitEmail}>
              <p className="login-email">{form.email}</p>
              {creating ? (
                <input
                  className="login-field"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="Your name"
                  autoComplete="name"
                />
              ) : null}
              <input
                className="login-field"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder={creating ? "Create a password" : "Password"}
                autoComplete={creating ? "new-password" : "current-password"}
                minLength={6}
                required
                autoFocus
              />
              <button className="login-continue" type="submit" disabled={busy}>
                {busy ? "Please wait…" : creating ? (setup ? "Create workspace" : "Create account") : "Continue"}
              </button>
              <button
                className="login-text"
                type="button"
                onClick={() => {
                  setView("home");
                  setForm({ ...form, password: "" });
                  setError("");
                }}
              >
                Back
              </button>
            </form>
          ) : null}

          {view === "email" ? (
            <p className="login-switch">
              {creating ? "Already have an account? " : "Don’t have an account? "}
              <button
                type="button"
                onClick={() => {
                  setTab(creating ? "signin" : "create");
                  setError("");
                }}
              >
                {creating ? "Sign in" : "Create one"}
              </button>
            </p>
          ) : null}

          {methods.skip !== false ? (
            <button className="login-skip" type="button" disabled={busy} onClick={skipNow}>
              Skip for now
            </button>
          ) : null}
        </div>

        <p className="login-legal">
          By continuing you agree to our <a href="/docs">terms of service</a> and <a href="/docs">privacy policy</a>.
        </p>
      </section>
    </div>
  );
}
