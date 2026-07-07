import type { AssistantTurn, SubagentLog, ToolCall, Trace } from '../types';
import type { RawLLMCall, RawSessionRecord, RawSubagentLog } from './sessionApiTypes';
import { buildPromptThreadsFromAssistantTurns } from './conversationModel';

export type TraceWithRaw = Trace & { raw?: RawSessionRecord };

export function normalizeDisplayedTokenUsage(inputTokens?: number, outputTokens?: number) {
  const normalizedInputTokens = Math.max(0, inputTokens || 0);
  const normalizedOutputTokens = Math.max(0, outputTokens || 0);

  if (normalizedInputTokens === 0) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  }

  return {
    inputTokens: normalizedInputTokens,
    outputTokens: normalizedOutputTokens,
    totalTokens: normalizedInputTokens + normalizedOutputTokens,
  };
}

export function normalizeStatus(status: string): Trace['status'] {
  if (status === 'failed' || status === 'error' || status === 'timeout') return 'failed';
  if (status === 'running' || status === 'pending') return 'running';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'completed';
}

export function normalizeSubagentStatus(status: string): SubagentLog['status'] {
  return normalizeStatus(status) as SubagentLog['status'];
}

export function toTimestamp(value?: string | number | null): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function buildMergedTools(record: RawSessionRecord | RawSubagentLog, recordStartTime: number) {
  const merged = new Map<string, ToolCall>();

  (record.tool_calls || []).forEach((tool, idx) => {
    const startTime = toTimestamp(tool.timestamp) ?? recordStartTime;
    const duration = tool.duration_ms || 0;
    const toolId = tool.tool_use_id || `${tool.name || tool.tool_name || 'tool'}-${idx}`;
    const existing = merged.get(toolId);

    if (tool.input || tool.input_args || tool.name || tool.tool_name) {
      const base = existing || {
        id: toolId,
        name: tool.name || tool.tool_name || 'Unknown',
        startTime,
        endTime: startTime + duration,
        duration,
        status: tool.is_error || tool.error ? 'error' as const : 'success' as const,
        input: tool.input || tool.input_args,
        output: tool.output ?? tool.output_result,
        error: tool.error || tool.error_message,
        assistantTurnId: tool.assistant_turn_id,
        assistantMessageId: tool.assistant_message_id,
        assistantRecordId: tool.assistant_record_id,
      };

      base.name = tool.name || tool.tool_name || base.name;
      base.input = tool.input || tool.input_args || base.input;
      base.assistantTurnId = tool.assistant_turn_id || base.assistantTurnId;
      base.assistantMessageId = tool.assistant_message_id || base.assistantMessageId;
      base.assistantRecordId = tool.assistant_record_id || base.assistantRecordId;
      base.startTime = Math.min(base.startTime, startTime);
      base.endTime = Math.max(base.endTime, startTime + duration);
      base.duration = Math.max(base.duration, base.endTime - base.startTime, duration);
      if (tool.is_error || tool.error || tool.error_message) {
        base.status = 'error';
        base.error = tool.error || tool.error_message || base.error;
      }
      if (tool.output !== undefined || tool.output_result !== undefined) {
        base.output = tool.output ?? tool.output_result;
      }
      merged.set(toolId, base);
      return;
    }

    if (existing) {
      existing.output = tool.output ?? tool.output_result;
      if (tool.is_error || tool.error || tool.error_message) {
        existing.status = 'error';
        existing.error = tool.error || tool.error_message || existing.error;
      }
      existing.endTime = Math.max(existing.endTime, startTime + duration);
      existing.duration = Math.max(existing.duration, existing.endTime - existing.startTime, duration);
      return;
    }

    merged.set(toolId, {
      id: toolId,
      name: tool.name || tool.tool_name || 'Unknown',
      startTime,
      endTime: startTime + duration,
      duration,
      status: tool.is_error || tool.error ? 'error' : 'success',
      input: tool.input || tool.input_args,
      output: tool.output ?? tool.output_result,
      error: tool.error || tool.error_message,
      assistantTurnId: tool.assistant_turn_id,
      assistantMessageId: tool.assistant_message_id,
      assistantRecordId: tool.assistant_record_id,
    });
  });

  return Array.from(merged.values()).sort((a, b) => a.startTime - b.startTime);
}

