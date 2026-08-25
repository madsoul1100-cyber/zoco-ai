import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";
import { Modal, PageHeader } from "../components/ui.jsx";
import { normalizePhone } from "../lib/phone.js";

export default function PhoneNumbers() {
  const [telephony, setTelephony] = useState(null);
  const [inbound, setInbound] = useState(null);
  const [agents, setAgents] = useState([]);
  const [phoneForm, setPhoneForm] = useState({ workspaceName: "", workspacePhone: "" });
  const [twilioForm, setTwilioForm] = useState({ accountSid: "", authToken: "", fromNumber: "", publicBaseUrl: "" });
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [providerOpen, setProviderOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);

  async function refresh() {
    const [tel, inboundConfig, agentList] = await Promise.all([api.telephony(), api.inbound(), api.agents()]);
    setTelephony(tel);
    setInbound(inboundConfig);
    setAgents(agentList);
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
    setWorkspaceOpen(false);
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
    setProviderOpen(false);
    setNotice(saved.twilioReady ? "This number can place and receive live calls." : "Saved. Finish SID, token, From number, and public URL.");
    await refresh();
  }

  if (!telephony) return <p className="muted">Loading numbers…</p>;

  const assigned = agents.find((agent) => agent.id === inbound?.agentId);

  return (
    <>
      <PageHeader
        title="Phone numbers"
        subtitle="Workspace mobile for tests. Twilio number for live inbound and outbound."
        actions={
          <span className={`badge ${telephony.twilioReady ? "done" : "recall"}`}>
            {telephony.twilioReady ? "Live line ready" : "Connect a provider"}
          </span>
        }
      />
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      <div className="number-grid">
        <article className="number-card">
          <div className="number-card-top">
            <span className="badge live">Workspace</span>
            <button className="btn ghost" type="button" onClick={() => setWorkspaceOpen(true)}>Edit</button>
          </div>
          <h3>{telephony.workspacePhone || "No mobile yet"}</h3>
          <p className="muted">{telephony.workspaceName || "You"} · used for test outbound and as the caller on file.</p>
        </article>

        <article className="number-card">
          <div className="number-card-top">
            <span className={`badge ${telephony.twilioReady ? "done" : "recall"}`}>
              {telephony.twilioReady ? "Provider" : "Not connected"}
            </span>
            <button className="btn ghost" type="button" onClick={() => setProviderOpen(true)}>
              {telephony.twilioReady ? "Edit" : "Connect Twilio"}
            </button>
          </div>
          <h3>{telephony.fromNumber || "No Twilio number"}</h3>
          <p className="muted">
            {assigned
              ? `Inbound agent: ${assigned.name}`
              : "Assign an inbound agent after this number is connected."}
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <Link className="btn ghost" to="/inbound">Inbound calls</Link>
            <Link className="btn ghost" to="/campaigns">Outbound campaigns</Link>
          </div>
        </article>
      </div>

      <section className="product-sheet" style={{ marginTop: 20 }}>
        <h3>Inbound webhook</h3>
        <p className="muted">
          Voice webhook for this number:{" "}
          <code>{telephony.publicBaseUrl || "https://your-public-url"}/webhooks/twilio/inbound</code>
        </p>
      </section>

      <Modal
        open={workspaceOpen}
        title="Workspace mobile"
        onClose={() => setWorkspaceOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setWorkspaceOpen(false)}>Cancel</button>
            <button className="btn" type="submit" form="workspace-phone">Save number</button>
          </>
        }
      >
        <form id="workspace-phone" className="grid" onSubmit={saveWorkspace}>
          <label>
            Name
            <input className="input" value={phoneForm.workspaceName} onChange={(e) => setPhoneForm({ ...phoneForm, workspaceName: e.target.value })} />
          </label>
          <label>
            Phone
            <input className="input" value={phoneForm.workspacePhone} onChange={(e) => setPhoneForm({ ...phoneForm, workspacePhone: e.target.value })} placeholder="9876543210" required />
          </label>
        </form>
      </Modal>

      <Modal
        open={providerOpen}
        title="Connect Twilio"
        onClose={() => setProviderOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setProviderOpen(false)}>Cancel</button>
            <button className="btn" type="submit" form="twilio-phone">Save provider</button>
          </>
        }
      >
        <form id="twilio-phone" className="grid" onSubmit={saveTwilio}>
          <label>Account SID<input className="input" value={twilioForm.accountSid} onChange={(e) => setTwilioForm({ ...twilioForm, accountSid: e.target.value })} placeholder="ACxxxxxxxx" /></label>
          <label>Auth Token<input className="input" type="password" value={twilioForm.authToken} onChange={(e) => setTwilioForm({ ...twilioForm, authToken: e.target.value })} /></label>
          <label>From number<input className="input" value={twilioForm.fromNumber} onChange={(e) => setTwilioForm({ ...twilioForm, fromNumber: e.target.value })} placeholder="+1…" /></label>
          <label>Public URL<input className="input" value={twilioForm.publicBaseUrl} onChange={(e) => setTwilioForm({ ...twilioForm, publicBaseUrl: e.target.value })} placeholder="https://xxxx.ngrok-free.app" /></label>
        </form>
      </Modal>
    </>
  );
}
