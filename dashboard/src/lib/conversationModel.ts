import type { AssistantTurn, CommandOnlyRecord, LLMCall, PromptThread, SubagentLog } from '../types';

export interface SubagentLaunchGroup {
  batchId: string;
  launchTimestamp?: number;
  subagents: SubagentLog[];
}

export interface LLMCallPromptGroup {
  key: string;
  prompt: string;
  promptId?: string;
  calls: LLMCall[];
}

export function groupSubagentLaunches(subagentLogs: SubagentLog[]): SubagentLaunchGroup[] {
  const groups = new Map<string, SubagentLaunchGroup>();

  for (const subagent of subagentLogs) {
    const batchId = subagent.launchBatchId || subagent.toolUseId || subagent.id;
    const existing = groups.get(batchId);
    if (existing) {
      existing.subagents.push(subagent);
      if (subagent.launchTimestamp && (!existing.launchTimestamp || subagent.launchTimestamp < existing.launchTimestamp)) {
        existing.launchTimestamp = subagent.launchTimestamp;
      }
    } else {
      groups.set(batchId, {
        batchId,
        launchTimestamp: subagent.launchTimestamp,
        subagents: [subagent],
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      subagents: [...group.subagents].sort((a, b) => {
        const orderA = a.launchOrder ?? Number.MAX_SAFE_INTEGER;
        const orderB = b.launchOrder ?? Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        return (a.startTime || 0) - (b.startTime || 0);
      }),
    }))
    .sort((a, b) => (a.launchTimestamp || a.subagents[0]?.startTime || 0) - (b.launchTimestamp || b.subagents[0]?.startTime || 0));
}

export function groupLLMCallsByPrompt(calls: LLMCall[]): LLMCallPromptGroup[] {
  const groups: LLMCallPromptGroup[] = [];
  let currentGroup: LLMCallPromptGroup | null = null;

  for (let index = 0; index < calls.length; index += 1) {
    const call = calls[index];
    const promptId = call.promptId || '';
    const groupKey = promptId || `group-${index}`;
    if (
      !currentGroup ||
      (promptId && currentGroup.promptId !== promptId) ||
      (!promptId && currentGroup.prompt !== (call.prompt || ''))
    ) {
      currentGroup = { key: groupKey, prompt: call.prompt || '', promptId, calls: [], command: undefined } as LLMCallPromptGroup & { command?: AssistantTurn['command'] };
      groups.push(currentGroup);
    }
    currentGroup.calls.push(call);
  }

  return groups;
}

export function buildPromptThreadsFromAssistantTurns(
  assistantTurns: AssistantTurn[],
  commandOnlyRecords: CommandOnlyRecord[] = [],
): PromptThread[] {
  const threads: PromptThread[] = [];
  let currentThread: PromptThread | null = null;

  for (let index = 0; index < assistantTurns.length; index += 1) {
    const turn = assistantTurns[index];
    const promptId = turn.promptId || '';
    const prompt = turn.prompt || '';
    const threadKey = promptId || `prompt-thread-${index}`;

    if (
      !currentThread ||
      (promptId && currentThread.promptId !== promptId) ||
      (!promptId && currentThread.prompt !== prompt)
    ) {
      currentThread = {
        id: threadKey,
        prompt,
        promptId,
        command: turn.command,
        commandOnlyRecords: [],
        assistantTurns: [],
      };
      threads.push(currentThread);
    }

    currentThread.assistantTurns.push(turn);
  }

  attachCommandOnlyRecordsToThreads(threads, commandOnlyRecords);
  threads.sort((a, b) => threadStartTime(a) - threadStartTime(b));
  return threads;
}

function attachCommandOnlyRecordsToThreads(
  threads: PromptThread[],
  commandOnlyRecords: CommandOnlyRecord[],
): void {
  if (!commandOnlyRecords.length) return;

  // Slash commands are independent user actions, not attachments to a text
  // prompt. Give each command-only record its own row in the prompt-thread
  // list so /model, /compact, /recap, etc. are first-class entries.
  const sortedCommands = [...commandOnlyRecords].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
  sortedCommands.forEach((command, index) => {
    threads.push({
      id: `command-only-${command.sourceEventId || `standalone-${index}`}`,
      prompt: '',
      promptId: '',
      command: { name: command.name, args: command.args, message: command.message },
      commandOnlyRecords: [command],
      assistantTurns: [],
    });
  });
}

function threadStartTime(thread: PromptThread): number {
  const firstTurn = thread.assistantTurns[0];
  if (firstTurn?.startTime) return firstTurn.startTime;
  if (thread.commandOnlyRecords?.length) {
    return Math.min(...thread.commandOnlyRecords.map((c) => c.timestamp || 0));
  }
  return Number.MAX_SAFE_INTEGER;
}

export function assistantTurnsToPromptThreads(
  assistantTurns: AssistantTurn[],
  idPrefix: string,
): PromptThread[] {
  return assistantTurns.map((turn, index) => ({
    id: turn.messageId || turn.id || `${idPrefix}-thread-${index}`,
    prompt: turn.prompt || '',
    promptId: turn.promptId || '',
    command: turn.command,
    assistantTurns: [turn],
  }));
}

export function groupedLLMCallsToPromptThreads(groups: LLMCallPromptGroup[]): PromptThread[] {
  return groups.map((group, index) => ({
    id: group.promptId || group.key || `prompt-thread-${index}`,
    prompt: group.prompt,
    promptId: group.promptId || '',
    assistantTurns: [{
      id: group.promptId || group.key || `assistant-turn-${index}`,
      messageId: '',
      prompt: group.prompt,
      promptId: group.promptId || '',
      startTime: group.calls[0]?.startTime || 0,
      endTime: group.calls[group.calls.length - 1]?.endTime || group.calls[group.calls.length - 1]?.startTime || 0,
      inputTokens: group.calls.reduce((sum, call) => sum + call.inputTokens, 0),
      outputTokens: group.calls.reduce((sum, call) => sum + call.outputTokens, 0),
      totalTokens: group.calls.reduce((sum, call) => sum + call.totalTokens, 0),
      cost: group.calls.reduce((sum, call) => sum + call.cost, 0),
      childRecords: group.calls,
      childRecordCount: group.calls.length,
      sourceEventIds: group.calls.flatMap((call) => call.sourceEventIds || []),
    }],
  }));
}

export function deriveRenderablePromptThreads({
  promptThreads,
  assistantTurns,
  llmCalls,
  assistantTurnIdPrefix,
}: {
  promptThreads?: PromptThread[];
  assistantTurns?: AssistantTurn[];
  llmCalls?: LLMCall[];
  assistantTurnIdPrefix: string;
}): PromptThread[] {
  if (promptThreads && promptThreads.length > 0) {
    return promptThreads;
  }

  if (assistantTurns && assistantTurns.length > 0) {
    return assistantTurnsToPromptThreads(assistantTurns, assistantTurnIdPrefix);
  }

  return groupedLLMCallsToPromptThreads(groupLLMCallsByPrompt(llmCalls || []));
}
