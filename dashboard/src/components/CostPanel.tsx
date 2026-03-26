import React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LineChart,
  Line,
  Area,
  AreaChart,
} from 'recharts';
import { TrendingUp, DollarSign, Coins, BarChart3 } from 'lucide-react';
import { CostMetrics } from '../types';

interface CostPanelProps {
  metrics: CostMetrics[];
  totalCost: number;
  totalTokens: number;
  totalRequests: number;
}

export const CostPanel: React.FC<CostPanelProps> = ({
  metrics,
  totalCost,
  totalTokens,
  totalRequests,
}) => {
  const avgCostPerRequest = totalRequests > 0 ? totalCost / totalRequests : 0;
  const avgCostPer1kTokens = totalTokens > 0 ? (totalCost / totalTokens) * 1000 : 0;

  const statCards = [
    {
      icon: DollarSign,
      label: '总成本',
      value: `$${totalCost.toFixed(2)}`,
      color: '#10b981',
    },
    {
      icon: Coins,
      label: '总 Tokens',
      value: totalTokens.toLocaleString(),
      color: '#3b82f6',
    },
    {
      icon: BarChart3,
      label: '总请求数',
      value: totalRequests.toLocaleString(),
      color: '#8b5cf6',
    },
    {
      icon: TrendingUp,
      label: '平均成本/请求',
      value: `$${avgCostPerRequest.toFixed(4)}`,
      color: '#f59e0b',
    },
  ];

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-6">
        <DollarSign className="w-5 h-5 text-emerald-500" />
        <h2 className="text-lg font-semibold">成本统计</h2>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        {statCards.map((stat, index) => (
          <div
            key={index}
            className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50"
          >
            <div className="flex items-center gap-2 mb-2">
              <stat.icon className="w-4 h-4" style={{ color: stat.color }} />
              <span className="text-sm text-gray-400">{stat.label}</span>
            </div>
            <div className="text-xl font-bold" style={{ color: stat.color }}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {/* Cost Trend Chart */}
      <div className="mb-6">
        <h3 className="text-sm font-medium text-gray-400 mb-3">成本趋势 (7天)</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={metrics}>
              <defs>
                <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="date"
                stroke="#64748b"
                fontSize={12}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
              />
              <YAxis
                stroke="#64748b"
                fontSize={12}
                tickFormatter={(value) => `$${value.toFixed(2)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value: number) => [`$${value.toFixed(4)}`, '成本']}
                labelFormatter={(label) => {
                  const date = new Date(label);
                  return date.toLocaleDateString('zh-CN');
                }}
              />
              <Area
                type="monotone"
                dataKey="cost"
                stroke="#10b981"
                fillOpacity={1}
                fill="url(#costGradient)"
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Token Usage Chart */}
      <div>
        <h3 className="text-sm font-medium text-gray-400 mb-3">Token 使用趋势</h3>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={metrics}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis
                dataKey="date"
                stroke="#64748b"
                fontSize={12}
                tickFormatter={(value) => {
                  const date = new Date(value);
                  return `${date.getMonth() + 1}/${date.getDate()}`;
                }}
              />
              <YAxis
                stroke="#64748b"
                fontSize={12}
                tickFormatter={(value) => `${(value / 1000).toFixed(0)}k`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#1e293b',
                  border: '1px solid #334155',
                  borderRadius: '8px',
                }}
                labelStyle={{ color: '#94a3b8' }}
                formatter={(value: number) => [value.toLocaleString(), 'Tokens']}
                labelFormatter={(label) => {
                  const date = new Date(label);
                  return date.toLocaleDateString('zh-CN');
                }}
              />
              <Bar dataKey="tokens" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Cost Efficiency */}
      <div className="mt-6 p-4 bg-slate-800/50 rounded-lg border border-slate-700/50">
        <h3 className="text-sm font-medium text-gray-400 mb-2">成本效率</h3>
        <div className="flex items-center justify-between">
          <span className="text-sm">每 1K Tokens 成本</span>
          <span className="text-lg font-semibold text-emerald-400">
            ${avgCostPer1kTokens.toFixed(4)}
          </span>
        </div>
        <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
          <div
            className="bg-gradient-to-r from-emerald-500 to-blue-500 h-2 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(avgCostPer1kTokens * 100, 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
};

export default CostPanel;
