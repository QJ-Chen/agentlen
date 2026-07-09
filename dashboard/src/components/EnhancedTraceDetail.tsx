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
} from 'lucide-react';
import type { LLMCall, PromptThread, ToolCall, Trace } from '../types';
import {
  assistantTurnsToPromptThreads,
  deriveRenderablePromptThreads,
  groupSubagentLaunches,
} from '../lib/conversationModel';
import { cleanSessionText, formatDuration, formatTimestamp, formatTokenPair, truncateText } from '../lib/sessionUtils';
import {
  EmptyState,
  InfoField,
  JsonOrTextBlock,
  MetricCard,
  PathField,
  PreviewBlock,
  StructuredResponseBlock,
} from './TraceDetailBlocks';

interface EnhancedTraceDetailProps {
  trace: Trace;
  initialTab?: TabType;
  hideTabs?: boolean;
}

export type TabType = 'overview' | 'llm' | 'subagents' | 'taskStatus' | 'vision' | 'raw';
type DetailLevel = 'summary' | 'standard' | 'verbose';
type ReplayMessageKind = 'user' | 'thinking' | 'tool' | 'text' | 'empty' | 'subagent';
type TraceWithRaw = Trace & { raw?: Record<string, unknown> };

const REPLAY_KIND_LABELS: Record<ReplayMessageKind, string> = {
  user: '用户',
  thinking: '思考',
  tool: '工具',
  text: '文本',
  empty: '空响应',
  subagent: 'Subagent',
};

const DETAIL_LEVEL_LABELS: Record<DetailLevel, string> = {
  summary: '摘要',
  standard: '标准',
  verbose: '详细',
};

const DEFAULT_VISIBLE_KINDS: Record<ReplayMessageKind, boolean> = {
  user: true,
  thinking: true,
  tool: true,
  text: true,
  empty: true,
  subagent: true,
};

const PLATFORM_CONFIG = {
  'claude-code': { name: 'Claude Code', color: 'text-orange-700', bg: 'bg-orange-50 border border-orange-100' },
} as const;

