export type Platform = 'claude-code';

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

export interface Trace {
  id: string;
  sessionId: string;
  agentId: string;
  agentName: string;
  platform: Platform;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  lastRequestTime: number;
  duration?: number;
  tools: ToolCall[];
  llmCalls: LLMCall[];
  totalTokens: number;
  cost: number;
  projectPath?: string;
  sessionFilePath?: string;
  prompt?: string;
  response?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface OverviewStats {
  period_hours: number;
  total_sessions: number;
  total_traces: number;
  total_llm_calls: number;
  total_tool_calls: number;
  total_tokens: number;
  total_cost: number;
  avg_duration_ms: number;
  platforms: Array<{ platform: Platform; count: number; cost: number }>;
  platform_counts: Record<Platform, number>;
  models: Array<{ model: string; count: number; cost: number }>;
  status_counts: Record<string, number>;
  top_tools: Array<{ name: string; count: number }>;
  active_days: string[];
}

export interface ProjectStats {
  project_path: string;
  session_count: number;
  total_cost: number;
  total_tokens: number;
  avg_duration_ms: number;
  platforms: Record<Platform, number>;
  models: Record<string, number>;
  last_updated?: string;
}

export interface AgentStats {
  agentId: string;
  agentName: string;
  platform: Platform;
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
  platform: Platform;
  status: 'running' | 'completed' | 'failed';
  currentTool?: string;
  progress: number;
  startTime: number;
  estimatedEndTime?: number;
}
