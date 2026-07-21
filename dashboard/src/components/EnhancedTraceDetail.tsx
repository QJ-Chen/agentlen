import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bot, Code, FileText, Layers, MessageSquare } from 'lucide-react';
import type { Trace } from '../types';
import { API_URL } from '../lib/api';
import type { DetailLevel } from '../lib/callClassification';
import { deriveRenderablePromptThreads, groupSubagentLaunches } from '../lib/conversationModel';
import type { ConversationPageResponse, RawSessionRecord } from '../lib/sessionApiTypes';
import { toTimestamp, transformSession } from '../lib/sessionNormalization';
import { isThreadVisible } from '../lib/threadVisibility';
import { EmptyState } from './TraceDetailBlocks';
import { RawView, TaskStatusView, VisionView } from './trace-detail/AuxViews';
import { OverviewView } from './trace-detail/OverviewView';
import { PromptThreadGroup } from './trace-detail/PromptThreadGroup';
import { SubagentsView } from './trace-detail/SubagentsView';
import {
  DEFAULT_VISIBLE_KINDS,
  REPLAY_KIND_LABELS,
  type ReplayMessageKind,
} from './trace-detail/shared';
import { useLanguage } from '../lib/language';

interface EnhancedTraceDetailProps {
  trace: Trace;
  initialTab?: TabType;
  hideTabs?: boolean;
}

export type TabType = 'overview' | 'llm' | 'subagents' | 'taskStatus' | 'vision' | 'raw';
type TraceWithRaw = Trace & { raw?: RawSessionRecord };

function metadataForConversationWindow(
  metadata: Record<string, unknown> | undefined,
  llmCalls: RawSessionRecord['llm_calls'],
) {
  const next: Record<string, unknown> = { ...(metadata || {}), detail_level: 'summary' };
  const earliestTurn = Math.min(
    ...(llmCalls || [])
      .map((call) => toTimestamp(call.start_time || call.timestamp))
      .filter((timestamp): timestamp is number => timestamp !== undefined),
  );
  const commands = metadata?.command_only_records;
  next.command_only_records = Number.isFinite(earliestTurn) && Array.isArray(commands)
    ? commands.filter((command) => {
        if (!command || typeof command !== 'object') return false;
        const timestamp = toTimestamp((command as { timestamp?: string | number }).timestamp);
        return timestamp !== undefined && timestamp >= earliestTurn;
      })
    : [];
  return next;
}

const DETAIL_LEVEL_LABELS: Record<DetailLevel, string> = {
  summary: 'Summary',
  standard: 'Standard',
  verbose: 'Verbose',
};

