// Mock data for AgentLens Dashboard
import type { Trace, AgentStats, CostMetrics, RealtimeExecution } from '../types';

export const mockRealtimeExecutions: RealtimeExecution[] = [
  {
    id: 'exec-001',
    agentName: 'OpenClaw Main',
    platform: 'openclaw',
    status: 'running',
    currentTool: 'browser.snapshot',
    progress: 65,
    startTime: Date.now() - 30000,
  },
  {
    id: 'exec-002',
    agentName: 'Claude Code',
    platform: 'claude-code',
    status: 'running',
    currentTool: 'Write',
    progress: 30,
    startTime: Date.now() - 15000,
  },
];

export const mockTraces: Trace[] = [
  {
    id: 'trace-001',
    agentId: 'openclaw-1',
    agentName: 'OpenClaw Main',
    platform: 'openclaw',
    status: 'completed',
    startTime: Date.now() - 120000,
    endTime: Date.now() - 60000,
    duration: 60000,
    totalTokens: 15420,
    cost: 0.45,
    tools: [
      { id: 't1', name: 'Read', startTime: 0, endTime: 200, duration: 200, status: 'success' },
      { id: 't2', name: 'Edit', startTime: 250, endTime: 800, duration: 550, status: 'success' },
      { id: 't3', name: 'Browser.Snapshot', startTime: 850, endTime: 2000, duration: 1150, status: 'success' },
      { id: 't4', name: 'Exec', startTime: 2100, endTime: 4500, duration: 2400, status: 'success' },
    ],
    llmCalls: [
      { id: 'llm-1', model: 'claude-3-5-sonnet', startTime: 0, endTime: 2000, duration: 2000, inputTokens: 3200, outputTokens: 890, totalTokens: 4090, cost: 0.12, status: 'success' },
      { id: 'llm-2', model: 'claude-3-5-sonnet', startTime: 4600, endTime: 6000, duration: 1400, inputTokens: 4890, outputTokens: 2340, totalTokens: 7230, cost: 0.21, status: 'success' },
    ],
  },
  {
    id: 'trace-002',
    agentId: 'claude-code-1',
    agentName: 'Claude Code',
    platform: 'claude-code',
    status: 'completed',
    startTime: Date.now() - 300000,
    endTime: Date.now() - 180000,
    duration: 120000,
    totalTokens: 28450,
    cost: 0.82,
    tools: [
      { id: 't1', name: 'Grep', startTime: 0, endTime: 150, duration: 150, status: 'success' },
      { id: 't2', name: 'Read', startTime: 200, endTime: 500, duration: 300, status: 'success' },
      { id: 't3', name: 'Write', startTime: 600, endTime: 3500, duration: 2900, status: 'success' },
    ],
    llmCalls: [
      { id: 'llm-1', model: 'claude-3-5-sonnet', startTime: 0, endTime: 3500, duration: 3500, inputTokens: 5600, outputTokens: 4200, totalTokens: 9800, cost: 0.28, status: 'success' },
      { id: 'llm-2', model: 'claude-3-5-sonnet', startTime: 3600, endTime: 6000, duration: 2400, inputTokens: 9800, outputTokens: 8650, totalTokens: 18450, cost: 0.54, status: 'success' },
    ],
  },
];

export const mockAgentStats: AgentStats[] = [
  {
    agentId: 'openclaw-1',
    agentName: 'OpenClaw Main',
    platform: 'openclaw',
    totalExecutions: 156,
    successRate: 94.2,
    avgDuration: 45200,
    totalTokens: 2456000,
    totalCost: 68.45,
    lastActive: Date.now() - 300000,
  },
  {
    agentId: 'claude-code-1',
    agentName: 'Claude Code',
    platform: 'claude-code',
    totalExecutions: 89,
    successRate: 91.1,
    avgDuration: 78500,
    totalTokens: 4120000,
    totalCost: 124.30,
    lastActive: Date.now() - 600000,
  },
  {
    agentId: 'kimi-code-1',
    agentName: 'Kimi Code',
    platform: 'kimi-code',
    totalExecutions: 45,
    successRate: 88.9,
    avgDuration: 62300,
    totalTokens: 1890000,
    totalCost: 52.15,
    lastActive: Date.now() - 1800000,
  },
];

export const mockCostMetrics: CostMetrics[] = Array.from({ length: 30 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (29 - i));
  return {
    date: date.toISOString().split('T')[0],
    cost: Math.random() * 15 + 5,
    tokens: Math.floor(Math.random() * 500000 + 100000),
    requests: Math.floor(Math.random() * 200 + 50),
  };
});
