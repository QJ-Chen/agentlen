// Types for AgentLens Dashboard

export interface Trace {
  id: string;
  agentId: string;
  agentName: string;
  platform: 'openclaw' | 'claude-code' | 'kimi-code' | 'cursor';
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  lastRequestTime: number;  // 最后请求时间，用于排序
  duration?: number;
  tools: ToolCall[];
  llmCalls: LLMCall[];
  totalTokens: number;
  cost: number;
  projectPath?: string;  // 工作目录
}

export interface ToolCall {
  id: string;
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: 'success' | 'error' | 'pending';
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

export interface LLMCall {
  id: string;
  model: string;
  startTime: number;
  endTime: number;
  duration: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  status: 'success' | 'error' | 'streaming';
  prompt?: string;
  response?: string;
}

export interface AgentStats {
  agentId: string;
  agentName: string;
  platform: string;
  totalExecutions: number;
  successRate: number;
  avgDuration: number;
  totalTokens: number;
  totalCost: number;
  lastActive: number;
}

export interface CostMetrics {
  date: string;
  cost: number;
  tokens: number;
  requests: number;
}

export interface RealtimeExecution {
  id: string;
  agentName: string;
  platform: string;
  status: 'running' | 'completed' | 'failed';
  currentTool?: string;
  progress: number;
  startTime: number;
  estimatedEndTime?: number;
}
