import type { HierarchyNode, ProjectMetadata } from '../types';

export interface RawToolCall {
  tool_use_id?: string;
  tool_name?: string;
  name?: string;
  timestamp?: string | number;
  duration_ms?: number;
  is_error?: boolean;
  error?: string;
  error_message?: string;
  input?: Record<string, unknown>;
  input_args?: Record<string, unknown>;
  output?: unknown;
  output_result?: unknown;
  assistant_turn_id?: string;
  assistant_message_id?: string;
  assistant_record_id?: string;
  skill_content?: string;
}

export interface RawContentBlock {
  type?: string;
  id?: string;
  name?: string;
  text?: string;
  thinking?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  tool_use_id?: string;
}

export interface RawCommandInvocation {
  name?: string;
  args?: string;
  message?: string;
}

export interface RawCommandOnlyRecord {
  name?: string;
  args?: string;
  message?: string;
  prompt_id?: string;
  source_event_id?: string;
  timestamp?: string | number;
}

export interface RawLLMCall {
  id?: string;
  message_id?: string;
  source_event_ids?: string[];
  child_records?: RawLLMCall[];
  child_record_count?: number;
  is_assistant_turn?: boolean;
  model?: string;
  start_time?: string | number;
  end_time?: string | number;
  timestamp?: string | number;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  cache_creation_tokens?: number;
  cost_usd?: number;
  prompt?: string;
  response?: string;
  prompt_id?: string;
  command?: RawCommandInvocation;
  attribution_skill?: string;
  attribution_tool_use_id?: string;
  content_blocks?: RawContentBlock[];
}

export interface RawSubagentLog {
  id?: string;
  agent_id?: string;
  agent_type?: string;
  description?: string;
  tool_use_id?: string;
  launch_batch_id?: string;
  launch_timestamp?: string | number;
  launch_order?: number;
  launch_prompt_id?: string;
  launch_user_prompt?: string;
  session_file_path?: string;
  start_time?: string | number;
  end_time?: string | number;
  duration_ms?: number;
  status?: string;
  model?: string;
  prompt?: string;
  response?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  tool_calls?: RawToolCall[];
  llm_calls?: RawLLMCall[];
  meta?: Record<string, unknown>;
}

export interface RawSessionRecord {
  id?: string | number;
  trace_id?: string;
  session_id?: string;
  agent_name?: string;
  platform?: 'claude-code';
  status?: string;
  start_time?: string | number;
  end_time?: string | number;
  last_updated?: string | number;
  created_at?: string | number;
  duration_ms?: number;
  tool_calls?: RawToolCall[];
  llm_calls?: RawLLMCall[];
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  project_path?: string;
  session_file_path?: string;
  prompt?: string;
  response?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

export interface SessionsResponse {
  sessions: RawSessionRecord[];
  count?: number;
  total?: number;
}

export interface ConversationPageResponse {
  session_id: string;
  llm_calls: RawLLMCall[];
  tool_calls: RawToolCall[];
  next_cursor: string | null;
  has_more: boolean;
  total_llm_calls: number;
  total_tool_calls: number;
  source: 'activity-v1' | 'legacy';
}

export type ProjectMetadataResponse = ProjectMetadata;
export interface HierarchyResponse {
  root: HierarchyNode;
}

export interface HierarchyChildrenResponse {
  node_id: string;
  children: HierarchyNode[];
}
