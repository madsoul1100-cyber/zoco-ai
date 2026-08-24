import { useEffect, useRef } from "react";

export function StatusBadge({ status, disposition }) {
  const value = disposition || status || "unknown";
  const kind = ["success", "qualified", "booked", "completed"].includes(value)
    ? "done"
    : ["in_progress", "ringing", "queued"].includes(value)
      ? "live"
      : "recall";
  return (
    <span className={`badge ${kind}`}>
      <span className="dot" />
      {String(value).replaceAll("_", " ")}
    </span>
  );
}

export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="topbar">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="row">{actions}</div> : null}
    </div>
  );
}

export function MessageTimeline({ messages = [], liveText, heardText }) {
  const boxRef = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveText, heardText]);

  return (
    <div className="timeline" ref={boxRef}>
      {messages.map((message) => (
        <div key={message.id} className={`bubble ${message.role}`}>
          <b>{message.role}</b>
          {message.text}
          {message.source ? <em>{message.source}</em> : null}
        </div>
      ))}
      {heardText ? (
        <div className="bubble user">
          <b>you · hearing</b>
          {heardText}
        </div>
      ) : null}
      {liveText ? (
        <div className="bubble assistant">
          <b>assistant · live</b>
          {liveText}
        </div>
      ) : null}
    </div>
  );
}

export function when(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    day: "numeric",
    month: "short",
  });
}
