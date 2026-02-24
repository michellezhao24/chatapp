import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'rgba(255, 255, 255, 0.95)',
      border: '1px solid rgba(139, 92, 246, 0.25)',
      borderRadius: 12,
      padding: '0.65rem 0.9rem',
      fontSize: '0.82rem',
      fontFamily: 'DM Sans, sans-serif',
      color: '#5b21b6',
      boxShadow: '0 4px 16px rgba(139, 92, 246, 0.12)',
    }}>
      <p style={{ margin: '0 0 0.4rem', fontWeight: 700 }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ margin: 0, color: p.stroke }}>
          {p.name}: <strong>{typeof p.value === 'number' ? p.value.toLocaleString() : p.value}</strong>
        </p>
      ))}
    </div>
  );
}

export default function MetricVsTimeChart({ data, metricColumn = 'value', enlarged = false }) {
  if (!data?.length) return null;
  const chartHeight = enlarged ? 550 : 300;

  return (
    <div className="engagement-chart-wrap">
      <p className="engagement-chart-label">
        {metricColumn} over time
      </p>
      <ResponsiveContainer width="100%" height={chartHeight}>
        <LineChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 64 }}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(139, 92, 246, 0.2)"
            vertical={false}
          />
          <XAxis
            dataKey="label"
            tick={{ fill: '#7c3aed', fontSize: 11, fontFamily: 'DM Sans, sans-serif' }}
            axisLine={{ stroke: 'rgba(139, 92, 246, 0.3)' }}
            tickLine={false}
            angle={-30}
            textAnchor="end"
            interval={0}
          />
          <YAxis
            tick={{ fill: '#7c3aed', fontSize: 11, fontFamily: 'DM Sans, sans-serif' }}
            axisLine={false}
            tickLine={false}
            width={55}
          />
          <Tooltip content={<CustomTooltip />} />
          <Line
            type="monotone"
            dataKey="value"
            name={metricColumn}
            stroke="#8b5cf6"
            strokeWidth={2}
            dot={{ fill: '#8b5cf6', r: 3 }}
            activeDot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
