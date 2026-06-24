import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  Bot,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Copy,
  DollarSign,
  ExternalLink,
  FileText,
  Hash,
  Layers,
  MessageSquare,
  Sparkles,
  User,
  Wrench,
  X as XIcon,
} from 'lucide-react';
import type { LLMCall, PromptThread, ToolCall, Trace } from '../types';
import {
  assistantTurnsToPromptThreads,
  deriveRenderablePromptThreads,
  groupSubagentLaunches,
} from '../lib/conversationModel';
import { cleanSessionText, formatDuration, formatTokenPair, truncateText } from '../lib/sessionUtils';
import {
  EmptyState,
  InfoField,
  JsonOrTextBlock,
  MetricCard,
  PathField,
  PreviewBlock,
  StructuredResponseBlock,
  SummaryList,
} from './TraceDetailBlocks';

interface EnhancedTraceDetailProps {
  trace: Trace;
}

type TabType = 'overview' | 'llm' | 'subagents' | 'taskStatus' | 'raw';
type TraceWithRaw = Trace & { raw?: Record<string, unknown> };

const PLATFORM_CONFIG = {
  'claude-code': { name: 'Claude Code', color: 'text-orange-400', bg: 'bg-orange-500/20' },
} as const;

export const EnhancedTraceDetail: React.FC<EnhancedTraceDetailProps> = ({ trace }) => {
  const typedTrace = trace as TraceWithRaw;
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [expandedLLMs, setExpandedLLMs] = useState<Set<string>>(new Set(['group-0']));
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openingTarget, setOpeningTarget] = useState<'project' | 'session_folder' | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [pendingLaunchPromptId, setPendingLaunchPromptId] = useState<string | null>(null);
  const llmGroupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const openPath = async (target: 'project' | 'session_folder') => {
    setOpeningTarget(target);
    setOpenError(null);
    try {
      const response = await fetch(`http://localhost:8080/api/v1/sessions/${trace.sessionId}/open?target=${target}`, {
        method: 'POST',
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || 'Failed to open path');
      }
    } catch (error) {
      setOpenError(error instanceof Error ? error.message : 'Failed to open path');
    } finally {
      setOpeningTarget(null);
    }
  };

  const allTools = useMemo(() => trace.tools || [], [trace.tools]);
  const allLLMCalls = useMemo(() => trace.llmCalls || [], [trace.llmCalls]);
  const assistantTurns = useMemo(() => trace.assistantTurns || [], [trace.assistantTurns]);
  const promptThreads = useMemo(() => trace.promptThreads || [], [trace.promptThreads]);
  const subagentLogs = useMemo(() => trace.subagentLogs || [], [trace.subagentLogs]);

  const groupedSubagentLogs = useMemo(() => groupSubagentLaunches(subagentLogs), [subagentLogs]);

  const assistantTurnGroups = useMemo(
    () =>
      deriveRenderablePromptThreads({
        promptThreads,
        assistantTurns,
        llmCalls: allLLMCalls,
        assistantTurnIdPrefix: 'prompt-thread',
      }),
    [promptThreads, assistantTurns, allLLMCalls],
  );

  const getRelatedToolCalls = (call: LLMCall, toolScope: ToolCall[] = trace.tools || []): ToolCall[] => {
    if (!toolScope || !call.startTime) return [];
    const byRecordId = toolScope.filter((tool) => tool.assistantRecordId && tool.assistantRecordId === call.id);
    if (byRecordId.length > 0) {
      return byRecordId;
    }
    const byMessageId = toolScope.filter((tool) => tool.assistantMessageId && tool.assistantMessageId === call.messageId);
    if (byMessageId.length > 0) {
      return byMessageId;
    }
    const callIndex = allLLMCalls.findIndex((candidate) => candidate.id === call.id);
    const nextCall = allLLMCalls[callIndex + 1];

    return toolScope.filter((tool) => {
      if (!tool.startTime) return false;
      const afterThisCall = tool.startTime >= call.startTime;
      const beforeNextCall = !nextCall || tool.startTime < nextCall.startTime;
      return afterThisCall && beforeNextCall;
    });
  };

  const classifyCallResponse = (call: LLMCall, relatedTools: ToolCall[]) => {
    const response = cleanSessionText(call.response || '');
    if (!response) {
      return {
        kind: 'empty' as const,
        label: '无响应',
        icon: Clock,
        accent: 'text-slate-400',
        badge: 'bg-slate-500/15 text-slate-300',
        preview: '无响应内容',
      };
    }
    if (response.startsWith('[thinking]')) {
      return {
        kind: 'thinking' as const,
        label: '思考',
        icon: Sparkles,
        accent: 'text-amber-300',
        badge: 'bg-amber-500/15 text-amber-300',
        preview: response.replace(/^\[thinking\]\s*/, ''),
      };
    }
    const toolResponseMatch = response.match(/^\[([^\]]+)\]\s*/);
    if (toolResponseMatch) {
      return {
        kind: 'tool' as const,
        label: '工具调用',
        icon: Wrench,
        accent: 'text-violet-300',
        badge: 'bg-violet-500/15 text-violet-300',
        preview:
          relatedTools.length > 0
            ? relatedTools.map((tool) => tool.name).join(' · ')
            : toolResponseMatch[1],
      };
    }
    return {
      kind: 'text' as const,
      label: '文本响应',
      icon: MessageSquare,
      accent: 'text-cyan-300',
      badge: 'bg-cyan-500/15 text-cyan-300',
      preview: response,
    };
  };

  const toggleLLM = (key: string) => {
    const newSet = new Set(expandedLLMs);
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
    setExpandedLLMs(newSet);
  };

  useEffect(() => {
    if (activeTab !== 'llm' || !pendingLaunchPromptId) {
      return;
    }
    const target = llmGroupRefs.current[pendingLaunchPromptId];
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setPendingLaunchPromptId(null);
  }, [activeTab, pendingLaunchPromptId, assistantTurnGroups]);

  const jumpToLaunchPrompt = (promptId?: string) => {
    if (!promptId) return;
    setExpandedLLMs((current) => {
      const next = new Set(current);
      next.add(promptId);
      return next;
    });
    setPendingLaunchPromptId(promptId);
    setActiveTab('llm');
  };

  const tabs = [
    { id: 'overview', label: '概览', icon: Activity },
    { id: 'llm', label: `LLM (${assistantTurnGroups.length}组)`, icon: MessageSquare },
    { id: 'subagents', label: `Subagents (${subagentLogs.length})`, icon: Bot },
    { id: 'taskStatus', label: '任务状态', icon: Layers },
    { id: 'raw', label: '原始', icon: Code },
  ] as const;

  const renderOverview = () => {
    const rawTrace = typedTrace.raw || {};
    const rawPrompt = typeof rawTrace.prompt === 'string' ? rawTrace.prompt : '';
    const rawResponse = typeof rawTrace.response === 'string' ? rawTrace.response : '';
    const cleanedPrompt = cleanSessionText(rawPrompt || trace.prompt || '');
    const cleanedResponse = cleanSessionText(rawResponse || trace.response || '');
    const platformConfig = PLATFORM_CONFIG[trace.platform];
    const rawModels = typedTrace.metadata?.models;
    const models = Array.isArray(rawModels) ? rawModels.filter((item): item is string => typeof item === 'string') : [];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard icon={Clock} color="text-blue-400" value={formatDuration(trace.duration)} label="会话时长" />
          <MetricCard icon={Wrench} color="text-violet-400" value={String(allTools.length)} label="工具调用" />
          <MetricCard icon={Hash} color="text-cyan-400" value={trace.totalTokens.toLocaleString()} label="总 Tokens" />
          <MetricCard icon={DollarSign} color="text-emerald-400" value={`$${trace.cost.toFixed(4)}`} label="总成本" />
        </div>

        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <Box className="w-4 h-4" />
            Session 信息
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <InfoField label="Agent" value={trace.agentName} />
            <div>
              <span className="text-gray-500 block text-xs mb-1">平台</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${platformConfig.bg} ${platformConfig.color}`}>
                {platformConfig.name}
              </span>
            </div>
            <InfoField label="状态" value={statusLabel(trace.status)} />
            <InfoField label="开始时间" value={formatTime(trace.startTime)} />
            <InfoField label="模型" value={trace.model || models.join(', ') || 'unknown'} />
            <InfoField label="Session ID" value={trace.sessionId} mono />
          </div>
          {trace.projectPath && <PathField label="项目路径" value={trace.projectPath} actionLabel="Open project" actionIcon={ExternalLink} actionPending={openingTarget === 'project'} onAction={() => void openPath('project')} />}
          {trace.sessionFilePath && <PathField label="Session 文件" value={trace.sessionFilePath} actionLabel="Open folder" actionIcon={ExternalLink} actionPending={openingTarget === 'session_folder'} onAction={() => void openPath('session_folder')} />}
          {openError && <div className="mt-3 text-xs text-red-300 bg-red-950/30 border border-red-900/30 rounded px-3 py-2">{openError}</div>}
        </div>

        {(cleanedPrompt || cleanedResponse) && (
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Session 预览
            </h3>
            <div className="space-y-3">
              {cleanedPrompt && <PreviewBlock icon={User} label="用户输入" content={truncateText(cleanedPrompt, 600)} />}
              {cleanedResponse && <PreviewBlock icon={Bot} label="助手输出" content={truncateText(cleanedResponse, 600)} />}
            </div>
          </div>
        )}

        {(allTools.length > 0 || allLLMCalls.length > 0) && (
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4" />
              会话摘要
            </h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <SummaryList
                title={`LLM 调用 (${allLLMCalls.length})`}
                color="text-cyan-400"
                rows={allLLMCalls.slice(0, 5).map((call) => ({
                  label: call.model,
                  meta: formatTokenPair(call.inputTokens, call.outputTokens),
                }))}
              />
              <SummaryList
                title={`工具调用 (${allTools.length})`}
                color="text-violet-400"
                rows={allTools.slice(0, 5).map((tool) => ({
                  label: tool.name,
                  meta: formatDuration(tool.duration),
                }))}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderPromptThreadGroup = ({
    thread,
    index,
    toolScope,
    scopePrefix,
    jumpable = false,
  }: {
    thread: PromptThread;
    index: number;
    toolScope: ToolCall[];
    scopePrefix: string;
    jumpable?: boolean;
  }) => {
    const threadKey = `${scopePrefix}-thread-${thread.id}`;
    const isThreadExpanded = expandedLLMs.has(threadKey);
    const cleanedPrompt = cleanSessionText(thread.prompt || '');
    const promptPreview = cleanedPrompt
      ? `${cleanedPrompt.replace(/\n/g, ' ').slice(0, 80)}${cleanedPrompt.length > 80 ? '...' : ''}`
      : '无提示词';
    const threadInputTokens = thread.assistantTurns.reduce((sum, turn) => sum + turn.inputTokens, 0);
    const threadOutputTokens = thread.assistantTurns.reduce((sum, turn) => sum + turn.outputTokens, 0);
    const assistantTurnCount = thread.assistantTurns.length;

    const renderChildRecord = ({
      call,
      callIdx,
      parentKey,
      showTokenUsage = true,
    }: {
      call: LLMCall;
      callIdx: number;
      parentKey: string;
      showTokenUsage?: boolean;
    }) => {
      const callKey = `${parentKey}-call-${callIdx}`;
      const isCallExpanded = expandedLLMs.has(callKey);
      const relatedTools = getRelatedToolCalls(call, toolScope);
      const responseStyle = classifyCallResponse(call, relatedTools);
      const formattedToolResponse =
        responseStyle.kind === 'tool'
          ? relatedTools.map((tool) => ({
              name: tool.name,
              input: tool.input,
            }))
          : null;
      const toolResultAppendix =
        formattedToolResponse && relatedTools.some((tool) => tool.output != null || tool.error)
          ? relatedTools.map((tool) => ({
              name: tool.name,
              result: tool.output,
              error: tool.error,
            }))
          : null;

      return (
        <div key={callKey} className={`rounded border ${isCallExpanded ? 'bg-slate-800/70 border-slate-600' : 'bg-slate-800/40 border-slate-700/50'}`}>
          <button onClick={() => toggleLLM(callKey)} className="w-full px-3 py-2 flex items-center gap-2 text-left">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center ${responseStyle.badge}`}>
              <responseStyle.icon className={`w-3.5 h-3.5 ${responseStyle.accent}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[11px] px-1.5 py-0.5 rounded ${responseStyle.badge}`}>{responseStyle.label}</span>
                <div className={`text-sm truncate ${responseStyle.accent}`}>
                  {responseStyle.preview
                    ? `${responseStyle.preview.replace(/\n/g, ' ').slice(0, 60)}${responseStyle.preview.length > 60 ? '...' : ''}`
                    : '无响应内容'}
                </div>
              </div>
              <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2 flex-wrap">
                <span>{call.model}</span>
                {showTokenUsage && call.totalTokens > 0 && (
                  <>
                    <span>·</span>
                    <span>{formatTokenPair(call.inputTokens, call.outputTokens)}</span>
                  </>
                )}
                <span>·</span>
                <span>{formatDuration(call.duration)}</span>
                {call.sourceEventIds && call.sourceEventIds[0] && (
                  <>
                    <span>·</span>
                    <span className="font-mono">event {call.sourceEventIds[0]}</span>
                  </>
                )}
              </div>
            </div>
            {isCallExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
          </button>

          {isCallExpanded && (
            <div className="px-3 pb-3 border-t border-slate-700/50 space-y-3">
              {call.response && !formattedToolResponse && (
                <JsonOrTextBlock
                  title={responseStyle.label}
                  value={
                    responseStyle.kind === 'thinking'
                      ? cleanSessionText(call.response).replace(/^\[thinking\]\s*/, '')
                      : cleanSessionText(call.response)
                  }
                  copyId={`llm-response-${callKey}`}
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                />
              )}
              {formattedToolResponse && (
                <StructuredResponseBlock
                  title="工具调用"
                  color="violet"
                  icon={Wrench}
                  value={formattedToolResponse}
                  copyId={`llm-tool-calls-${callKey}`}
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                />
              )}
              {toolResultAppendix && (
                <StructuredResponseBlock
                  title="工具结果"
                  color="emerald"
                  icon={FileText}
                  value={toolResultAppendix}
                  copyId={`llm-tool-results-${callKey}`}
                  copiedId={copiedId}
                  onCopy={copyToClipboard}
                />
              )}
              {relatedTools.length > 0 && !formattedToolResponse && (
                <div>
                  <div className="text-xs font-medium text-violet-400 mb-2">相关工具调用</div>
                  <div className="space-y-2">
                    {relatedTools.map((tool) => (
                      <div key={`${callKey}-${tool.id}`} className="rounded bg-slate-900/40 border border-slate-800 p-2 text-xs text-gray-300">
                        <div className="font-medium text-violet-300">{tool.name}</div>
                        {tool.input && <pre className="mt-1 whitespace-pre-wrap text-gray-400">{JSON.stringify(tool.input, null, 2)}</pre>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      );
    };

    return (
      <div
        key={threadKey}
        ref={(node) => {
          if (jumpable) {
            llmGroupRefs.current[thread.promptId || thread.id] = node;
          }
        }}
        className={`rounded-lg border transition-all ${
          isThreadExpanded ? 'bg-slate-800/50 border-slate-600' : 'bg-slate-800/30 border-slate-700/50'
        }`}
      >
        <button onClick={() => toggleLLM(threadKey)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
          <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
            <span className="text-xs text-cyan-400 font-mono">{index + 1}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm text-gray-200 truncate">{promptPreview}</div>
            <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
              <span>{assistantTurnCount} 个 assistant turn</span>
              {(threadInputTokens > 0 || threadOutputTokens > 0) && (
                <>
                  <span>·</span>
                  <span>
                    {formatTokenPair(threadInputTokens, threadOutputTokens)}
                  </span>
                </>
              )}
            </div>
          </div>
          {isThreadExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>

        {isThreadExpanded && (
          <div className="border-t border-slate-700/50">
            {thread.prompt && (
              <div className="px-4 py-3 bg-slate-900/30 border-b border-slate-700/50">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-medium text-cyan-400 flex items-center gap-1">
                    <MessageSquare className="w-3 h-3" /> 用户提示词
                  </span>
                  <button
                    onClick={() => copyToClipboard(thread.prompt || '', `${threadKey}-prompt`)}
                    className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
                  >
                    {copiedId === `${threadKey}-prompt` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    {copiedId === `${threadKey}-prompt` ? '已复制' : '复制'}
                  </button>
                </div>
                <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-32 overflow-auto">{cleanedPrompt}</div>
              </div>
            )}

            <div className="space-y-3 p-4">
              {thread.assistantTurns.map((turn, turnIdx) => {
                const turnKey = `${threadKey}-turn-${turn.messageId || turn.id || turnIdx}`;
                const isSingleChild = turn.childRecords.length === 1;
                const isTurnExpanded = isSingleChild ? true : expandedLLMs.has(turnKey);

                if (isSingleChild) {
                  return renderChildRecord({
                    call: turn.childRecords[0],
                    callIdx: 0,
                    parentKey: turnKey,
                    showTokenUsage: true,
                  });
                }

                return (
                  <div key={turnKey} className={`rounded border ${isTurnExpanded ? 'bg-slate-800/70 border-slate-600' : 'bg-slate-800/40 border-slate-700/50'}`}>
                    <button onClick={() => toggleLLM(turnKey)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
                      <div className="w-7 h-7 rounded-full bg-cyan-500/15 flex items-center justify-center">
                        <span className="text-[11px] text-cyan-300 font-mono">{turnIdx + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm text-cyan-300">Assistant turn</div>
                        <div className="text-xs text-gray-400 mt-0.5 flex flex-wrap gap-x-2 gap-y-1">
                          <span>{turn.childRecordCount} child records</span>
                          {turn.totalTokens > 0 && <span>{formatTokenPair(turn.inputTokens, turn.outputTokens)}</span>}
                          {turn.messageId && <span className="font-mono">message.id: {turn.messageId}</span>}
                        </div>
                      </div>
                      {isTurnExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                    </button>

                    {isTurnExpanded && (
                      <div className="border-t border-slate-700/50 space-y-2 p-3">
                        {turn.childRecords.map((call, callIdx) =>
                          renderChildRecord({
                            call,
                            callIdx,
                            parentKey: turnKey,
                            showTokenUsage: false,
                          }),
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderLLM = () => (
    <div className="space-y-4">
      {allLLMCalls.length === 0 ? (
        <EmptyState icon={MessageSquare} label="无 LLM 调用记录" />
      ) : (
        assistantTurnGroups.map((thread, threadIdx) =>
          renderPromptThreadGroup({
            thread,
            index: threadIdx,
            toolScope: trace.tools || [],
            scopePrefix: 'main-llm',
            jumpable: true,
          }),
        )
      )}
    </div>
  );

  const renderSubagents = () => {
    if (subagentLogs.length === 0) {
      return <EmptyState icon={Bot} label="无 Subagent 日志" />;
    }

    const completedCount = subagentLogs.filter((item) => item.status === 'completed').length;
    const failedCount = subagentLogs.filter((item) => item.status === 'failed').length;
    const runningCount = subagentLogs.filter((item) => item.status === 'running').length;

    return (
      <div className="space-y-4">
        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <Bot className="w-4 h-4" />
            Subagent 概览
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <MetricCard icon={Bot} color="text-cyan-400" value={String(subagentLogs.length)} label="Subagents" />
            <MetricCard icon={Check} color="text-emerald-400" value={String(completedCount)} label="已完成" />
            <MetricCard icon={Clock} color="text-amber-400" value={String(runningCount)} label="运行中" />
            <MetricCard icon={XIcon} color="text-red-400" value={String(failedCount)} label="失败" />
          </div>
        </div>

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
                className={`overflow-hidden rounded-xl border transition-all ${
                  isGroupExpanded ? 'border-slate-600 bg-slate-800/55 shadow-sm shadow-slate-950/30' : 'border-slate-700/50 bg-slate-900/35 hover:border-slate-600/70 hover:bg-slate-900/45'
                }`}
              >
                <button onClick={() => toggleLLM(groupKey)} className="w-full px-4 py-3.5 text-left">
                  <div className="flex items-center gap-3">
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-cyan-500/20 bg-cyan-500/10 text-[11px] font-mono text-cyan-300">
                      {groupIdx + 1}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="truncate text-sm font-medium text-slate-100">
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
                        <span className="rounded-full bg-slate-800/80 px-2 py-0.5 text-[11px] text-slate-300">
                          {group.subagents.length} subagents
                        </span>
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-400">
                        <span>{formatTime(launchTime)}</span>
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
                            <span className="text-amber-300">{groupRunningCount} running</span>
                          </>
                        )}
                        {groupFailedCount > 0 && (
                          <>
                            <span>·</span>
                            <span className="text-red-300">{groupFailedCount} failed</span>
                          </>
                        )}
                      </div>
                    </div>
                    {group.subagents[0]?.launchPromptId && (
                      <button
                        onClick={(event) => {
                          event.stopPropagation();
                          jumpToLaunchPrompt(group.subagents[0]?.launchPromptId);
                        }}
                        className="shrink-0 rounded-lg border border-slate-700/80 bg-slate-900/70 px-2.5 py-1 text-[11px] text-slate-300 hover:border-slate-600 hover:text-white"
                      >
                        Go to prompt
                      </button>
                    )}
                    <div className="shrink-0 rounded-full border border-slate-700/80 bg-slate-900/70 p-1.5 text-slate-400">
                      {isGroupExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                    </div>
                  </div>
                </button>

                {isGroupExpanded && (
                  <div className="border-t border-slate-700/50 px-3 py-3 space-y-2.5 bg-slate-950/10">
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
                        <div key={subagent.id} className={`overflow-hidden rounded-xl border transition-all ${isSubagentExpanded ? 'border-slate-600 bg-slate-800/65 shadow-sm shadow-slate-950/20' : 'border-slate-700/50 bg-slate-900/30 hover:border-slate-600/70 hover:bg-slate-900/40'}`}>
                          <button onClick={() => toggleLLM(subagentKey)} className="w-full px-3.5 py-3 text-left">
                            <div className="flex items-center gap-3">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-violet-500/20 bg-violet-500/10 text-[10px] font-mono text-violet-300">
                                {subagentIdx + 1}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2 min-w-0">
                                  <span className="inline-flex items-center gap-1 rounded bg-sky-500/15 px-1.5 py-0.5 text-[10px] text-sky-300">
                                    <Bot className="h-3 w-3" />
                                    subagent
                                  </span>
                                  <div className="min-w-0 truncate text-sm font-medium text-slate-100">{subagent.description || subagent.agentType || subagent.agentId}</div>
                                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${statusTone}`}>{statusLabel(subagent.status)}</span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-400">
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
                                      <span className="text-sky-300">details below</span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="shrink-0 rounded-full border border-slate-700/80 bg-slate-900/70 p-1.5 text-slate-400">
                                {isSubagentExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                              </div>
                            </div>
                          </button>

                          {isSubagentExpanded && (
                            <div className="border-t border-slate-700/50 px-3.5 pb-3 pt-3 space-y-4 bg-slate-950/10">
                              {hasSubagentDetails && (
                                <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 space-y-2">
                                  <div className="flex items-center gap-2 text-xs font-medium text-sky-300">
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
                                      onCopy={copyToClipboard}
                                    />
                                  )}
                                </div>
                              )}
                              {cleanedPrompt && promptThreads.length === 0 && (
                                <PreviewBlock icon={User} label="用户输入" content={truncateText(cleanedPrompt, 800)} />
                              )}
                              {promptThreads.length > 0 ? (
                                <div className="space-y-3">
                                  {promptThreads.map((thread, threadIdx) =>
                                    renderPromptThreadGroup({
                                      thread,
                                      index: threadIdx,
                                      toolScope: subagent.toolCalls,
                                      scopePrefix: `subagent-${subagent.id}`,
                                    }),
                                  )}
                                </div>
                              ) : assistantTurns.length > 0 ? (
                                <div className="space-y-3">
                                  {assistantTurnsToPromptThreads(assistantTurns, `subagent-${subagent.id}`).map((thread, threadIdx) =>
                                    renderPromptThreadGroup({
                                      thread,
                                      index: threadIdx,
                                      toolScope: subagent.toolCalls,
                                      scopePrefix: `subagent-${subagent.id}`,
                                    }),
                                  )}
                                </div>
                              ) : subagent.response ? (
                                <JsonOrTextBlock
                                  title={responseStyle.label}
                                  value={cleanSessionText(subagent.response)}
                                  copyId={`subagent-response-${subagent.id}`}
                                  copiedId={copiedId}
                                  onCopy={copyToClipboard}
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
  };

  const renderTaskStatus = () => {
    const taskSummary = typedTrace.metadata?.task_summary as
      | {
          created?: number;
          updated?: number;
          listed?: number;
          got?: number;
          latest_statuses?: Array<{ taskId: string; status: string }>;
          latest?: { taskId?: string; status?: string; subject?: string; description?: string } | null;
          tasks?: Array<{
            taskId: string;
            status?: string;
            subject?: string;
            description?: string;
            created_prompt_idx?: number;
            latest_status_prompt_idx?: number;
          }>;
        }
      | undefined;

    const tasks = taskSummary?.tasks || [];
    const hasTaskData = tasks.length > 0;

    if (!hasTaskData || !taskSummary) {
      return <EmptyState icon={Layers} label="无任务状态摘要" />;
    }

    return (
      <div className="space-y-4">
        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4" />
            任务状态
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <MetricCard icon={Check} color="text-emerald-400" value={String(taskSummary.created || 0)} label="创建" />
            <MetricCard icon={MessageSquare} color="text-cyan-400" value={String(taskSummary.updated || 0)} label="更新" />
            <MetricCard icon={Hash} color="text-violet-400" value={String(taskSummary.listed || 0)} label="列表" />
            <MetricCard icon={Code} color="text-orange-400" value={String(taskSummary.got || 0)} label="获取" />
          </div>
          <div className="mt-4 space-y-2">
            {tasks.map((task) => (
              <div key={task.taskId} className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-slate-300 truncate">{task.taskId}</span>
                  <span className="rounded-full bg-blue-500/15 px-2.5 py-1 text-xs text-blue-300">{task.status || 'unknown'}</span>
                </div>
                {task.subject && <div className="text-sm text-slate-200">{task.subject}</div>}
                {task.description && <div className="text-xs text-slate-400 whitespace-pre-wrap">{task.description}</div>}
                {task.created_prompt_idx != null && (
                  <div className="text-[11px] text-slate-500">created at user prompt #{task.created_prompt_idx}</div>
                )}
                {task.latest_status_prompt_idx != null && task.latest_status_prompt_idx !== task.created_prompt_idx && (
                  <div className="text-[11px] text-slate-500">latest status updated at user prompt #{task.latest_status_prompt_idx}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const rawJson = JSON.stringify(typedTrace.raw || trace, null, 2);

  const renderRaw = () => (
    <JsonOrTextBlock
      title="原始 Session 记录"
      value={rawJson}
      copyId="raw-trace"
      copiedId={copiedId}
      onCopy={copyToClipboard}
    />
  );

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700/50 overflow-hidden">
      <div className="border-b border-slate-700 px-4 py-3 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
              activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'llm' && renderLLM()}
        {activeTab === 'subagents' && renderSubagents()}
        {activeTab === 'taskStatus' && renderTaskStatus()}
        {activeTab === 'raw' && renderRaw()}
      </div>
    </div>
  );
};

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


export default EnhancedTraceDetail;
