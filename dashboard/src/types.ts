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
  assistantTurnId?: string;
  assistantMessageId?: string;
  assistantRecordId?: string;
}

export interface LLMCall {
  id: string;
  messageId?: string;
  sourceEventIds?: string[];
  contentBlocks?: Array<Record<string, unknown>>;
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
  promptId?: string;
}

export interface AssistantTurn {
  id: string;
  messageId?: string;
  prompt?: string;
  promptId?: string;
  startTime: number;
  endTime: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  childRecords: LLMCall[];
  childRecordCount: number;
  sourceEventIds?: string[];
}

export interface PromptThread {
  id: string;
  prompt?: string;
  promptId?: string;
  assistantTurns: AssistantTurn[];
}

export interface SubagentLog {
  id: string;
  agentId: string;
  agentType: string;
  description?: string;
  toolUseId?: string;
  launchBatchId?: string;
  launchTimestamp?: number;
  launchOrder?: number;
  launchPromptId?: string;
  launchUserPrompt?: string;
  sessionFilePath?: string;
  startTime: number;
  endTime?: number;
  duration: number;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  model?: string;
  prompt?: string;
  response?: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cost: number;
  toolCalls: ToolCall[];
  llmCalls: LLMCall[];
  assistantTurns?: AssistantTurn[];
  promptThreads?: PromptThread[];
  meta?: Record<string, unknown>;
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
  createdAt?: number;
  lastRequestTime: number;
  lastUpdatedAt?: number;
  duration?: number;
  tools: ToolCall[];
  llmCalls: LLMCall[];
  assistantTurns?: AssistantTurn[];
  promptThreads?: PromptThread[];
  subagentLogs?: SubagentLog[];
  visionReferences?: VisionReference[];
  totalTokens: number;
  cost: number;
  projectPath?: string;
  projectGroup?: string;
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

export interface ProjectMetadataNote {
  name: string;
  path: string;
  modified_at?: number;
  description?: string;
  preview?: string;
  content?: string;
}

export interface ProjectMetadataWorktree {
  name: string;
  path: string;
  branch?: string;
  has_local_settings: boolean;
  modified_at?: number;
}

export interface ProjectMetadataTaskDirectory {
  session_id: string;
  path: string;
  task_file_count: number;
}

export interface SkillSummary {
  name: string;
  path: string;
  description?: string;
  content?: string;
}

export interface VisionReference {
  path: string;
  absolute_path?: string;
  origin?: 'pasted' | 'attached' | 'unknown';
  message_id?: string;
  event_id?: string;
  timestamp?: string;
  mime_type?: string;
  source_uuid?: string;
  image_paste_ids?: number[];
}

export interface ProjectMetadata {
  identity: {
    project_path: string;
    project_key: string;
    project_dir: string;
  };
  instructions: {
    exists: boolean;
    path: string;
    modified_at?: number;
    preview?: string;
  };
  memory: {
    exists: boolean;
    path: string;
    index_exists: boolean;
    index_path: string;
    index_preview?: string;
    note_count: number;
    notes: ProjectMetadataNote[];
  };
  local_config: {
    exists: boolean;
    path: string;
    modified_at?: number;
    allow_rule_count: number;
    allow_rules_preview: string[];
    content?: string;
  };
  skills: {
    exists: boolean;
    path: string;
    count: number;
    items: SkillSummary[];
  };
  worktrees: {
    exists: boolean;
    path: string;
    count: number;
    items: ProjectMetadataWorktree[];
  };
  session_artifacts: {
    exists: boolean;
    path: string;
    session_count: number;
    subagent_log_count: number;
    subagent_meta_count: number;
    tool_result_count: number;
    recent_sessions: string[];
  };
  task_artifacts: {
    directory_count: number;
    task_file_count: number;
    directories: ProjectMetadataTaskDirectory[];
  };
}

export type HierarchyNodeType =
  | 'global-root'
  | 'global-instruction'
  | 'global-skills'
  | 'global-config'
  | 'projects-root'
  | 'skill'
  | 'project'
  | 'project-instructions'
  | 'project-memory'
  | 'project-config'
  | 'project-skills'
  | 'project-sessions'
  | 'session'
  | 'session-llm'
  | 'session-subagents'
  | 'session-tasks'
  | 'session-vision'
  | 'assistant-turn'
  | 'command'
  | 'thinking'
  | 'text'
  | 'tool-call'
  | 'tool-result'
  | 'subagents'
  | 'subagent';

export interface HierarchyNodeDetailItem {
  label: string;
  description?: string;
  path?: string;
  content?: string;
}

export interface HierarchyNodeDetail {
  kind:
    | 'summary'
    | 'file'
    | 'skills'
    | 'memory'
    | 'session-overview'
    | 'assistant-turn'
    | 'command'
    | 'thinking'
    | 'text'
    | 'tool-call'
    | 'tool-result'
    | 'subagent-overview';
  title?: string;
  description?: string;
  path?: string;
  content?: string;
  prompt?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  status?: string;
  items?: HierarchyNodeDetailItem[];
  meta?: Record<string, unknown>;
}

export interface HierarchyNode {
  id: string;
  type: HierarchyNodeType;
  label: string;
  subtitle?: string;
  count?: number;
  projectPath?: string;
  traceId?: string;
  sessionId?: string;
  assistantTurnId?: string;
  toolCallId?: string;
  subagentId?: string;
  status?: Trace['status'];
  hasChildren?: boolean;
  detail?: HierarchyNodeDetail;
  children?: HierarchyNode[];
}