export const EnhancedTraceDetail: React.FC<EnhancedTraceDetailProps> = ({
  trace,
  initialTab = 'overview',
  hideTabs = false,
}) => {
  const typedTrace = trace as TraceWithRaw;
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('standard');
  const [visibleKinds, setVisibleKinds] = useState<Record<ReplayMessageKind, boolean>>(DEFAULT_VISIBLE_KINDS);
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

  const getCallRenderState = (call: LLMCall, toolScope: ToolCall[] = trace.tools || []) => {
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

    return {
      relatedTools,
      responseStyle,
      formattedToolResponse,
      toolResultAppendix,
    };
  };

  const isKindVisible = (kind: ReplayMessageKind) => visibleKinds[kind];

  const toggleVisibleKind = (kind: ReplayMessageKind) => {
    setVisibleKinds((current) => ({
      ...current,
      [kind]: !current[kind],
    }));
  };

  const resetReplayFilters = () => {
    setDetailLevel('standard');
    setVisibleKinds({ ...DEFAULT_VISIBLE_KINDS });
  };

  const replayFilterKinds =
    activeTab === 'subagents'
      ? (['user', 'thinking', 'tool', 'text', 'empty', 'subagent'] as ReplayMessageKind[])
      : (['user', 'thinking', 'tool', 'text', 'empty'] as ReplayMessageKind[]);

  const surfaceClass = 'rounded-3xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/60';

  const shouldShowReplayFilters = activeTab === 'llm' || activeTab === 'subagents';

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

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab, trace.sessionId]);

  const tabs = [
    { id: 'overview', label: '概览', icon: Activity },
    { id: 'llm', label: `LLM (${assistantTurnGroups.length}组)`, icon: MessageSquare },
    { id: 'subagents', label: `Subagents (${subagentLogs.length})`, icon: Bot },
    { id: 'taskStatus', label: '任务状态', icon: Layers },
    { id: 'vision', label: `Vision (${trace.visionReferences?.length || 0})`, icon: FileText },
    { id: 'raw', label: '原始', icon: Code },
  ] as const;

  const renderOverview = () => {
    const platformConfig = PLATFORM_CONFIG[trace.platform] ?? PLATFORM_CONFIG['claude-code'];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <MetricCard icon={Clock} color="text-blue-600" value={formatDuration(trace.duration)} label="会话时长" />
          <MetricCard icon={MessageSquare} color="text-cyan-600" value={String(assistantTurnGroups.length)} label="提示词分组" />
          <MetricCard icon={Wrench} color="text-violet-600" value={String(allTools.length)} label="工具调用" />
          <MetricCard icon={DollarSign} color="text-emerald-600" value={`$${trace.cost.toFixed(4)}`} label="总成本" />
        </div>

        <div className={surfaceClass}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Box className="h-4 w-4 text-slate-400" />
            Session 信息
          </h3>
          <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
            <InfoField label="Agent" value={trace.agentName} />
            <div>
              <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">平台</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${platformConfig.bg} ${platformConfig.color}`}>
                {platformConfig.name}
              </span>
            </div>
            <InfoField label="开始时间" value={formatTime(trace.startTime)} />
            <InfoField label="修改时间" value={formatTimestamp(trace.lastUpdatedAt || trace.lastRequestTime)} />
            <InfoField label="最后活动" value={formatTime(trace.lastRequestTime)} />
            <InfoField label="创建时间" value={formatTimestamp(trace.createdAt || trace.startTime)} />
            <InfoField label="Session ID" value={trace.sessionId} mono />
          </div>
          {trace.projectPath && <PathField label="项目路径" value={trace.projectPath} actionLabel="Open project" actionIcon={ExternalLink} actionPending={openingTarget === 'project'} onAction={() => void openPath('project')} />}
          {trace.sessionFilePath && <PathField label="Session 文件" value={trace.sessionFilePath} actionLabel="Open folder" actionIcon={ExternalLink} actionPending={openingTarget === 'session_folder'} onAction={() => void openPath('session_folder')} />}
          {openError && <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{openError}</div>}
        </div>
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
    const formatCommandLabel = (name: string) => (name.startsWith('/') ? name : `/${name}`);
    const commandLabel = thread.command?.name ? formatCommandLabel(thread.command.name) : '';
    const commandPreview = thread.command?.name
      ? `${commandLabel}${thread.command.args ? ` ${thread.command.args}` : ''}`
      : '';
    const promptPreviewSource = cleanedPrompt || commandPreview;
    const promptPreview = promptPreviewSource
      ? `${promptPreviewSource.replace(/\n/g, ' ').slice(0, 80)}${promptPreviewSource.length > 80 ? '...' : ''}`
      : '无提示词';
    const hasCommandOnlyRecords = !!thread.commandOnlyRecords && thread.commandOnlyRecords.length > 0;
    const showCommandBlock = isKindVisible('user') && detailLevel !== 'summary' && !!thread.command?.name && !hasCommandOnlyRecords;
    const showPromptBlock = isKindVisible('user') && detailLevel !== 'summary' && cleanedPrompt.length > 0;
    const showCommandOnlyBlocks = isKindVisible('user') && detailLevel !== 'summary' && hasCommandOnlyRecords;

    const visibleTurns = thread.assistantTurns
      .map((turn) => {
        const visibleChildRecords = turn.childRecords.filter((call) => {
          const { responseStyle } = getCallRenderState(call, toolScope);
          return isKindVisible(responseStyle.kind);
        });

        return {
          turn,
          visibleChildRecords,
        };
      })
      .filter(({ visibleChildRecords }) => visibleChildRecords.length > 0);

    if (!showCommandBlock && !showPromptBlock && !showCommandOnlyBlocks && visibleTurns.length === 0) {
      return null;
    }

    const threadInputTokens = visibleTurns.reduce((sum, { turn }) => sum + turn.inputTokens, 0);
    const threadOutputTokens = visibleTurns.reduce((sum, { turn }) => sum + turn.outputTokens, 0);
    const assistantTurnCount = visibleTurns.length;

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
      const isCallExpanded = detailLevel !== 'summary' && expandedLLMs.has(callKey);
      const { responseStyle, formattedToolResponse, toolResultAppendix } = getCallRenderState(call, toolScope);

      return (
        <div key={callKey} className={`rounded-2xl border-l-4 transition-all ${isCallExpanded ? 'bg-white border-violet-300 shadow-md shadow-violet-100/40 ring-1 ring-violet-100' : 'bg-slate-50/80 border-slate-200/80 border-l-slate-300'}`}>
          <button onClick={() => toggleLLM(callKey)} className="w-full px-3 py-2 flex items-center gap-2 text-left">
            <div className={`w-6 h-6 rounded-full flex items-center justify-center ring-1 ring-white ${responseStyle.badge}`}>
              <responseStyle.icon className={`w-3.5 h-3.5 ${responseStyle.accent}`} />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${responseStyle.badge}`}>{responseStyle.label}</span>
                <div className={`text-sm truncate ${responseStyle.accent}`}>
                  {responseStyle.preview
                    ? `${responseStyle.preview.replace(/\n/g, ' ').slice(0, 60)}${responseStyle.preview.length > 60 ? '...' : ''}`
                    : '无响应内容'}
                </div>
              </div>
              <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
                {call.model && call.model !== 'unknown' && <span>{call.model}</span>}
                {showTokenUsage && call.totalTokens > 0 && (
                  <>
                    {call.model && call.model !== 'unknown' && <span>·</span>}
                    <span>{formatTokenPair(call.inputTokens, call.outputTokens)}</span>
                  </>
                )}
                {call.duration > 0 && <span>·</span>}
                {call.duration > 0 && <span>{formatDuration(call.duration)}</span>}
                {detailLevel === 'verbose' && call.sourceEventIds && call.sourceEventIds[0] && (
                  <>
                    <span>·</span>
                    <span className="font-mono">event {call.sourceEventIds[0]}</span>
                  </>
                )}
              </div>
            </div>
            {detailLevel !== 'summary' && (isCallExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />)}
          </button>

          {detailLevel !== 'summary' && isCallExpanded && (
            <div className="ml-6 border-l-2 border-violet-100 px-3 pb-3 pt-3 space-y-3 bg-violet-50/35 rounded-bl-2xl">
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
        className={`rounded-2xl border-l-4 transition-all ${
          isThreadExpanded ? 'bg-white border-cyan-300 shadow-md shadow-cyan-100/40 ring-1 ring-cyan-100' : 'bg-slate-50/80 border-slate-200/80 border-l-cyan-200'
        }`}
      >
        <button onClick={() => toggleLLM(threadKey)} className="w-full px-4 py-3.5 flex items-center gap-3 text-left">
          <div className="w-8 h-8 rounded-full bg-cyan-50 flex items-center justify-center ring-1 ring-cyan-100">
            <span className="text-xs text-cyan-400 font-mono">{index + 1}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-slate-900 truncate">{promptPreview}</div>
            <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
              <span>{assistantTurnCount} 个 assistant turn</span>
              {hasCommandOnlyRecords && (
                <>
                  <span>·</span>
                  <span>{thread.commandOnlyRecords!.length} 个 command</span>
                </>
              )}
              {(threadInputTokens > 0 || threadOutputTokens > 0) && (
                <>
                  <span>·</span>
                  <span>
                    {formatTokenPair(threadInputTokens, threadOutputTokens)}
                  </span>
                </>
              )}
              {detailLevel === 'verbose' && thread.promptId && (
                <>
                  <span>·</span>
                  <span className="font-mono">promptId: {thread.promptId}</span>
                </>
              )}
            </div>
          </div>
          {isThreadExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        </button>

        {isThreadExpanded && (
          <div className="border-t border-cyan-100/80 bg-white">
            <div className="space-y-3 p-4">
              {showCommandBlock && thread.command && thread.command.name && (
                <div className="rounded-2xl border border-sky-200/80 bg-sky-50/70">
                  <div className="flex items-center gap-2 border-b border-sky-100/80 px-4 py-3">
                    <span className="text-xs font-semibold text-sky-700 rounded-full border border-sky-200 bg-white px-2 py-0.5">Command</span>
                    <span className="text-sm font-medium text-sky-900">{formatCommandLabel(thread.command.name)}</span>
                    {thread.command.args && <span className="text-xs text-slate-600 font-mono break-all">{thread.command.args}</span>}
                  </div>
                  {thread.command.message && (
                    <div className="px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-24 overflow-auto">
                      {thread.command.message}
                    </div>
                  )}
                </div>
              )}
              {isKindVisible('user') && detailLevel !== 'summary' && thread.commandOnlyRecords?.map((record, commandIdx) => (
                <div key={`${threadKey}-cmdonly-${commandIdx}`} className="rounded-2xl border border-sky-200/60 bg-sky-50/50">
                  <div className="flex items-center gap-2 border-b border-sky-100/80 px-4 py-3">
                    <span className="text-xs font-semibold text-sky-700 rounded-full border border-sky-200 bg-white px-2 py-0.5">Command</span>
                    <span className="text-sm font-medium text-sky-900">{formatCommandLabel(record.name)}</span>
                    {record.args && <span className="text-xs text-slate-600 font-mono break-all">{record.args}</span>}
                    {record.timestamp && (
                      <span className="ml-auto text-[11px] text-slate-500 font-mono">
                        {new Date(record.timestamp).toLocaleString()}
                      </span>
                    )}
                  </div>
                  {record.message && (
                    <div className="px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-24 overflow-auto">
                      {record.message}
                    </div>
                  )}
                </div>
              ))}
              {showPromptBlock && (
                <div className="rounded-2xl border border-slate-200/80 bg-slate-50/80">
                  <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
                    <span className="text-xs font-semibold text-cyan-700 flex items-center gap-1">
                      <MessageSquare className="w-3 h-3" /> 用户提示词
                    </span>
                    <button
                      onClick={() => copyToClipboard(thread.prompt || '', `${threadKey}-prompt`)}
                      className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
                    >
                      {copiedId === `${threadKey}-prompt` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                      {copiedId === `${threadKey}-prompt` ? '已复制' : '复制'}
                    </button>
                  </div>
                  <div className="px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-24 overflow-auto">{cleanedPrompt}</div>
                </div>
              )}
            </div>

            <div className="space-y-3 p-4 bg-white ml-4 border-l-2 border-cyan-100/80 rounded-bl-2xl">
              {visibleTurns.map(({ turn, visibleChildRecords }, turnIdx) => {
                const turnKey = `${threadKey}-turn-${turn.messageId || turn.id || turnIdx}`;
                const isSingleChild = visibleChildRecords.length === 1;
                const isTurnExpanded = detailLevel !== 'summary' && (isSingleChild ? true : expandedLLMs.has(turnKey));

                if (isSingleChild) {
                  return renderChildRecord({
                    call: visibleChildRecords[0],
                    callIdx: 0,
                    parentKey: turnKey,
                    showTokenUsage: true,
                  });
                }

                return (
                  <div key={turnKey} className={`rounded-2xl border-l-4 ${isTurnExpanded ? 'bg-white border-cyan-300 shadow-md shadow-cyan-100/35 ring-1 ring-cyan-100' : 'bg-slate-50/80 border-slate-200/80 border-l-cyan-200'}`}>
                    <div className="w-full px-4 py-3.5 flex items-center gap-3">
                      <button
                        onClick={() => toggleLLM(turnKey)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                        <div className="w-7 h-7 rounded-full bg-cyan-50 flex items-center justify-center ring-1 ring-cyan-100">
                          <span className="text-[11px] text-cyan-300 font-mono">{turnIdx + 1}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-cyan-700 font-medium">Assistant turn</div>
                          <div className="text-xs text-slate-500 mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span>{visibleChildRecords.length} child records</span>
                            {turn.totalTokens > 0 && (
                              <>
                                <span>·</span>
                                <span>{formatTokenPair(turn.inputTokens, turn.outputTokens)}</span>
                              </>
                            )}
                            {detailLevel === 'verbose' && turn.messageId && <span className="font-mono">message.id: {turn.messageId}</span>}
                          </div>
                        </div>
                      </button>
                      {detailLevel !== 'summary' && visibleChildRecords.length > 0 && (() => {
                        const childKeys = visibleChildRecords.map((_call, callIdx) => `${turnKey}-call-${callIdx}`);
                        const allExpanded = childKeys.every((key) => expandedLLMs.has(key));
                        return (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedLLMs((current) => {
                                const next = new Set(current);
                                if (allExpanded) {
                                  childKeys.forEach((key) => next.delete(key));
                                } else {
                                  childKeys.forEach((key) => next.add(key));
                                }
                                return next;
                              })
                            }
                            className="shrink-0 rounded-lg border border-cyan-200 bg-white px-2 py-1 text-[11px] text-cyan-700 hover:border-cyan-300 hover:bg-cyan-50 shadow-sm"
                          >
                            {allExpanded ? '折叠详情' : '展开详情'}
                          </button>
                        );
                      })()}
                      <button
                        type="button"
                        onClick={() => toggleLLM(turnKey)}
                        aria-label={isTurnExpanded ? 'Collapse assistant turn' : 'Expand assistant turn'}
                        className="shrink-0 rounded-full border border-slate-200 bg-white p-1.5 text-slate-500 hover:border-slate-300 hover:text-slate-900 shadow-sm"
                      >
                        {detailLevel !== 'summary' && (isTurnExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />)}
                      </button>
                    </div>

                    {detailLevel !== 'summary' && isTurnExpanded && (
                      <div className="ml-5 border-l-2 border-cyan-100/80 space-y-2 p-3 bg-cyan-50/35 rounded-bl-2xl">
                        {visibleChildRecords.map((call, callIdx) =>
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

  const renderLLM = () => {
    if (allLLMCalls.length === 0) {
      return <EmptyState icon={MessageSquare} label="无 LLM 调用记录" />;
    }

    const renderedThreads = assistantTurnGroups
      .map((thread, threadIdx) =>
        renderPromptThreadGroup({
          thread,
          index: threadIdx,
          toolScope: trace.tools || [],
          scopePrefix: 'main-llm',
          jumpable: true,
        }),
      )
      .filter(Boolean);

    if (renderedThreads.length === 0) {
      return <EmptyState icon={MessageSquare} label="当前筛选条件下无可见消息" />;
    }

    return <div className="space-y-4">{renderedThreads}</div>;
  };

  const renderSubagents = () => {
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
                      onClick={() => toggleLLM(groupKey)}
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
                        onClick={() => jumpToLaunchPrompt(group.subagents[0]?.launchPromptId)}
                        className="shrink-0 rounded-xl border border-slate-200 bg-white px-2.5 py-1 text-[11px] text-slate-600 hover:border-slate-300 hover:text-slate-900 shadow-sm"
                      >
                        Go to prompt
                      </button>
                    )}
                    <button
                      onClick={() => toggleLLM(groupKey)}
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
                          <button onClick={() => toggleLLM(subagentKey)} className="w-full px-3.5 py-3 text-left">
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
        <div className={surfaceClass}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
            <Layers className="h-4 w-4 text-slate-400" />
            任务状态
          </h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
            <MetricCard icon={Check} color="text-emerald-600" value={String(taskSummary.created || 0)} label="创建" />
            <MetricCard icon={MessageSquare} color="text-cyan-600" value={String(taskSummary.updated || 0)} label="更新" />
            <MetricCard icon={Hash} color="text-violet-600" value={String(taskSummary.listed || 0)} label="列表" />
            <MetricCard icon={Code} color="text-orange-600" value={String(taskSummary.got || 0)} label="获取" />
          </div>
          <div className="mt-4 space-y-2">
            {tasks.map((task) => (
              <div key={task.taskId} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="font-mono text-xs text-slate-600 truncate">{task.taskId}</span>
                  <span className="rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-xs text-blue-700">{task.status || 'unknown'}</span>
                </div>
                {task.subject && <div className="text-sm font-medium text-slate-900">{task.subject}</div>}
                {task.description && <div className="text-xs text-slate-500 whitespace-pre-wrap">{task.description}</div>}
                {task.created_prompt_idx != null && (
                  <div className="text-[11px] text-slate-400">created at user prompt #{task.created_prompt_idx}</div>
                )}
                {task.latest_status_prompt_idx != null && task.latest_status_prompt_idx !== task.created_prompt_idx && (
                  <div className="text-[11px] text-slate-400">latest status updated at user prompt #{task.latest_status_prompt_idx}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const renderVision = () => {
    const references = trace.visionReferences || [];
    if (references.length === 0) {
      return <EmptyState icon={FileText} label="No vision context found." />;
    }

    return (
      <div className="space-y-4">
        <div className={surfaceClass}>
          <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
            <FileText className="h-4 w-4 text-slate-400" />
            Vision context
          </h3>
          <div className="space-y-3">
            {references.map((reference, index) => (
              <div key={`${reference.path}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
                <div className="text-sm font-medium text-slate-900 break-all">{reference.path}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                  {reference.origin && <span>{reference.origin}</span>}
                  {reference.mime_type && (
                    <>
                      <span>·</span>
                      <span>{reference.mime_type}</span>
                    </>
                  )}
                  {reference.absolute_path && reference.absolute_path !== reference.path && (
                    <>
                      <span>·</span>
                      <span className="break-all font-mono">{reference.absolute_path}</span>
                    </>
                  )}
                </div>
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

  const renderReplayFilters = () => {
    if (!shouldShowReplayFilters) {
      return null;
    }

    return (
      <div className="border-b border-slate-200/80 px-4 py-3 bg-slate-50/80 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Detail</span>
          {(Object.keys(DETAIL_LEVEL_LABELS) as DetailLevel[]).map((level) => (
            <button
              key={level}
              onClick={() => setDetailLevel(level)}
              className={`px-2.5 py-1 rounded-md text-xs transition-colors ${
                detailLevel === level
                  ? 'bg-blue-600 text-white shadow-sm shadow-blue-100'
                  : 'bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-900'
              }`}
            >
              {DETAIL_LEVEL_LABELS[level]}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Kinds</span>
          {replayFilterKinds.map((kind) => (
            <button
              key={kind}
              onClick={() => toggleVisibleKind(kind)}
              className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                isKindVisible(kind)
                  ? 'bg-cyan-50 text-cyan-700 border border-cyan-200'
                  : 'bg-white text-slate-500 border border-slate-200 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {REPLAY_KIND_LABELS[kind]}
            </button>
          ))}
          <button
            onClick={resetReplayFilters}
            className="ml-2 px-2.5 py-1 rounded-xl text-xs bg-white text-slate-600 border border-slate-200 hover:border-slate-300 hover:text-slate-900"
          >
            Reset
          </button>
        </div>
      </div>
    );
  };

  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white overflow-hidden shadow-sm shadow-slate-200/70 xl:max-h-[calc(100vh-3rem)] xl:flex xl:flex-col">
      {!hideTabs && (
        <div className="border-b border-slate-200 px-4 py-3 flex flex-wrap gap-2 bg-white">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
                activeTab === tab.id ? 'bg-blue-600 text-white shadow-sm shadow-blue-100' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {renderReplayFilters()}

      <div className="p-5 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'llm' && renderLLM()}
        {activeTab === 'subagents' && renderSubagents()}
        {activeTab === 'taskStatus' && renderTaskStatus()}
        {activeTab === 'vision' && renderVision()}
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