function normalizeChildLLMCall(
  child: RawLLMCall,
  fallbackCall: RawLLMCall,
  fallbackModel: string,
  fallbackStartTime: number,
  fallbackId: string,
) {
  const startTime = toTimestamp(child.start_time || child.timestamp) ?? fallbackStartTime;
  const endTime = toTimestamp(child.end_time) ?? startTime + (child.duration_ms || 0);
  const duration = child.duration_ms || Math.max(0, endTime - startTime);
  const { inputTokens, outputTokens, totalTokens } = normalizeDisplayedTokenUsage(
    child.input_tokens,
    child.output_tokens,
  );

  return {
    id: child.id || fallbackId,
    messageId: child.message_id || '',
    sourceEventIds: Array.isArray(child.source_event_ids)
      ? child.source_event_ids.filter((item): item is string => typeof item === 'string')
      : [],
    contentBlocks: Array.isArray(child.content_blocks)
      ? child.content_blocks.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
      : [],
    model: child.model || fallbackCall.model || fallbackModel,
    startTime,
    endTime,
    duration,
    inputTokens,
    outputTokens,
    totalTokens,
    cost: child.cost_usd || 0,
    status: child.response ? 'success' : 'streaming',
    prompt: child.prompt || fallbackCall.prompt || '',
    response: child.response || '',
    promptId: child.prompt_id || fallbackCall.prompt_id || '',
  } as const;
}

export function buildLLMCalls(record: RawSessionRecord | RawSubagentLog, recordStartTime: number) {
  return (record.llm_calls || []).flatMap((call, idx) => {
    if (call.is_assistant_turn && Array.isArray(call.child_records)) {
      return call.child_records.map((child, childIdx) =>
        normalizeChildLLMCall(
          child,
          call,
          record.model || 'unknown',
          recordStartTime,
          `${call.id || call.message_id || `llm-${idx}`}-child-${childIdx}`,
        ),
      );
    }

    const startTime = toTimestamp(call.start_time || call.timestamp) ?? recordStartTime;
    const endTime = toTimestamp(call.end_time) ?? startTime + (call.duration_ms || 0);
    const duration = call.duration_ms || Math.max(0, endTime - startTime);
    const { inputTokens, outputTokens, totalTokens } = normalizeDisplayedTokenUsage(
      call.input_tokens,
      call.output_tokens,
    );
    return [{
      id: call.id || call.message_id || `llm-${idx}`,
      messageId: call.message_id || '',
      sourceEventIds: Array.isArray(call.source_event_ids)
        ? call.source_event_ids.filter((item): item is string => typeof item === 'string')
        : [],
      contentBlocks: Array.isArray(call.content_blocks)
        ? call.content_blocks.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
        : [],
      model: call.model || record.model || 'unknown',
      startTime,
      endTime,
      duration,
      inputTokens,
      outputTokens,
      totalTokens,
      cost: call.cost_usd || 0,
      status: call.response ? 'success' : 'streaming',
      prompt: call.prompt || '',
      response: call.response || '',
      promptId: call.prompt_id || '',
    } as const];
  });
}

export function buildAssistantTurns(record: RawSessionRecord | RawSubagentLog, recordStartTime: number): AssistantTurn[] {
  return (record.llm_calls || []).flatMap((call, idx) => {
    if (!call.is_assistant_turn || !Array.isArray(call.child_records)) {
      return [];
    }
    const startTime = toTimestamp(call.start_time || call.timestamp) ?? recordStartTime;
    const endTime = toTimestamp(call.end_time) ?? startTime + (call.duration_ms || 0);
    const { inputTokens, outputTokens } = normalizeDisplayedTokenUsage(
      call.input_tokens,
      call.output_tokens,
    );
    const childRecords = call.child_records.map((child, childIdx) =>
      normalizeChildLLMCall(
        child,
        call,
        record.model || 'unknown',
        startTime,
        `${call.id || call.message_id || `turn-${idx}`}-child-${childIdx}`,
      ),
    );

    return [{
      id: call.id || call.message_id || `turn-${idx}`,
      messageId: call.message_id || '',
      prompt: call.prompt || '',
      promptId: call.prompt_id || '',
      startTime,
      endTime,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost: call.cost_usd || 0,
      childRecords,
      childRecordCount: call.child_record_count || childRecords.length,
      sourceEventIds: Array.isArray(call.source_event_ids)
        ? call.source_event_ids.filter((item): item is string => typeof item === 'string')
        : [],
    } satisfies AssistantTurn];
  });
}

