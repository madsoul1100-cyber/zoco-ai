import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { EmptyState, StatusBadge, when } from "../components/ui.jsx";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "connectivity", label: "Connectivity" },
  { id: "engagement", label: "Engagement" },
  { id: "tools", label: "Tools" },
  { id: "goals", label: "Goals" },
  { id: "groupby", label: "Group by" },
  { id: "logs", label: "Call logs" },
];

const KPI_META = [
  { id: "attempted", key: "attempted", series: "attempted", label: "Calls attempted" },
  { id: "connected", key: "connected", series: "connected", label: "Connected calls" },
  { id: "latency", key: "latencyMs", series: "latency", label: "Latency" },
  { id: "duration", key: "avgDuration", series: "duration", label: "Avg call duration" },
  { id: "minutes", key: "totalMinutes", series: "minutes", label: "Total minutes" },
  { id: "short", key: "shortCalls", series: "short", label: "Short calls" },
];

const OUTCOME_COLORS = {
  Answered: "#c8f031",
  Busy: "#c45c3e",
  "No answer": "#6b6b6b",
  Voicemail: "#3b6ea8",
  Failed: "#e31c23",
  Other: "#d0d0d0",
};

function isoDay(value = new Date()) {
  return new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

function shiftDay(value, days) {
  const date = new Date(`${value}T12:00:00+05:30`);
  date.setDate(date.getDate() + days);
  return isoDay(date);
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

function prettyDay(value) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatKpi(id, value, kpis, asPercent) {
  if (id === "latency") return value ? `${value} ms` : "—";
  if (id === "duration") return formatDuration(value);
  if (asPercent) {
    if (id === "connected") return `${kpis.connectivity || 0}%`;
    if (id === "short") return `${kpis.connected ? Math.round((kpis.shortCalls / kpis.connected) * 100) : 0}%`;
    if (id === "attempted") return "100%";
  }
  return value ?? 0;
}

export default function Analytics() {
  const navigate = useNavigate();
  const [from, setFrom] = useState(() => shiftDay(isoDay(), -6));
  const [to, setTo] = useState(() => isoDay());
  const [campaignId, setCampaignId] = useState("");
  const [agentId, setAgentId] = useState("");
  const [tab, setTab] = useState("overview");
  const [metric, setMetric] = useState("attempted");
  const [asPercent, setAsPercent] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (tab === "connectivity") setMetric("connected");
    if (tab === "engagement") setMetric("duration");
    if (tab === "overview") setMetric("attempted");
  }, [tab]);

  useEffect(() => {
    const params = new URLSearchParams({ from, to });
    if (campaignId) params.set("campaignId", campaignId);
    if (agentId) params.set("agentId", agentId);
    api.analytics(`?${params}`).then(setData).catch((err) => setError(err.message));
  }, [from, to, campaignId, agentId]);

  const kpis = data?.kpis || {};
  const series = data?.series?.[KPI_META.find((item) => item.id === metric)?.series] || [];
  const outcomes = Object.entries(data?.outcomes || {});
  const outcomeTotal = outcomes.reduce((sum, [, count]) => sum + count, 0);

  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading analytics…</p>;

  const selectedAgent = data.agents.find((agent) => agent.id === agentId);

  return (
    <div className="analytics-page">
      <div className="kb-crumb-bar">
        <div className="kb-crumb">
          <span>Agent analytics</span>
          <span>/</span>
          <strong>{selectedAgent?.name || "All agents"}</strong>
        </div>
      </div>

      <div className="filter-bar">
        <select className="input filter-input" value={campaignId} onChange={(e) => setCampaignId(e.target.value)}>
          <option value="">All campaigns</option>
          <option value="none">Studio / no campaign</option>
          {data.campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
          ))}
        </select>
        {campaignId ? (
          <button className="icon-btn" type="button" onClick={() => setCampaignId("")} aria-label="Clear campaign">×</button>
        ) : null}
        <label className="date-range">
          <input className="input filter-input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <span>—</span>
          <input className="input filter-input" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <select className="input filter-input" value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          <option value="">All agents</option>
          {data.agents.map((agent) => (
            <option key={agent.id} value={agent.id}>{agent.name}</option>
          ))}
        </select>
      </div>

      <div className="dash-tabs">
        {TABS.map((item) => (
          <button key={item.id} type="button" className={tab === item.id ? "on" : ""} onClick={() => setTab(item.id)}>
            {item.label}
          </button>
        ))}
        <div className="unit-toggle">
          <button type="button" className={!asPercent ? "on" : ""} onClick={() => setAsPercent(false)}>#</button>
          <button type="button" className={asPercent ? "on" : ""} onClick={() => setAsPercent(true)}>%</button>
        </div>
      </div>

      {tab === "tools" ? (
        <EmptyState title="No tool invocations" body="Custom tool runs will show up here when agents start calling HTTP tools on live calls." />
      ) : null}

      {tab !== "tools" && tab !== "logs" ? (
        <>
          <div className="kpi-strip">
            {KPI_META.map((item) => (
              <button
                key={item.id}
                type="button"
                className={`kpi-tile ${metric === item.id ? "on" : ""}`}
                onClick={() => setMetric(item.id)}
              >
                <span>{item.label}</span>
                <strong>{formatKpi(item.id, kpis[item.key], kpis, asPercent)}</strong>
              </button>
            ))}
          </div>

          {tab !== "groupby" ? (
            <section className="chart-card">
              <div className="sheet-toolbar">
                <h3>{KPI_META.find((item) => item.id === metric)?.label}</h3>
                <span className="chip on">Day</span>
              </div>
              <LineChart points={series} />
            </section>
          ) : null}

          {tab === "overview" || tab === "goals" ? (
            <div className="grid split" style={{ marginTop: 16 }}>
              <OutcomeCard outcomes={outcomes} total={outcomeTotal} />
              <section className="product-sheet">
                <h3>Top failure reasons</h3>
                {(data.failures || []).length === 0 ? (
                  <p className="muted sheet-empty">No failure reasons for this period.</p>
                ) : (
                  <ul className="fail-list">
                    {data.failures.map((item) => (
                      <li key={item.reason}>
                        <span>{String(item.reason).replaceAll("_", " ")}</span>
                        <strong>{item.count}</strong>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          ) : null}

          {tab !== "goals" ? (
            <>
              <OverviewTable
                title="Agents overview"
                rows={data.byAgent}
                onOpen={(row) => navigate(`/agents/${row.id}`)}
              />
              <OverviewTable
                title="Campaign overview"
                rows={data.byCampaign}
                onOpen={(row) => row.id !== "none" && navigate(`/campaigns/${row.id}`)}
              />
            </>
          ) : (
            <section className="product-sheet" style={{ marginTop: 16 }}>
              <h3>Goals</h3>
              <p className="muted">Successful outcomes in this period.</p>
              <div className="grid stats" style={{ marginTop: 12 }}>
                <article className="card lift">
                  <div className="stat-label">Connected</div>
                  <div className="stat-value">{kpis.connected}</div>
                </article>
                <article className="card lift">
                  <div className="stat-label">Connectivity</div>
                  <div className="stat-value">{kpis.connectivity}%</div>
                </article>
                <article className="card lift">
                  <div className="stat-label">Avg turns</div>
                  <div className="stat-value">{kpis.avgTurns}</div>
                </article>
              </div>
            </section>
          )}
        </>
      ) : null}

      {tab === "logs" ? (
        <section className="product-sheet">
          <div className="sheet-toolbar">
            <h3>Call logs</h3>
            <Link className="link-quiet" to="/calls">Open full logs</Link>
          </div>
          <table className="recents-table">
            <thead>
              <tr>
                <th>Customer</th>
                <th>Agent</th>
                <th>Duration</th>
                <th>Outcome</th>
                <th>When</th>
              </tr>
            </thead>
            <tbody>
              {(data.logs || []).map((call) => (
                <tr key={call.id} className="clickable" onClick={() => navigate(`/calls/${call.id}`)}>
                  <td>
                    <strong>{call.customer?.name || "Unknown"}</strong>
                    <div className="muted">{call.customer?.phone}</div>
                  </td>
                  <td>{call.agentName}</td>
                  <td>{formatDuration(call.durationSeconds)}</td>
                  <td><StatusBadge status={call.status} disposition={call.disposition} /></td>
                  <td className="muted">{when(call.startedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {(data.logs || []).length === 0 ? <p className="muted sheet-empty">No calls in this range.</p> : null}
        </section>
      ) : null}
    </div>
  );
}

function LineChart({ points }) {
  const width = 920;
  const height = 240;
  const pad = { l: 36, r: 16, t: 16, b: 36 };
  const values = (points || []).map((point) => Number(point.value) || 0);
  const max = Math.max(...values, 1);
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const coords = (points || []).map((point, index) => {
    const x = pad.l + (points.length < 2 ? innerW / 2 : (index / (points.length - 1)) * innerW);
    const y = pad.t + innerH - (values[index] / max) * innerH;
    return { x, y, label: prettyDay(point.date), value: values[index] };
  });
  const line = coords.map((point) => `${point.x},${point.y}`).join(" ");
  const area = coords.length
    ? `${pad.l},${pad.t + innerH} ${line} ${coords.at(-1).x},${pad.t + innerH}`
    : "";

  return (
    <svg className="line-chart" viewBox={`0 0 ${width} ${height}`} role="img">
      {[0, 0.5, 1].map((tick) => {
        const y = pad.t + innerH * (1 - tick);
        return (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="rgba(17,17,17,0.08)" />
            <text x={4} y={y + 4} className="chart-label">{Math.round(max * tick)}</text>
          </g>
        );
      })}
      {area ? <polygon points={area} fill="rgba(200,240,49,0.28)" /> : null}
      {line ? <polyline points={line} fill="none" stroke="#111" strokeWidth="2.2" /> : null}
      {coords.map((point) => (
        <circle key={point.label + point.x} cx={point.x} cy={point.y} r="3.5" fill="#111" />
      ))}
      {coords.map((point, index) => (
        (index === 0 || index === coords.length - 1 || coords.length < 8) ? (
          <text key={`l-${point.label}`} x={point.x} y={height - 8} textAnchor="middle" className="chart-label">{point.label}</text>
        ) : null
      ))}
    </svg>
  );
}

function OutcomeCard({ outcomes, total }) {
  const radius = 54;
  const c = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <section className="product-sheet outcome-card">
      <h3>Call outcomes</h3>
      {total === 0 ? (
        <p className="muted sheet-empty">No attempts in this period.</p>
      ) : (
        <div className="outcome-wrap">
          <svg viewBox="0 0 140 140" className="donut">
            <circle cx="70" cy="70" r={radius} fill="none" stroke="rgba(17,17,17,0.08)" strokeWidth="16" />
            {outcomes.map(([label, count]) => {
              const dash = (count / total) * c;
              const circle = (
                <circle
                  key={label}
                  cx="70"
                  cy="70"
                  r={radius}
                  fill="none"
                  stroke={OUTCOME_COLORS[label] || "#111"}
                  strokeWidth="16"
                  strokeDasharray={`${dash} ${c - dash}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 70 70)"
                />
              );
              offset += dash;
              return circle;
            })}
            <text x="70" y="66" textAnchor="middle" className="donut-num">{total}</text>
            <text x="70" y="84" textAnchor="middle" className="donut-cap">Total attempts</text>
          </svg>
          <ul className="outcome-legend">
            {outcomes.map(([label, count]) => (
              <li key={label}>
                <span className="swatch" style={{ background: OUTCOME_COLORS[label] || "#111" }} />
                {label}
                <em>{count}</em>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function OverviewTable({ title, rows, onOpen }) {
  return (
    <section className="product-sheet" style={{ marginTop: 16 }}>
      <h3>{title}</h3>
      <div className="table-scroll">
        <table className="recents-table dense">
          <thead>
            <tr>
              <th>Name</th>
              <th>Volume</th>
              <th>Connected</th>
              <th>Connectivity (%)</th>
              <th>Unique recipients</th>
              <th>Unique connects</th>
              <th>Avg duration</th>
              <th>Avg turns</th>
              <th>Bot latency (s)</th>
              <th>Avg retry</th>
            </tr>
          </thead>
          <tbody>
            {(rows || []).map((row) => (
              <tr key={row.id} className={onOpen ? "clickable" : ""} onClick={() => onOpen?.(row)}>
                <td><strong>{row.name}</strong></td>
                <td>{row.volume}</td>
                <td>{row.connected}</td>
                <td>{row.connectivity}</td>
                <td>{row.uniqueRecipients}</td>
                <td>{row.uniqueConnects}</td>
                <td>{formatDuration(row.avgDuration)}</td>
                <td>{row.avgTurns}</td>
                <td>{row.latencySec}</td>
                <td>{row.avgRetry}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {(rows || []).length === 0 ? <p className="muted sheet-empty">Nothing in this period.</p> : null}
    </section>
  );
}
