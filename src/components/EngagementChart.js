import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

const WITH_COLOR = '#8b5cf6';    // violet-500
const WITHOUT_COLOR = '#a78bfa'; // violet-400

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: 'linear-gradient(180deg, #f5f0e8 0%, #e8e0d5 100%)',
      border: '2px solid #c4b8a8',
      borderRadius: 10,
      padding: '0.65rem 0.9rem',
      fontSize: '0.82rem',
      fontFamily: 'Inter, sans-serif',
      color: '#5b21b6',
      boxShadow: 'inset 0 2px 4px rgba(255,255,255,0.9), 0 4px 16px rgba(139, 92, 246, 0.12)',
    }}>
      <p style={{ margin: '0 0 0.4rem', fontWeight: 700, color: '#5b21b6' }}>{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ margin: '0.15rem 0', color: p.fill }}>
          {p.name}: <strong>{p.value.toLocaleString()}</strong>
          {p.payload[p.dataKey === 'withKeyword' ? 'withCount' : 'withoutCount'] !== undefined && (
            <span style={{ opacity: 0.55, marginLeft: 6 }}>
              (n={p.payload[p.dataKey === 'withKeyword' ? 'withCount' : 'withoutCount']})
            </span>
          )}
        </p>
      ))}
    </div>
  );
}

export default function EngagementChart({ data, metricColumn = 'Favorite Count' }) {
  console.log('[EngagementChart] render called, data:', data);
  if (!data?.length) {
    console.warn('[EngagementChart] no data — chart will not render');
    return null;
  }

  return (
    <div className="engagement-chart-wrap">
      <p className="engagement-chart-label">
        Mean {metricColumn} — with vs without keyword
      </p>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 8, right: 16, left: 0, bottom: 64 }}
          barCategoryGap="30%"
          barGap={4}
        >
          <CartesianGrid
            strokeDasharray="3 3"
            stroke="rgba(139, 92, 246, 0.2)"
            vertical={false}
          />
          <XAxis
            dataKey="name"
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
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(139, 92, 246, 0.06)' }} />
          <Legend
            wrapperStyle={{
              paddingTop: 12,
              fontSize: 12,
              fontFamily: 'DM Sans, sans-serif',
              color: '#7c3aed',
            }}
          />
          <Bar dataKey="withKeyword" name="With keyword" fill={WITH_COLOR} radius={[5, 5, 0, 0]} />
          <Bar dataKey="withoutKeyword" name="Without keyword" fill={WITHOUT_COLOR} radius={[5, 5, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
