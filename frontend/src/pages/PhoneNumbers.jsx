import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader } from "../components/ui.jsx";
import { normalizePhone } from "../lib/phone.js";

export default function PhoneNumbers() {
  const [telephony, setTelephony] = useState(null);
  const [inbound, setInbound] = useState(null);
  const [phoneForm, setPhoneForm] = useState({ workspaceName: "", workspacePhone: "" });
  const [twilioForm, setTwilioForm] = useState({ accountSid: "", authToken: "", fromNumber: "", publicBaseUrl: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function refresh() {
    const [tel, inboundConfig] = await Promise.all([api.telephony(), api.inbound()]);
    setTelephony(tel);
    setInbound(inboundConfig);
    setPhoneForm({ workspaceName: tel.workspaceName || "", workspacePhone: tel.workspacePhone || "" });
    setTwilioForm({
      accountSid: tel.accountSid || "",
      authToken: tel.authTokenSet ? "••••••••" : "",
      fromNumber: tel.fromNumber || "",
      publicBaseUrl: tel.publicBaseUrl || "",
    });
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  async function saveWorkspace(event) {
    event.preventDefault();
    setError("");
    const saved = await api.saveTelephony({
      workspaceName: phoneForm.workspaceName || "You",
      workspacePhone: normalizePhone(phoneForm.workspacePhone),
    });
    setTelephony(saved);
    setNotice(`Workspace number ${saved.workspacePhone} is on file.`);
  }

  async function saveTwilio(event) {
    event.preventDefault();
    setError("");
    const saved = await api.saveTelephony({
      ...phoneForm,
      accountSid: twilioForm.accountSid.trim(),
      authToken: twilioForm.authToken.includes("•") ? undefined : twilioForm.authToken.trim(),
      fromNumber: twilioForm.fromNumber.trim(),
      publicBaseUrl: twilioForm.publicBaseUrl.trim(),
    });
    setTelephony(saved);
    setNotice(saved.twilioReady ? "This number can place and receive live calls." : "Saved. Finish SID, token, From number, and public URL.");
    await refresh();
  }

  if (!telephony) return <p className="muted">Loading numbers…</p>;

  return (
    <>
      <PageHeader
        title="Phone numbers"
        subtitle="Bring your Twilio number, or register a workspace mobile for test calls. Point inbound webhooks at Zoco when you go live."
        actions={<span className={`badge ${telephony.twilioReady ? "done" : "recall"}`}>{telephony.twilioReady ? "Live line ready" : "Connect a provider"}</span>}
      />
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      <div className="grid split">
        <form className="card grid" onSubmit={saveWorkspace}>
          <h3>Workspace mobile</h3>
          <p className="muted">Used for test outbound calls and as the caller on file.</p>
          <label>
            Name
            <input className="input" value={phoneForm.workspaceName} onChange={(e) => setPhoneForm({ ...phoneForm, workspaceName: e.target.value })} />
          </label>
          <label>
            Phone
            <input className="input" value={phoneForm.workspacePhone} onChange={(e) => setPhoneForm({ ...phoneForm, workspacePhone: e.target.value })} placeholder="9876543210" required />
          </label>
          <button className="btn" type="submit">Save number</button>
        </form>

        <form className="card grid" onSubmit={saveTwilio}>
          <h3>Provider number</h3>
          <p className="muted">Twilio Account SID, Auth Token, From number, and a public URL such as ngrok on port 8787.</p>
          <label>Account SID<input className="input" value={twilioForm.accountSid} onChange={(e) => setTwilioForm({ ...twilioForm, accountSid: e.target.value })} placeholder="ACxxxxxxxx" /></label>
          <label>Auth Token<input className="input" type="password" value={twilioForm.authToken} onChange={(e) => setTwilioForm({ ...twilioForm, authToken: e.target.value })} /></label>
          <label>From number<input className="input" value={twilioForm.fromNumber} onChange={(e) => setTwilioForm({ ...twilioForm, fromNumber: e.target.value })} placeholder="+1…" /></label>
          <label>Public URL<input className="input" value={twilioForm.publicBaseUrl} onChange={(e) => setTwilioForm({ ...twilioForm, publicBaseUrl: e.target.value })} placeholder="https://xxxx.ngrok-free.app" /></label>
          <button className="btn secondary" type="submit">Save provider</button>
        </form>
      </div>

      <section className="card" style={{ marginTop: 16 }}>
        <h3>Inbound webhook</h3>
        <p className="muted">
          In Twilio, set the voice webhook for this number to{" "}
          <code>{telephony.publicBaseUrl || "https://your-public-url"}/webhooks/twilio/inbound</code>
          . Then assign an agent on <Link to="/inbound">Inbound calls</Link>.
        </p>
        <p className="muted">Assigned agent: {inbound?.agentId ? inbound.agentId : "none yet"}</p>
      </section>
    </>
  );
}
