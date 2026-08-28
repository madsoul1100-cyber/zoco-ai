import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../api.js";
import { MessageTimeline, PageHeader, StatusBadge, when } from "../components/ui.jsx";
import { languageLabel } from "../lib/languages.js";

export default function CallDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [call, setCall] = useState(null);
  const [tab, setTab] = useState("timeline");

  useEffect(() => {
    let timer;
    let cancelled = false;
    async function load() {
      const next = await api.call(id);
      if (cancelled) return;
      setCall(next);
      if (["queued", "ringing", "in_progress"].includes(next.status)) {
        timer = setTimeout(load, 1500);
      }
    }
    load().catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  async function recall() {
    const next = await api.recall(id);
    navigate(`/calls/${next.id}`);
  }

  if (!call) return <p className="muted">Loading call…</p>;

  return (
    <>
      <PageHeader
        title={call.customer?.name || "Call"}
        subtitle={`${call.agentName} · ${languageLabel(call.language || "en-IN")} · ${call.channel} · attempt ${call.attempt || 1}`}
        actions={
          <>
            {call.recall?.needed ? <button className="btn" onClick={recall}>Recall now</button> : null}
            <button className="btn ghost" onClick={() => navigate("/calls")}>All calls</button>
          </>
        }
      />

      <div className="grid stats">
        <article className="card">
          <div className="stat-label">Outcome</div>
          <div style={{ marginTop: 12 }}><StatusBadge status={call.status} disposition={call.disposition} /></div>
        </article>
        <article className="card">
          <div className="stat-label">Duration</div>
          <div className="stat-value">{call.durationSeconds || 0}s</div>
        </article>
        <article className="card">
          <div className="stat-label">Recall</div>
          <div className="stat-value" style={{ fontSize: 22 }}>
            {call.recall?.needed ? when(call.recall.scheduledAt) : "Not needed"}
          </div>
        </article>
        <article className="card">
          <div className="stat-label">Recording</div>
          <div style={{ marginTop: 12 }}>
            {call.recordingUrl ? (
              <audio controls src={call.recordingUrl} style={{ width: "100%" }} />
            ) : (
              <span className="muted">
                {["queued", "ringing", "in_progress"].includes(call.status)
                  ? "Recording in progress — available when the call ends"
                  : "No audio file was saved"}
              </span>
            )}
          </div>
        </article>
      </div>

      <div className="row" style={{ margin: "20px 0" }}>
        <button className={tab === "timeline" ? "btn" : "btn ghost"} onClick={() => setTab("timeline")}>Chat + audio turns</button>
        <button className={tab === "json" ? "btn" : "btn ghost"} onClick={() => setTab("json")}>Message JSON</button>
      </div>

      <section className="card">
        {tab === "timeline" ? (
          <MessageTimeline messages={call.messages} />
        ) : (
          <JsonBlock value={call} />
        )}
      </section>
    </>
  );
}

function JsonBlock({ value }) {
  const ref = useRef(null);
  const text = JSON.stringify(value, null, 2);
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [text]);
  return (
    <pre className="json" ref={ref}>
      {text}
    </pre>
  );
}