export const EnhancedTraceDetail: React.FC<EnhancedTraceDetailProps> = ({
  trace,
  initialTab = 'overview',
  hideTabs = false,
}) => {
  const { t } = useLanguage();
  const [activeTab, setActiveTab] = useState<TabType>(initialTab);
  const [fullTrace, setFullTrace] = useState<TraceWithRaw | null>(null);
  const [fullDetailLoading, setFullDetailLoading] = useState(false);
  const [fullDetailError, setFullDetailError] = useState<string | null>(null);
  const [conversationCursor, setConversationCursor] = useState<string | null>(null);
  const [conversationHasMore, setConversationHasMore] = useState(false);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [conversationLoaded, setConversationLoaded] = useState(false);
  const [fullSessionLoaded, setFullSessionLoaded] = useState(false);
  const [detailLevel, setDetailLevel] = useState<DetailLevel>('standard');
  const [visibleKinds, setVisibleKinds] = useState<Record<ReplayMessageKind, boolean>>(DEFAULT_VISIBLE_KINDS);
  const [expandedLLMs, setExpandedLLMs] = useState<Set<string>>(new Set(['group-0']));
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [openingTarget, setOpeningTarget] = useState<'project' | 'session_folder' | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [pendingLaunchPromptId, setPendingLaunchPromptId] = useState<string | null>(null);
  const llmGroupRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const copyToClipboard = useCallback(async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const openPath = async (target: 'project' | 'session_folder') => {
    setOpeningTarget(target);
    setOpenError(null);
    try {
      const response = await fetch(`${API_URL}/api/v1/sessions/${trace.sessionId}/open?target=${target}`, {
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

  const effectiveTrace = fullTrace || (trace as TraceWithRaw);
  const effectiveTypedTrace = effectiveTrace as TraceWithRaw;
  const allTools = useMemo(() => effectiveTrace.tools || [], [effectiveTrace.tools]);
  const allLLMCalls = useMemo(() => effectiveTrace.llmCalls || [], [effectiveTrace.llmCalls]);
  const assistantTurns = useMemo(() => effectiveTrace.assistantTurns || [], [effectiveTrace.assistantTurns]);
  const promptThreads = useMemo(() => effectiveTrace.promptThreads || [], [effectiveTrace.promptThreads]);
  const subagentLogs = useMemo(() => effectiveTrace.subagentLogs || [], [effectiveTrace.subagentLogs]);

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

  const isKindVisible = useCallback((kind: ReplayMessageKind) => visibleKinds[kind], [visibleKinds]);

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

  const shouldShowReplayFilters = activeTab === 'llm' || activeTab === 'subagents';

  const toggleLLM = useCallback((key: string) => {
    setExpandedLLMs((current) => {
      const newSet = new Set(current);
      if (newSet.has(key)) newSet.delete(key);
      else newSet.add(key);
      return newSet;
    });
  }, []);

  const toggleManyLLMs = useCallback((keys: string[], expand: boolean) => {
    setExpandedLLMs((current) => {
      const next = new Set(current);
      if (expand) {
        keys.forEach((key) => next.add(key));
      } else {
        keys.forEach((key) => next.delete(key));
      }
      return next;
    });
  }, []);

  const registerJumpRef = useCallback((id: string, node: HTMLDivElement | null) => {
    llmGroupRefs.current[id] = node;
  }, []);

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

  const jumpToLaunchPrompt = useCallback((promptId?: string) => {
    if (!promptId) return;
    setExpandedLLMs((current) => {
      const next = new Set(current);
      next.add(promptId);
      return next;
    });
    setPendingLaunchPromptId(promptId);
    setActiveTab('llm');
  }, []);

  useEffect(() => {
    setActiveTab(initialTab);
    setFullTrace(null);
    setFullDetailError(null);
    setConversationCursor(null);
    setConversationHasMore(false);
    setConversationLoaded(false);
    setFullSessionLoaded(false);
  }, [initialTab, trace.sessionId]);

  useEffect(() => {
    const needsConversation = activeTab === 'llm';
    const needsFullDetail = activeTab === 'subagents' || activeTab === 'raw';
    const detailLevel = effectiveTrace.raw?.metadata?.detail_level;
    if (
      (!needsConversation && !needsFullDetail)
      || (needsConversation && (conversationLoaded || fullSessionLoaded))
      || (needsFullDetail && fullSessionLoaded)
      || detailLevel === 'full'
    ) return;

    const controller = new AbortController();
    const loadFullDetail = async () => {
      setFullDetailLoading(true);
      setFullDetailError(null);
      try {
        const endpoint = needsConversation
          ? `${API_URL}/api/v1/sessions/${encodeURIComponent(trace.sessionId)}/conversation?limit=50`
          : `${API_URL}/api/v1/sessions/${encodeURIComponent(trace.sessionId)}?detail=full`;
        const response = await fetch(endpoint, { signal: controller.signal });
        if (!response.ok) throw new Error('Failed to load full session detail');
        const payload = (await response.json()) as RawSessionRecord | ConversationPageResponse;
        if (needsConversation && 'next_cursor' in payload) {
          const page = payload as ConversationPageResponse;
          const base = ((trace as TraceWithRaw).raw || {}) as RawSessionRecord;
          setConversationCursor(page.next_cursor);
          setConversationHasMore(page.has_more);
          setConversationLoaded(true);
          setFullTrace(transformSession({
            ...base,
            session_id: trace.sessionId,
            llm_calls: page.llm_calls,
            tool_calls: page.tool_calls,
            metadata: metadataForConversationWindow(base.metadata, page.llm_calls),
          }));
        } else {
          setFullTrace(transformSession(payload as RawSessionRecord));
          setFullSessionLoaded(true);
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setFullDetailError(error instanceof Error ? error.message : 'Failed to load full session detail');
        }
      } finally {
        if (!controller.signal.aborted) setFullDetailLoading(false);
      }
    };
    void loadFullDetail();
    return () => controller.abort();
  }, [activeTab, conversationLoaded, effectiveTrace.raw?.metadata?.detail_level, fullSessionLoaded, trace]);

  const loadOlderConversation = useCallback(async () => {
    if (!conversationCursor || conversationLoading) return;
    setConversationLoading(true);
    try {
      const response = await fetch(
        `${API_URL}/api/v1/sessions/${encodeURIComponent(trace.sessionId)}/conversation?limit=50&cursor=${conversationCursor}`,
      );
      if (!response.ok) throw new Error('Failed to load older conversation');
      const page = (await response.json()) as ConversationPageResponse;
      const current = fullTrace?.raw || {};
      const llmCalls = [...page.llm_calls, ...(current.llm_calls || [])];
      const baseMetadata = (trace as TraceWithRaw).raw?.metadata;
      setConversationCursor(page.next_cursor);
      setConversationHasMore(page.has_more);
      setFullTrace(transformSession({
        ...current,
        session_id: trace.sessionId,
        llm_calls: llmCalls,
        tool_calls: [...page.tool_calls, ...(current.tool_calls || [])],
        metadata: metadataForConversationWindow(baseMetadata, llmCalls),
      }));
    } catch (error) {
      setFullDetailError(error instanceof Error ? error.message : 'Failed to load older conversation');
    } finally {
      setConversationLoading(false);
    }
  }, [conversationCursor, conversationLoading, fullTrace, trace]);

  const tabs = [
    { id: 'overview', label: t('overview'), icon: Activity },
    { id: 'llm', label: `LLM (${assistantTurnGroups.length}组)`, icon: MessageSquare },
    { id: 'subagents', label: `Subagents (${subagentLogs.length})`, icon: Bot },
    { id: 'taskStatus', label: t('taskStatus'), icon: Layers },
    { id: 'vision', label: `Vision (${trace.visionReferences?.length || 0})`, icon: FileText },
    { id: 'raw', label: t('raw'), icon: Code },
  ] as const;

  const renderLLM = () => {
    if (allLLMCalls.length === 0) {
      return <EmptyState icon={MessageSquare} label={t('noLlm')} />;
    }

    if (!assistantTurnGroups.some((thread) => isThreadVisible(thread, isKindVisible, detailLevel))) {
      return <EmptyState icon={MessageSquare} label={t('noMessages')} />;
    }

    return (
      <div className="space-y-4">
        {assistantTurnGroups.map((thread, threadIdx) => (
          <PromptThreadGroup
            key={`main-llm-thread-${thread.id}`}
            thread={thread}
            index={threadIdx}
            toolScope={effectiveTrace.tools || []}
            scopePrefix="main-llm"
            allLLMCalls={allLLMCalls}
            detailLevel={detailLevel}
            expandedLLMs={expandedLLMs}
            copiedId={copiedId}
            sessionId={trace.sessionId}
            isKindVisible={isKindVisible}
            onToggle={toggleLLM}
            onToggleMany={toggleManyLLMs}
            onCopy={copyToClipboard}
            registerJumpRef={registerJumpRef}
          />
        ))}
      </div>
    );
  };

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
                  ? 'bg-ink-900 text-white shadow-sm'
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
                  ? 'bg-clay-50 text-clay-700 border border-clay-200'
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
                activeTab === tab.id ? 'bg-ink-900 text-white shadow-sm' : 'text-slate-500 hover:text-slate-900 hover:bg-slate-100'
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
        {activeTab === 'overview' && (
          <OverviewView
            trace={effectiveTrace}
            promptGroupCount={assistantTurnGroups.length}
            toolCount={allTools.length}
            openingTarget={openingTarget}
            openError={openError}
            onOpenPath={(target) => void openPath(target)}
          />
        )}
        {activeTab === 'llm' && fullDetailLoading && (
          <div className="text-sm text-slate-500">Loading conversation history…</div>
        )}
        {activeTab === 'llm' && !fullDetailLoading && fullDetailError && (
          <div className="text-sm text-red-600">{fullDetailError}</div>
        )}
        {activeTab === 'llm' && !fullDetailLoading && !fullDetailError && (
          <>
            {conversationHasMore && (
              <button
                type="button"
                onClick={() => void loadOlderConversation()}
                disabled={conversationLoading}
                className="mb-4 rounded-md border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:border-slate-300 disabled:opacity-50"
              >
                {conversationLoading ? t('loadingShort') : t('loadEarlier')}
              </button>
            )}
            {renderLLM()}
          </>
        )}
        {activeTab === 'subagents' && fullDetailLoading && (
          <div className="text-sm text-slate-500">Loading subagent history…</div>
        )}
        {activeTab === 'subagents' && !fullDetailLoading && fullDetailError && (
          <div className="text-sm text-red-600">{fullDetailError}</div>
        )}
        {activeTab === 'subagents' && !fullDetailLoading && !fullDetailError && (
          <SubagentsView
            subagentLogs={subagentLogs}
            groupedSubagentLogs={groupedSubagentLogs}
            detailLevel={detailLevel}
            expandedLLMs={expandedLLMs}
            copiedId={copiedId}
            sessionId={trace.sessionId}
            isKindVisible={isKindVisible}
            onToggle={toggleLLM}
            onToggleMany={toggleManyLLMs}
            onCopy={copyToClipboard}
            onJumpToLaunchPrompt={jumpToLaunchPrompt}
          />
        )}
        {activeTab === 'taskStatus' && <TaskStatusView trace={effectiveTypedTrace} />}
        {activeTab === 'vision' && <VisionView trace={effectiveTrace} />}
        {activeTab === 'raw' && fullDetailLoading && (
          <div className="text-sm text-slate-500">Loading raw detail…</div>
        )}
        {activeTab === 'raw' && !fullDetailLoading && fullDetailError && (
          <div className="text-sm text-red-600">{fullDetailError}</div>
        )}
        {activeTab === 'raw' && !fullDetailLoading && !fullDetailError && (
          <RawView trace={effectiveTypedTrace} copiedId={copiedId} onCopy={copyToClipboard} />
        )}
      </div>
    </div>
  );
};

export default EnhancedTraceDetail;
