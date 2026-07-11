import { Bot, ChevronDown, ChevronRight, FileText, User } from 'lucide-react';
import type { LLMCall, SubagentLog, Trace } from '../../types';
import { classifyCallResponse, type DetailLevel } from '../../lib/callClassification';
import { assistantTurnsToPromptThreads, type SubagentLaunchGroup } from '../../lib/conversationModel';
import { cleanSessionText, formatDuration, formatTokenPair, truncateText } from '../../lib/sessionUtils';
import { EmptyState, JsonOrTextBlock, PathField, PreviewBlock, StructuredResponseBlock } from '../TraceDetailBlocks';
import { PromptThreadGroup } from './PromptThreadGroup';
import { formatClockTime, type ReplayMessageKind } from './shared';

function statusLabel(status: Trace['status']): string {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'running':
      return '运行中';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function statusBadgeTone(status: Trace['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-emerald-500/15 text-emerald-300';
    case 'failed':
      return 'bg-red-500/15 text-red-300';
    case 'running':
      return 'bg-amber-500/15 text-amber-300';
    case 'cancelled':
      return 'bg-slate-500/15 text-slate-300';
    default:
      return 'bg-slate-500/15 text-slate-300';
  }
}

export function SubagentsView({
  subagentLogs,
  groupedSubagentLogs,
  allLLMCalls,
  detailLevel,
  expandedLLMs,
  copiedId,
  isKindVisible,
  onToggle,
  onToggleMany,
  onCopy,
  onJumpToLaunchPrompt,
}: {
  subagentLogs: SubagentLog[];
  groupedSubagentLogs: SubagentLaunchGroup[];
  allLLMCalls: LLMCall[];
  detailLevel: DetailLevel;
  expandedLLMs: Set<string>;
  copiedId: string | null;
  isKindVisible: (kind: ReplayMessageKind) => boolean;
  onToggle: (key: string) => void;
  onToggleMany: (keys: string[], expand: boolean) => void;
  onCopy: (text: string, id: string) => void;
  onJumpToLaunchPrompt: (promptId?: string) => void;
}) {
  if (subagentLogs.length === 0 || !isKindVisible('subagent')) {
    return <EmptyState icon={Bot} label="当前筛选条件下无可见 Subagent 日志" />;
  }

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        {groupedSubagentLogs.map((group, groupIdx) => {
          const groupKey = `subagent-batch-${group.batchId}`;
          const isGroupExpanded = expandedLLMs.has(groupKey);
          const totalInputTokens = group.subagents.reduce((sum, item) => sum + item.inputTokens, 0);
          const totalOutputTokens = group.subagents.reduce((sum, item) => sum + item.outputTokens, 0);
          const totalCost = group.subagents.reduce((sum, item) => sum + item.cost, 0);
          const groupFailedCount = group.subagents.filter((item) => item.status === 'failed').length;
          const groupRunningCount = group.subagents.filter((item) => item.status === 'running').length;
          const launchTime = group.launchTimestamp || group.subagents[0]?.startTime || 0;

          return (
            <div
              key={group.batchId}
              className={`overflow-hidden rounded-xl border-l-4 transition-all ${
                isGroupExpanded ? 'border-cyan-300 bg-white shadow-md shadow-cyan-100/35 ring-1 ring-cyan-100' : 'border-slate-200/80 border-l-cyan-200 bg-slate-50/80 hover:border-slate-300 hover:bg-white'
              }`}
            >
              <div className="w-full px-4 py-3.5">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => onToggle(groupKey)}
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-200 bg-cyan-50 text-[11px] font-mono text-cyan-700">
                      {groupIdx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {(() => {
                            const launchPrompt = cleanSessionText(group.subagents[0]?.launchUserPrompt || '').replace(/\n/g, ' ').trim();
                            if (launchPrompt) {
                              return `${launchPrompt.slice(0, 96)}${launchPrompt.length > 96 ? '...' : ''}`;
                            }
                            if (group.subagents.length === 1) {
                              return group.subagents[0]?.description || group.subagents[0]?.agentType || 'Subagent';
                            }
                            return `${group.subagents.length} subagents launched together`;
                          })()}
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
                          {group.subagents.length} subagents
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <span>{formatClockTime(launchTime)}</span>
                        {(totalInputTokens > 0 || totalOutputTokens > 0) && (
                          <>
                            <span>·</span>
                            <span>{formatTokenPair(totalInputTokens, totalOutputTokens)}</span>
                          </>
                        )}
                        <span>·</span>
                        <span>${totalCost.toFixed(4)}</span>
                        {groupRunningCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-amber-600">{groupRunningCount} running</span>
                          </>
                        )}
                        {groupFailedCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-red-600">{groupFailedCount} failed</span>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                  {group.subagents[0]?.launchPromptId && (
                    <button
                      onClick={() => onJumpToLaunchPrompt(group.subagents[0]?.launchPromptId)}
                      className="shrink-0 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300 hover:text-slate-900 shadow-sm"
                    >
                      Go to prompt
                    </button>
                  )}
                  <button
                    onClick={() => onToggle(groupKey)}
                    aria-label={isGroupExpanded ? 'Collapse subagent batch' : 'Expand subagent batch'}
                    className="shrink-0 rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-slate-300 hover:text-slate-900 shadow-sm"
                  >
                    {isGroupExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              {isGroupExpanded && (
                <div className="ml-4 border-l-2 border-cyan-100/80 px-3 py-3 space-y-3 bg-cyan-50/30 rounded-bl-xl">
                  {group.subagents.map((subagent, subagentIdx) => {
                    const subagentKey = `${groupKey}-subagent-${subagent.id}`;
                    const isSubagentExpanded = expandedLLMs.has(subagentKey);
                    const assistantTurns = subagent.assistantTurns || [];
                    const promptThreads = subagent.promptThreads || [];
                    const cleanedPrompt = cleanSessionText(subagent.prompt || '');
                    const hasSubagentMeta = !!subagent.meta && Object.keys(subagent.meta).length > 0;
                    const hasSubagentDetails =
                      hasSubagentMeta ||
                      !!(subagent.sessionFilePath && subagent.sessionFilePath.length > 0) ||
                      !!(subagent.toolUseId && subagent.toolUseId.length > 0);
                    const responseStyle = classifyCallResponse(
                      subagent.llmCalls[subagent.llmCalls.length - 1] || {
                        id: `${subagent.id}-fallback`,
                        model: subagent.model || 'unknown',
                        startTime: subagent.startTime,
                        endTime: subagent.endTime || subagent.startTime,
                        duration: subagent.duration,
                        inputTokens: subagent.inputTokens,
                        outputTokens: subagent.outputTokens,
                        totalTokens: subagent.totalTokens,
                        cost: subagent.cost,
                        status: subagent.response ? 'success' : 'streaming',
                        prompt: subagent.prompt || '',
                        response: subagent.response || '',
                      },
                      subagent.toolCalls,
                    );
                    const statusTone = statusBadgeTone(subagent.status);

                    return (
                      <div key={subagent.id} className={`overflow-hidden rounded-xl border-l-4 transition-all ${isSubagentExpanded ? 'border-violet-300 bg-white shadow-md shadow-violet-100/35 ring-1 ring-violet-100' : 'border-slate-200/80 border-l-violet-200 bg-white/80 hover:border-slate-300 hover:bg-white'}`}>
                        <button onClick={() => onToggle(subagentKey)} className="w-full px-3.5 py-3 text-left">
                          <div className="flex items-center gap-3">
                            <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-violet-200 bg-violet-50 text-[10px] font-mono text-violet-700">
                              {subagentIdx + 1}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700 border border-sky-200">
                                  <Bot className="h-3 w-3" />
                                  subagent
                                </span>
                                <div className="min-w-0 truncate text-sm font-medium text-slate-900">{subagent.description || subagent.agentType || subagent.agentId}</div>
                                <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${statusTone}`}>{statusLabel(subagent.status)}</span>
                              </div>
                              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                                <span>{subagent.agentType || 'unknown'}</span>
                                <span>·</span>
                                <span>{subagent.model || 'unknown'}</span>
                                {subagent.totalTokens > 0 && (
                                  <>
                                    <span>·</span>
                                    <span>{formatTokenPair(subagent.inputTokens, subagent.outputTokens)}</span>
                                  </>
                                )}
                                <span>·</span>
                                <span>{formatDuration(subagent.duration)}</span>
                                <span>·</span>
                                <span>{subagent.toolCalls.length} tools</span>
                                <span>·</span>
                                <span>{subagent.llmCalls.length} LLM</span>
                                {hasSubagentDetails && (
                                  <>
                                    <span>·</span>
                                    <span className="text-sky-700">details below</span>
                                  </>
                                )}
                              </div>
                            </div>
                            <div className="shrink-0 rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 shadow-sm">
                              {isSubagentExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            </div>
                          </div>
                        </button>

                        {isSubagentExpanded && (
                          <div className="ml-5 border-l-2 border-violet-100/80 px-3.5 pb-3 pt-3 space-y-4 bg-violet-50/25 rounded-bl-xl">
                            {hasSubagentDetails && (
                              <div className="rounded-2xl border border-sky-200 bg-sky-50/80 p-3 space-y-2">
                                <div className="flex items-center gap-2 text-xs font-semibold text-sky-700">
                                  <Bot className="h-3.5 w-3.5" />
                                  Subagent details
                                </div>
                                {subagent.sessionFilePath && <PathField label="Log 文件" value={subagent.sessionFilePath} />}
                                {subagent.toolUseId && (
                                  <div className="text-[11px] text-slate-500 font-mono">toolUseId: {subagent.toolUseId}</div>
                                )}
                                {hasSubagentMeta && (
                                  <StructuredResponseBlock
                                    title="Subagent 元数据"
                                    color="emerald"
                                    icon={FileText}
                                    value={subagent.meta || {}}
                                    copyId={`subagent-meta-${subagent.id}`}
                                    copiedId={copiedId}
                                    onCopy={onCopy}
                                  />
                                )}
                              </div>
                            )}
                            {cleanedPrompt && promptThreads.length === 0 && (
                              <PreviewBlock icon={User} label="用户输入" content={truncateText(cleanedPrompt, 800)} />
                            )}
                            {promptThreads.length > 0 ? (
                              <div className="space-y-3">
                                {promptThreads.map((thread, threadIdx) => (
                                  <PromptThreadGroup
                                    key={`subagent-${subagent.id}-thread-${thread.id}`}
                                    thread={thread}
                                    index={threadIdx}
                                    toolScope={subagent.toolCalls}
                                    scopePrefix={`subagent-${subagent.id}`}
                                    allLLMCalls={allLLMCalls}
                                    detailLevel={detailLevel}
                                    expandedLLMs={expandedLLMs}
                                    copiedId={copiedId}
                                    isKindVisible={isKindVisible}
                                    onToggle={onToggle}
                                    onToggleMany={onToggleMany}
                                    onCopy={onCopy}
                                  />
                                ))}
                              </div>
                            ) : assistantTurns.length > 0 ? (
                              <div className="space-y-3">
                                {assistantTurnsToPromptThreads(assistantTurns, `subagent-${subagent.id}`).map((thread, threadIdx) => (
                                  <PromptThreadGroup
                                    key={`subagent-${subagent.id}-thread-${thread.id}`}
                                    thread={thread}
                                    index={threadIdx}
                                    toolScope={subagent.toolCalls}
                                    scopePrefix={`subagent-${subagent.id}`}
                                    allLLMCalls={allLLMCalls}
                                    detailLevel={detailLevel}
                                    expandedLLMs={expandedLLMs}
                                    copiedId={copiedId}
                                    isKindVisible={isKindVisible}
                                    onToggle={onToggle}
                                    onToggleMany={onToggleMany}
                                    onCopy={onCopy}
                                  />
                                ))}
                              </div>
                            ) : subagent.response ? (
                              <JsonOrTextBlock
                                title={responseStyle.label}
                                value={cleanSessionText(subagent.response)}
                                copyId={`subagent-response-${subagent.id}`}
                                copiedId={copiedId}
                                onCopy={onCopy}
                              />
                            ) : null}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
