import { useEffect, useRef } from "react";

function badgeKind(value) {
  if (["success", "qualified", "booked", "completed", "live", "running", "synced"].includes(value)) return "done";
  if (["in_progress", "ringing", "queued", "launching"].includes(value)) return "live";
  if (["paused", "draft", "past"].includes(value)) return "paused";
  return "recall";
}

export function StatusBadge({ status, disposition }) {
  const value = disposition || status || "unknown";
  const kind = badgeKind(String(value));
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

export function relativeTime(value) {
  if (!value) return "—";
  const ms = Date.now() - new Date(value).getTime();
  if (Number.isNaN(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 14) return `${day}d ago`;
  return when(value);
}

export function aboutTime(value) {
  if (!value) return "—";
  const ms = Date.now() - new Date(value).getTime();
  if (Number.isNaN(ms)) return "—";
  const min = Math.max(0, Math.round(ms / 60000));
  if (min < 1) return "just now";
  if (min < 60) return `about ${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `about ${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `about ${day} day${day === 1 ? "" : "s"} ago`;
}

const AVATAR_TONES = [
  { bg: "#163328", fg: "#c8f031" },
  { bg: "#111111", fg: "#c8f031" },
  { bg: "#1f8a4c", fg: "#ffffff" },
  { bg: "#3b6ea8", fg: "#ffffff" },
  { bg: "#c45c3e", fg: "#ffffff" },
];

export function AvatarMark({ name }) {
  const seed = String(name || "?").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
  const tone = AVATAR_TONES[seed % AVATAR_TONES.length];
  return (
    <span className="avatar-mark" style={{ background: tone.bg, color: tone.fg }} aria-hidden="true">
      {String(name || "?").trim().slice(0, 1).toUpperCase() || "Z"}
    </span>
  );
}

export function EmptyState({ title, body, action, children }) {
  return (
    <div className="empty-canvas">
      <div className="empty-glyph" aria-hidden="true">
        {children || (
          <svg viewBox="0 0 72 72" fill="none">
            <circle cx="24" cy="24" r="10" stroke="currentColor" strokeWidth="2" />
            <rect x="38" y="38" width="20" height="16" rx="3" stroke="currentColor" strokeWidth="2" />
            <path d="M32 30l10 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        )}
      </div>
      <h3>{title}</h3>
      {body ? <p className="muted">{body}</p> : null}
      {action}
    </div>
  );
}

export function Modal({ open, title, onClose, children, footer }) {
  if (!open) return null;
  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal-card" onClick={(event) => event.stopPropagation()} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-foot">{footer}</div> : null}
      </div>
    </div>
  );
}

export function MessageTimeline({ messages = [], liveText, heardText, pendingUserText }) {
  const boxRef = useRef(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, liveText, heardText, pendingUserText]);

  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const pending = String(pendingUserText || "").trim();
  const showPending = pending && pending !== String(lastUser?.text || "").trim();
  const hearing = String(heardText || "").trim();
  // Keep the live caption even while a pending line exists if hearing is newer/different.
  const showHearing = hearing && hearing !== pending && hearing !== String(lastUser?.text || "").trim();
  const live = String(liveText || "").trim();
  // Avoid duplicate bubble: final assistant message + same live caption.
  const showLive = live && live !== String(lastAssistant?.text || "").trim();

  return (
    <div className="timeline" ref={boxRef}>
      {messages.map((message) => (
        <div key={message.id} className={`bubble ${message.role}`}>
          <b>{message.role}</b>
          {message.text}
          {message.source ? <em>{message.source}</em> : null}
        </div>
      ))}
      {showPending ? (
        <div className="bubble user pending">
          <b>you</b>
          {pending}
        </div>
      ) : null}
      {showHearing ? (
        <div className="bubble user live-hear">
          <b>you · speaking</b>
          {hearing}
        </div>
      ) : null}
      {showLive ? (
        <div className="bubble assistant live-speak">
          <b>assistant · speaking</b>
          {live}
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
