import { useState, useEffect, useCallback } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import './Dashboard.css';

const API_BASE = 'http://localhost:8080';

const PLATFORM_COLORS: Record<string, string> = {
  'openclaw': '#0088FE',
  'claude-code': '#00C49F',
  'kimi-code': '#FFBB28',
  'cursor': '#FF8042',
};

interface Trace {
  trace_id: string;
  platform: string;
  agent?: string;
  model: string;
  prompt: string;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  started_at: string;
  ended_at?: string;
  status: string;
  error?: string;
  metadata?: Record<string, unknown>;
}

interface Stats {
  total_traces: number;
  total_cost: number;
  total_input_tokens: number;
  total_output_tokens: number;
  platform_counts: Record<string, number>;
}


function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
}

function formatCost(cost: number): string {
  if (cost === 0) return '$0.00';
  if (cost < 0.01) return `$${cost.toFixed(4)}`;
  return `$${cost.toFixed(2)}`;
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return '0';
  if (tokens < 1000) return `${tokens}`;
  if (tokens < 1_000_000) return `${(tokens / 1000).toFixed(1)}K`;
  return `${(tokens / 1_000_000).toFixed(2)}M`;
}

export default function Dashboard() {
  const [traces, setTraces] = useState<Trace[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedPlatform, setSelectedPlatform] = useState('all');

  const fetchData = useCallback(async () => {
    try {
      const [tracesRes, statsRes] = await Promise.all([
        fetch(`${API_BASE}/api/v1/traces?limit=20`),
        fetch(`${API_BASE}/api/v1/stats`),
      ]);

      if (!tracesRes.ok || !statsRes.ok) throw new Error('API request failed');

      const tracesData = await tracesRes.json();
      const statsData = await statsRes.json();

      setTraces(tracesData.traces || []);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, [fetchData]);

  // Compute platform distribution from real data
  const platformCounts = stats?.platform_counts || {};
  const platformData = Object.entries(platformCounts).map(([name, value]) => ({
    name,
    value,
    color: PLATFORM_COLORS[name] || '#888888',
  }));

  // Compute cost trend from traces (group by hour bucket)
  const costByHour: Record<string, number> = {};
  for (const t of traces) {
    if (t.cost_usd > 0) {
      const hour = t.started_at.substring(0, 13); // "2026-04-08T12"
      costByHour[hour] = (costByHour[hour] || 0) + t.cost_usd;
    }
  }
  const costData = Object.entries(costByHour)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-12)
    .map(([time, cost]) => ({
      time: time.substring(11, 16), // "12:00"
      cost: Math.round(cost * 100) / 100,
    }));

  const filteredTraces = selectedPlatform === 'all'
    ? traces
    : traces.filter(t => t.platform === selectedPlatform);

  if (loading) {
    return (
      <div className="dashboard">
        <div className="loading-state">加载中...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard">
        <div className="error-state">⚠️ {error} — 确保 AgentLens API 在 http://localhost:8080 运行</div>
      </div>
    );
  }

  const totalCost = stats?.total_cost || 0;
  const totalInput = stats?.total_input_tokens || 0;
  const totalOutput = stats?.total_output_tokens || 0;
  const totalTokens = totalInput + totalOutput;

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>🔍 AgentLens</h1>
        <p>轻量级 Agent 执行观测平台</p>
      </header>

      {/* 统计卡片 */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{(stats?.total_traces || 0).toLocaleString()}</div>
          <div className="stat-label">总执行次数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${totalCost.toFixed(2)}</div>
          <div className="stat-label">总成本 (USD)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatTokens(totalTokens)}</div>
          <div className="stat-label">Token 消耗</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{formatTokens(totalInput)}</div>
          <div className="stat-label">Input Tokens</div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>💰 成本趋势</h3>
          {costData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={costData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="time" />
                <YAxis />
                <Tooltip formatter={(v: unknown) => `$${Number(v).toFixed(4)}`} />
                <Line type="monotone" dataKey="cost" stroke="#8884d8" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-empty">暂无成本数据</div>
          )}
        </div>

        <div className="chart-card">
          <h3>📊 平台分布</h3>
          {platformData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={platformData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                  label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ''} ${((percent ?? 0) * 100).toFixed(0)}%`}
                >
                  {platformData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="chart-empty">暂无平台数据</div>
          )}
        </div>
      </div>

      {/* 平台筛选 */}
      <div className="platform-filter">
        <button
          className={selectedPlatform === 'all' ? 'active' : ''}
          onClick={() => setSelectedPlatform('all')}
        >
          全部 ({stats?.total_traces || 0})
        </button>
        {Object.entries(platformCounts).map(([platform, count]) => (
          <button
            key={platform}
            className={selectedPlatform === platform ? 'active' : ''}
            onClick={() => setSelectedPlatform(platform)}
          >
            {platform} ({count})
          </button>
        ))}
      </div>

      {/* Trace 列表 */}
      <div className="traces-section">
        <h3>📋 最近执行记录</h3>
        {filteredTraces.length === 0 ? (
          <div className="chart-empty">暂无执行记录</div>
        ) : (
          <table className="traces-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>平台</th>
                <th>模型</th>
                <th>Input</th>
                <th>Output</th>
                <th>成本</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {filteredTraces.map((trace) => (
                <tr key={trace.trace_id}>
                  <td>{formatTime(trace.started_at)}</td>
                  <td>
                    <span className={`platform-badge ${trace.platform}`}>
                      {trace.platform}
                    </span>
                  </td>
                  <td>{trace.model || '—'}</td>
                  <td>{formatTokens(trace.input_tokens)}</td>
                  <td>{formatTokens(trace.output_tokens)}</td>
                  <td className={trace.cost_usd > 0 ? 'cost-positive' : ''}>
                    {formatCost(trace.cost_usd)}
                  </td>
                  <td>
                    <span className={`status-badge ${trace.status === 'success' ? 'success' : 'error'}`}>
                      {trace.status === 'success' ? '✓' : '✗'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 底部信息 */}
      <footer className="dashboard-footer">
        <p>AgentLens v0.1.0 | 支持 OpenClaw, Claude Code, Kimi Code</p>
      </footer>
    </div>
  );
}
