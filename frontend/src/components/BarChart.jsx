const COLORS = {
  connected: "#1f8a4c",
  no_answer: "#9a9a9a",
  busy: "#d4a017",
  failed: "#e31c23",
  total: "#3b6ea8",
  live: "#111111",
};

export function StackedBars({ points = [], keys = ["total"], height = 180 }) {
  const width = 920;
  const pad = { l: 36, r: 16, t: 16, b: 36 };
  const innerW = width - pad.l - pad.r;
  const innerH = height - pad.t - pad.b;
  const values = points.map((point) => keys.reduce((sum, key) => sum + (Number(point[key]) || 0), 0));
  const max = Math.max(...values, 1);
  const gap = points.length > 20 ? 2 : 8;
  const barW = points.length ? Math.max(4, innerW / points.length - gap) : innerW;

  return (
    <svg className="bar-chart" viewBox={`0 0 ${width} ${height}`} role="img">
      {[0, 0.5, 1].map((tick) => {
        const y = pad.t + innerH * (1 - tick);
        return (
          <g key={tick}>
            <line x1={pad.l} x2={width - pad.r} y1={y} y2={y} stroke="rgba(17,17,17,0.08)" />
            <text x={4} y={y + 4} className="chart-label">{Math.round(max * tick)}</text>
          </g>
        );
      })}
      {points.map((point, index) => {
        const x = pad.l + index * (innerW / Math.max(points.length, 1)) + gap / 2;
        let y = pad.t + innerH;
        return (
          <g key={point.at || index}>
            {keys.map((key) => {
              const value = Number(point[key]) || 0;
              const h = (value / max) * innerH;
              y -= h;
              return <rect key={key} x={x} y={y} width={barW} height={h} fill={COLORS[key] || "#111"} rx="2" />;
            })}
          </g>
        );
      })}
      {points.map((point, index) => (
        (index === 0 || index === points.length - 1 || points.length < 10) ? (
          <text key={`l-${index}`} x={pad.l + index * (innerW / Math.max(points.length, 1)) + barW / 2} y={height - 8} textAnchor="middle" className="chart-label">
            {point.label}
          </text>
        ) : null
      ))}
    </svg>
  );
}

export function ChartLegend({ items }) {
  return (
    <div className="chart-legend">
      {items.map((item) => (
        <span key={item.key}>
          <i style={{ background: COLORS[item.key] }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}
