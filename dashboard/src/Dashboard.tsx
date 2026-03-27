import { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import './Dashboard.css';

// 模拟数据
const mockTraces = [
  { id: '1', platform: 'openclaw', agent: 'main', model: 'claude-3-5', duration: 2500, cost: 0.002, status: 'success', time: '14:01:23' },
  { id: '2', platform: 'claude-code', agent: 'dev', model: 'claude-3-5', duration: 3200, cost: 0.003, status: 'success', time: '14:02:15' },
  { id: '3', platform: 'openclaw', agent: 'main', model: 'gpt-4o', duration: 1800, cost: 0.004, status: 'error', time: '14:03:42' },
  { id: '4', platform: 'kimi-code', agent: 'review', model: 'kimi-k2', duration: 2100, cost: 0.001, status: 'success', time: '14:04:18' },
  { id: '5', platform: 'openclaw', agent: 'main', model: 'claude-3-5', duration: 2900, cost: 0.0025, status: 'success', time: '14:05:33' },
];

const costData = [
  { time: '14:00', cost: 0.012 },
  { time: '14:05', cost: 0.028 },
  { time: '14:10', cost: 0.045 },
  { time: '14:15', cost: 0.058 },
  { time: '14:20', cost: 0.072 },
];

const platformData = [
  { name: 'OpenClaw', value: 45, color: '#0088FE' },
  { name: 'Claude Code', value: 30, color: '#00C49F' },
  { name: 'Kimi Code', value: 15, color: '#FFBB28' },
  { name: 'Cursor', value: 10, color: '#FF8042' },
];

function Dashboard() {
  const [selectedPlatform, setSelectedPlatform] = useState('all');
  const [traces] = useState(mockTraces);

  const stats = {
    totalTraces: 1247,
    totalCost: 12.45,
    totalTokens: 456000,
    avgLatency: 2300,
  };

  return (
    <div className="dashboard">
      <header className="dashboard-header">
        <h1>🔍 AgentLens</h1>
        <p>轻量级 Agent 执行观测平台</p>
      </header>

      {/* 统计卡片 */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.totalTraces.toLocaleString()}</div>
          <div className="stat-label">总执行次数</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">${stats.totalCost.toFixed(2)}</div>
          <div className="stat-label">总成本 (24h)</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{(stats.totalTokens / 1000).toFixed(0)}K</div>
          <div className="stat-label">Token 消耗</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.avgLatency}ms</div>
          <div className="stat-label">平均延迟</div>
        </div>
      </div>

      {/* 图表区域 */}
      <div className="charts-grid">
        <div className="chart-card">
          <h3>💰 成本趋势</h3>
          <ResponsiveContainer width="100%" height={200}>
            <LineChart data={costData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="time" />
              <YAxis />
              <Tooltip />
              <Line type="monotone" dataKey="cost" stroke="#8884d8" />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-card">
          <h3>📊 平台分布</h3>
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
              >
                {platformData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 平台筛选 */}
      <div className="platform-filter">
        <button 
          className={selectedPlatform === 'all' ? 'active' : ''}
          onClick={() => setSelectedPlatform('all')}
        >
          全部
        </button>
        <button 
          className={selectedPlatform === 'openclaw' ? 'active' : ''}
          onClick={() => setSelectedPlatform('openclaw')}
        >
          OpenClaw
        </button>
        <button 
          className={selectedPlatform === 'claude-code' ? 'active' : ''}
          onClick={() => setSelectedPlatform('claude-code')}
        >
          Claude Code
        </button>
        <button 
          className={selectedPlatform === 'kimi-code' ? 'active' : ''}
          onClick={() => setSelectedPlatform('kimi-code')}
        >
          Kimi Code
        </button>
      </div>

      {/* Trace 列表 */}
      <div className="traces-section">
        <h3>📋 最近执行记录</h3>
        <table className="traces-table">
          <thead>
            <tr>
              <th>时间</th>
              <th>平台</th>
              <th>Agent</th>
              <th>模型</th>
              <th>耗时</th>
              <th>成本</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((trace) => (
              <tr key={trace.id}>
                <td>{trace.time}</td>
                <td>
                  <span className={`platform-badge ${trace.platform}`}>
                    {trace.platform}
                  </span>
                </td>
                <td>{trace.agent}</td>
                <td>{trace.model}</td>
                <td>{trace.duration}ms</td>
                <td>${trace.cost.toFixed(4)}</td>
                <td>
                  <span className={`status-badge ${trace.status}`}>
                    {trace.status === 'success' ? '✓' : '✗'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 底部信息 */}
      <footer className="dashboard-footer">
        <p>AgentLens v0.1.0 | 支持 OpenClaw, Claude Code, Kimi Code</p>
      </footer>
    </div>
  );
}

export default Dashboard;
