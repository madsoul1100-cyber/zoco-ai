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
  const [exotelForm, setExotelForm] = useState({
    accountSid: "",
    apiKey: "",
    apiToken: "",
    fromNumber: "",
    publicBaseUrl: "",
  });
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
    setExotelForm({
      accountSid: tel.accountSid || "",
      apiKey: tel.apiKeySet ? "••••••••" : "",
      apiToken: tel.apiTokenSet || tel.authTokenSet ? "••••••••" : "",
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

  async function saveExotel(event) {
    event.preventDefault();
    setError("");
    const saved = await api.saveTelephony({
      ...phoneForm,
      accountSid: exotelForm.accountSid.trim(),
      apiKey: exotelForm.apiKey.includes("•") ? undefined : exotelForm.apiKey.trim(),
      apiToken: exotelForm.apiToken.includes("•") ? undefined : exotelForm.apiToken.trim(),
      fromNumber: exotelForm.fromNumber.trim(),
      publicBaseUrl: exotelForm.publicBaseUrl.trim(),
    });
    setTelephony(saved);
    setProviderOpen(false);
    setNotice(
      saved.exotelReady
        ? "Exotel is connected. Outbound calls will stream through Zoco."
        : "Saved. Finish account SID, API key, token, Exophone, and public URL."
    );
    await refresh();
  }

  if (!telephony) return <p className="muted">Loading numbers…</p>;

  const assigned = agents.find((agent) => agent.id === inbound?.agentId);
  const streamBase = telephony.publicBaseUrl || "https://your-public-url";
  const ready = Boolean(telephony.exotelReady ?? telephony.twilioReady);

  return (
    <>
      <PageHeader
        title="Phone numbers"
        subtitle="Workspace mobile for tests. Exotel Exophone for live inbound and outbound in India."
        actions={
          <span className={`badge ${ready ? "done" : "recall"}`}>
            {ready ? "Live line ready" : "Connect Exotel"}
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
            <span className={`badge ${ready ? "done" : "recall"}`}>
              {ready ? "Exotel" : "Not connected"}
            </span>
            <button className="btn ghost" type="button" onClick={() => setProviderOpen(true)}>
              {ready ? "Edit" : "Connect Exotel"}
            </button>
          </div>
          <h3>{telephony.fromNumber || "No Exophone yet"}</h3>
          <p className="muted">
            {assigned
              ? `Inbound agent: ${assigned.name}`
              : "Assign an inbound agent after Exotel is connected."}
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <Link className="btn ghost" to="/inbound">Inbound calls</Link>
            <Link className="btn ghost" to="/campaigns">Outbound campaigns</Link>
          </div>
        </article>
      </div>

      <section className="product-sheet" style={{ marginTop: 20 }}>
        <h3>Voice stream URL</h3>
        <p className="muted">
          Point Exotel AgentStream / VoiceBot to:{" "}
          <code>{streamBase}/api/exotel/stream?callId=&lt;call-id&gt;</code>
        </p>
        <p className="muted">
          Status callbacks: <code>{streamBase}/webhooks/exotel/status</code>
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
        title="Connect Exotel"
        onClose={() => setProviderOpen(false)}
        footer={
          <>
            <button className="btn ghost" type="button" onClick={() => setProviderOpen(false)}>Cancel</button>
            <button className="btn" type="submit" form="exotel-phone">Save provider</button>
          </>
        }
      >
        <form id="exotel-phone" className="grid" onSubmit={saveExotel}>
          <label>Account SID<input className="input" value={exotelForm.accountSid} onChange={(e) => setExotelForm({ ...exotelForm, accountSid: e.target.value })} placeholder="your-account-sid" /></label>
          <label>API key<input className="input" value={exotelForm.apiKey} onChange={(e) => setExotelForm({ ...exotelForm, apiKey: e.target.value })} placeholder="API key" /></label>
          <label>API token<input className="input" type="password" value={exotelForm.apiToken} onChange={(e) => setExotelForm({ ...exotelForm, apiToken: e.target.value })} placeholder="API token" /></label>
          <label>Exophone<input className="input" value={exotelForm.fromNumber} onChange={(e) => setExotelForm({ ...exotelForm, fromNumber: e.target.value })} placeholder="080… or +91…" /></label>
          <label>Public URL<input className="input" value={exotelForm.publicBaseUrl} onChange={(e) => setExotelForm({ ...exotelForm, publicBaseUrl: e.target.value })} placeholder="https://voice.my-leader.in" /></label>
        </form>
      </Modal>
    </>
  );
}