export function normalizeSubagentLog(subagent: RawSubagentLog): SubagentLog {
  const startTime = toTimestamp(subagent.start_time) ?? 0;
  const endTime = toTimestamp(subagent.end_time);
  const duration = subagent.duration_ms || (endTime ? Math.max(0, endTime - startTime) : 0);
  const toolCalls = buildMergedTools(subagent, startTime);
  const llmCalls = buildLLMCalls(subagent, startTime);
  const assistantTurns = buildAssistantTurns(subagent, startTime);
  const promptThreads = buildPromptThreadsFromAssistantTurns(assistantTurns);
  const normalizedSubagentUsage = normalizeDisplayedTokenUsage(
    subagent.input_tokens,
    subagent.output_tokens,
  );
  const assistantTurnInputTokens = assistantTurns.reduce((sum, turn) => sum + turn.inputTokens, 0);
  const assistantTurnOutputTokens = assistantTurns.reduce((sum, turn) => sum + turn.outputTokens, 0);
  const hasAssistantTurnUsage = assistantTurnInputTokens > 0 || assistantTurnOutputTokens > 0;

  return {
    id: subagent.id || subagent.agent_id || `subagent-${startTime}`,
    agentId: subagent.agent_id || subagent.id || 'unknown',
    agentType: subagent.agent_type || 'unknown',
    description: subagent.description || '',
    toolUseId: subagent.tool_use_id || '',
    launchBatchId: subagent.launch_batch_id || subagent.tool_use_id || '',
    launchTimestamp: toTimestamp(subagent.launch_timestamp),
    launchOrder: subagent.launch_order,
    launchPromptId: subagent.launch_prompt_id || '',
    launchUserPrompt: subagent.launch_user_prompt || '',
    sessionFilePath: subagent.session_file_path || '',
    startTime,
    endTime,
    duration,
    status: normalizeSubagentStatus(subagent.status || (endTime ? 'completed' : 'running')),
    model: subagent.model || 'unknown',
    prompt: subagent.prompt || '',
    response: subagent.response || '',
    inputTokens: hasAssistantTurnUsage ? assistantTurnInputTokens : normalizedSubagentUsage.inputTokens,
    outputTokens: hasAssistantTurnUsage ? assistantTurnOutputTokens : normalizedSubagentUsage.outputTokens,
    totalTokens: hasAssistantTurnUsage
      ? assistantTurnInputTokens + assistantTurnOutputTokens
      : normalizedSubagentUsage.totalTokens,
    cost: subagent.cost_usd || 0,
    toolCalls,
    llmCalls,
    assistantTurns,
    promptThreads,
    meta: subagent.meta || {},
  };
}

export function transformSession(record: RawSessionRecord): TraceWithRaw {
  const recordStartTime = toTimestamp(record.start_time) ?? 0;

  const tools = buildMergedTools(record, recordStartTime);
  const llmCalls = buildLLMCalls(record, recordStartTime);
  const assistantTurns = buildAssistantTurns(record, recordStartTime);
  const promptThreads = buildPromptThreadsFromAssistantTurns(assistantTurns);
  const rawSubagentLogs = Array.isArray(record.metadata?.subagent_logs)
    ? (record.metadata?.subagent_logs as RawSubagentLog[])
    : [];
  const subagentLogs = rawSubagentLogs.map(normalizeSubagentLog);
  const visionReferences = Array.isArray(record.metadata?.vision_references)
    ? (record.metadata?.vision_references as Trace['visionReferences'])
    : [];

  const startTime = recordStartTime || Date.now();
  const endTime = toTimestamp(record.end_time);
  const rawCreatedAt = toTimestamp(record.created_at);
  const rawLastUpdatedAt = toTimestamp(record.last_updated);
  const activityTime =
    Math.max(
      startTime,
      endTime || 0,
      rawLastUpdatedAt || 0,
      ...tools.map((tool) => tool.endTime || tool.startTime),
      ...llmCalls.map((call) => call.endTime || call.startTime),
    ) || startTime;
  const createdAt = Math.min(...[rawCreatedAt, startTime].filter((value): value is number => typeof value === 'number' && value > 0));
  const lastRequestTime = activityTime;
  const lastUpdatedAt = Math.max(createdAt, activityTime);

  return {
    id: record.trace_id || record.session_id || String(record.id || startTime),
    sessionId: record.session_id || record.trace_id || String(record.id || startTime),
    agentId: record.agent_name || record.platform || 'claude-code',
    agentName: record.agent_name || 'claude-code',
    platform: record.platform || 'claude-code',
    status: normalizeStatus(record.status || 'completed'),
    startTime,
    endTime,
    createdAt,
    lastRequestTime,
    lastUpdatedAt,
    duration: record.duration_ms || 0,
    tools,
    llmCalls,
    assistantTurns,
    promptThreads,
    subagentLogs,
    visionReferences,
    totalTokens: record.total_tokens || (record.input_tokens || 0) + (record.output_tokens || 0),
    cost: record.cost_usd || 0,
    projectPath: record.project_path || '',
    projectGroup: typeof record.metadata?.project_group === 'string' ? (record.metadata.project_group || record.project_path || '') : (record.project_path || ''),
    sessionFilePath: record.session_file_path || '',
    prompt: record.prompt || '',
    response: record.response || '',
    model: record.model || 'unknown',
    metadata: record.metadata || {},
    raw: record,
  };
}
