import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { PageHeader, StatusBadge, when, MessageTimeline } from "../components/ui.jsx";
import { LANGUAGES, languageLabel } from "../lib/languages.js";
import { normalizePhone } from "../lib/phone.js";

export default function Calling() {
  const navigate = useNavigate();
  const [agents, setAgents] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [telephony, setTelephony] = useState(null);
  const [queue, setQueue] = useState({ due: [], upcoming: [], recallDue: [], recallLater: [] });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [phoneForm, setPhoneForm] = useState({ workspaceName: "", workspacePhone: "" });
  const [contactForm, setContactForm] = useState({ name: "", phone: "", notes: "" });
  const [liveCall, setLiveCall] = useState(null);
  const [exotelForm, setExotelForm] = useState({
    accountSid: "",
    apiKey: "",
    apiToken: "",
    fromNumber: "",
    publicBaseUrl: "",
  });
  const [dial, setDial] = useState({
    agentId: "",
    contactId: "",
    useWorkspacePhone: true,
    scheduledAt: "",
    language: "en-IN",
  });

  async function refresh() {
    const [agentList, contactList, tel, queued] = await Promise.all([
      api.agents(),
      api.contacts(),
      api.telephony(),
      api.queue(),
    ]);
    setAgents(agentList);
    setContacts(contactList);
    setTelephony(tel);
    setQueue(queued);
    setPhoneForm({
      workspaceName: tel.workspaceName || "",
      workspacePhone: tel.workspacePhone || "",
    });
    setExotelForm({
      accountSid: tel.accountSid || "",
      apiKey: tel.apiKeySet ? "••••••••" : "",
      apiToken: tel.apiTokenSet || tel.authTokenSet ? "••••••••" : "",
      fromNumber: tel.fromNumber || "",
      publicBaseUrl: tel.publicBaseUrl || "",
    });
    setDial((current) => {
      const agentId = current.agentId || agentList.find((a) => a.id === "agt_flight_desk")?.id || agentList[0]?.id || "";
      const selected = agentList.find((a) => a.id === agentId);
      return {
        ...current,
        agentId,
        language: current.agentId ? current.language : selected?.language || "en-IN",
      };
    });
  }

  useEffect(() => {
    refresh().catch((err) => setError(err.message));
  }, []);

  useEffect(() => {
    if (!liveCall?.id) return;
    const timer = setInterval(async () => {
      try {
        const next = await api.call(liveCall.id);
        setLiveCall(next);
        if (!["queued", "ringing", "in_progress"].includes(next.status)) {
          clearInterval(timer);
          refresh();
        }
      } catch {
        /* ignore poll errors */
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [liveCall?.id]);

  async function registerPhone(event) {
    event.preventDefault();
    setError("");
    try {
      const saved = await api.saveTelephony({
        workspaceName: phoneForm.workspaceName || "You",
        workspacePhone: normalizePhone(phoneForm.workspacePhone),
      });
      setTelephony(saved);
      setNotice(`Registered ${saved.workspacePhone}. You can call this number now or add customers.`);
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function saveExotel(event) {
    event.preventDefault();
    setError("");
    try {
      const saved = await api.saveTelephony({
        workspaceName: phoneForm.workspaceName,
        workspacePhone: phoneForm.workspacePhone,
        accountSid: exotelForm.accountSid.trim(),
        apiKey: exotelForm.apiKey.includes("•") ? undefined : exotelForm.apiKey.trim(),
        apiToken: exotelForm.apiToken.includes("•") ? undefined : exotelForm.apiToken.trim(),
        fromNumber: exotelForm.fromNumber.trim(),
        publicBaseUrl: exotelForm.publicBaseUrl.trim(),
      });
      setTelephony(saved);
      setNotice(
        saved.exotelReady
          ? "Exotel is ready. Call phone will ring the customer mobile."
          : "Saved. Add account SID, API key, token, Exophone, and a public HTTPS URL."
      );
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  async function addContact(event) {
    event.preventDefault();
    setError("");
    await api.createContact(contactForm);
    setContactForm({ name: "", phone: "", notes: "" });
    await refresh();
  }

  async function placeCall({ schedule, mode }) {
    setError("");
    setNotice("");
    if (!dial.agentId) {
      setError("Pick an agent first.");
      return;
    }
    const payload = {
      agentId: dial.agentId,
      channel: "voice",
      mode,
      useWorkspacePhone: dial.useWorkspacePhone,
      contactId: dial.useWorkspacePhone ? undefined : dial.contactId,
      scheduledAt: schedule && dial.scheduledAt ? new Date(dial.scheduledAt).toISOString() : null,
      language: dial.language,
    };
    if (!payload.useWorkspacePhone && !payload.contactId) {
      setError("Add a customer, or call your registered phone.");
      return;
    }
    try {
      const call = await api.startCall(payload);
      if (call.status === "queued") {
        setNotice(`Scheduled ${call.customer?.name} for ${when(call.scheduledAt)}.`);
        await refresh();
        return;
      }
      if (call.channel === "telephony" || call.exotelSid || call.twilioSid) {
        setLiveCall(call);
        setNotice(`Ringing ${call.customer?.phone}. Answer the phone — the agent is on the line.`);
        return;
      }
      navigate(`/agents/${call.agentId}?call=${call.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  async function startQueued(call, { recall = false } = {}) {
    try {
      if (recall) {
        const next = await api.recall(call.id);
        if (next.channel === "telephony" || next.exotelSid || next.twilioSid) {
          setLiveCall(next);
          return;
        }
        navigate(`/agents/${next.agentId}?call=${next.id}`);
        return;
      }
      const started = await api.startOutbound(call.id);
      if (started.channel === "telephony" || started.exotelSid || started.twilioSid) {
        setLiveCall(started);
        return;
      }
      navigate(`/agents/${started.agentId}?call=${started.id}`);
    } catch (err) {
      setError(err.message);
    }
  }

  if (!telephony) return <p className="muted">Loading calling desk…</p>;

  const exotelReady = Boolean(telephony.exotelReady ?? telephony.twilioReady);

  return (
    <>
      <PageHeader
        title="Calling desk"
        subtitle="Connect Exotel, then Call phone. The customer mobile rings and the Zoco agent talks on the line."
        actions={<span className={`badge ${exotelReady ? "done" : "recall"}`}>{exotelReady ? "Live line ready" : "Exotel not connected"}</span>}
      />

      {error ? <p className="error">{error}</p> : null}
      {notice ? <p className="success">{notice}</p> : null}

      <ol className="steps">
        <li><b>Register</b> the mobile that should ring (your phone for a test).</li>
        <li><b>Connect Exotel</b> — Account SID, API key, token, Exophone, and a public HTTPS URL.</li>
        <li><b>Call phone</b> — Exotel connects the customer and streams audio to Zoco.</li>
      </ol>

      {liveCall ? (
        <section className="card lift" style={{ marginBottom: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Live call · {liveCall.customer?.phone}</h3>
            <StatusBadge status={liveCall.status} disposition={liveCall.disposition} />
          </div>
          <p className="muted">Answer the phone. The transcript below updates as you talk.</p>
          <MessageTimeline messages={liveCall.messages || []} />
        </section>
      ) : null}

      <div className="grid trio" style={{ marginBottom: 16 }}>
        <form className="card grid" onSubmit={registerPhone}>
          <h3>1. Register your phone</h3>
          <p className="muted">This is your number on file. Test outbound calls can target it. Later this is also how we verify a real line.</p>
          <label>
            Your name
            <input className="input" value={phoneForm.workspaceName} onChange={(e) => setPhoneForm({ ...phoneForm, workspaceName: e.target.value })} placeholder="Anurag" />
          </label>
          <label>
            Phone
            <input className="input" value={phoneForm.workspacePhone} onChange={(e) => setPhoneForm({ ...phoneForm, workspacePhone: e.target.value })} placeholder="9876543210" required />
          </label>
          <button className="btn" type="submit">
            {telephony.workspacePhone ? "Update number" : "Register number"}
          </button>
          {telephony.workspacePhone ? (
            <p className="muted">On file: {telephony.workspacePhone}</p>
          ) : null}
        </form>

        <form className="card grid" onSubmit={saveExotel}>
          <h3>Exotel live line</h3>
          <p className="muted">From my.exotel.com. Public URL must be HTTPS (your domain or ngrok on port 8787).</p>
          <label>
            Account SID
            <input className="input" value={exotelForm.accountSid} onChange={(e) => setExotelForm({ ...exotelForm, accountSid: e.target.value })} placeholder="your-account-sid" />
          </label>
          <label>
            API key
            <input className="input" value={exotelForm.apiKey} onChange={(e) => setExotelForm({ ...exotelForm, apiKey: e.target.value })} placeholder="API key" />
          </label>
          <label>
            API token
            <input className="input" type="password" value={exotelForm.apiToken} onChange={(e) => setExotelForm({ ...exotelForm, apiToken: e.target.value })} placeholder="API token" />
          </label>
          <label>
            Exophone
            <input className="input" value={exotelForm.fromNumber} onChange={(e) => setExotelForm({ ...exotelForm, fromNumber: e.target.value })} placeholder="080… or +91…" />
          </label>
          <label>
            Public URL
            <input className="input" value={exotelForm.publicBaseUrl} onChange={(e) => setExotelForm({ ...exotelForm, publicBaseUrl: e.target.value })} placeholder="https://voice.my-leader.in" />
          </label>
          <button className="btn secondary" type="submit">Save Exotel</button>
        </form>

        <form className="card grid" onSubmit={addContact}>
          <h3>2. Customer book</h3>
          <p className="muted">People your agency will call again and again — bookings, follow-ups, recalls.</p>
          <label>
            Name
            <input className="input" value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} placeholder="Riya Shah" required />
          </label>
          <label>
            Phone
            <input className="input" value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} placeholder="9998887776" required />
          </label>
          <label>
            Note
            <input className="input" value={contactForm.notes} onChange={(e) => setContactForm({ ...contactForm, notes: e.target.value })} placeholder="DEL-BOM 21 Aug, needs confirmation" />
          </label>
          <button className="btn secondary" type="submit">Save customer</button>
          {contacts.length ? (
            <div className="muted">
              {contacts.map((c) => (
                <div key={c.id}>{c.name} · {c.phone}</div>
              ))}
            </div>
          ) : null}
        </form>
      </div>

      <form
        className="card grid"
        onSubmit={(event) => {
          event.preventDefault();
          placeCall({ schedule: Boolean(dial.scheduledAt) });
        }}
      >
        <h3>3. Place or schedule a call</h3>
        <div className="grid split">
          <label>
            Agent
            <select
              className="input"
              value={dial.agentId}
              onChange={(e) => {
                const agentId = e.target.value;
                const selected = agents.find((agent) => agent.id === agentId);
                setDial({ ...dial, agentId, language: selected?.language || dial.language });
              }}
            >
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>{agent.name}</option>
              ))}
            </select>
          </label>
          <label>
            Language
            <select className="input" value={dial.language} onChange={(e) => setDial({ ...dial, language: e.target.value })}>
              {LANGUAGES.map((lang) => (
                <option key={lang.code} value={lang.code}>
                  {languageLabel(lang.code)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Who to call
            <select
              className="input"
              value={dial.useWorkspacePhone ? "me" : dial.contactId}
              onChange={(e) => {
                if (e.target.value === "me") setDial({ ...dial, useWorkspacePhone: true, contactId: "" });
                else setDial({ ...dial, useWorkspacePhone: false, contactId: e.target.value });
              }}
            >
              <option value="me">My registered phone {telephony.workspacePhone || "(add above)"}</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Schedule (leave empty to call now)
          <input
            className="input"
            type="datetime-local"
            value={dial.scheduledAt}
            onChange={(e) => setDial({ ...dial, scheduledAt: e.target.value })}
          />
        </label>
        <div className="row">
          <button className="btn" type="button" onClick={() => placeCall({ schedule: false, mode: "phone" })}>Call phone</button>
          <button className="btn ghost" type="button" onClick={() => placeCall({ schedule: false, mode: "browser" })}>Test in browser</button>
          <button className="btn secondary" type="submit">Schedule</button>
        </div>
        {!exotelReady ? (
          <p className="muted">Call phone needs Exotel + a public HTTPS URL. Test in browser still works without it.</p>
        ) : null}
      </form>

      <div className="grid split" style={{ marginTop: 16 }}>
        <section className="card">
          <h3>Due now</h3>
          <QueueList
            empty="Nothing due."
            items={[...queue.due, ...queue.recallDue]}
            onStart={(item) => startQueued(item, { recall: Boolean(item.recall?.needed && item.status !== "queued") })}
          />
        </section>
        <section className="card">
          <h3>Scheduled</h3>
          <QueueList empty="No future calls." items={queue.upcoming} onStart={(item) => startQueued(item)} />
          {queue.recallLater.length ? (
            <>
              <h3 style={{ marginTop: 16 }}>Recalls later</h3>
              <QueueList items={queue.recallLater} onStart={(item) => startQueued(item, { recall: true })} />
            </>
          ) : null}
        </section>
      </div>
    </>
  );
}

function QueueList({ items, empty, onStart }) {
  if (!items?.length) return <p className="muted">{empty || "Empty."}</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>Who</th>
          <th>Agent</th>
          <th>When</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {items.map((call) => (
          <tr key={call.id}>
            <td>
              <strong>{call.customer?.name}</strong>
              <div className="muted">{call.customer?.phone}</div>
            </td>
            <td>{call.agentName}</td>
            <td>
              <StatusBadge status={call.status} disposition={call.disposition} />
              <div className="muted">{when(call.scheduledAt || call.recall?.scheduledAt || call.startedAt)}</div>
            </td>
            <td>
              <button className="btn" type="button" onClick={() => onStart(call)}>Start</button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
