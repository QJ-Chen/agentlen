import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Bot, Code, FileText, Layers, MessageSquare } from 'lucide-react';
import type { Trace } from '../types';
import { API_URL } from '../lib/api';
import type { DetailLevel } from '../lib/callClassification';
import { deriveRenderablePromptThreads, groupSubagentLaunches } from '../lib/conversationModel';
import type { RawSessionRecord } from '../lib/sessionApiTypes';
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

interface EnhancedTraceDetailProps {
  trace: Trace;
  initialTab?: TabType;
  hideTabs?: boolean;
}

export type TabType = 'overview' | 'llm' | 'subagents' | 'taskStatus' | 'vision' | 'raw';
type TraceWithRaw = Trace & { raw?: RawSessionRecord };

const DETAIL_LEVEL_LABELS: Record<DetailLevel, string> = {
  summary: '摘要',
  standard: '标准',
  verbose: '详细',
};

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
  }, [initialTab, trace.sessionId]);

  const tabs = [
    { id: 'overview', label: '概览', icon: Activity },
    { id: 'llm', label: `LLM (${assistantTurnGroups.length}组)`, icon: MessageSquare },
    { id: 'subagents', label: `Subagents (${subagentLogs.length})`, icon: Bot },
    { id: 'taskStatus', label: '任务状态', icon: Layers },
    { id: 'vision', label: `Vision (${trace.visionReferences?.length || 0})`, icon: FileText },
    { id: 'raw', label: '原始', icon: Code },
  ] as const;

  const renderLLM = () => {
    if (allLLMCalls.length === 0) {
      return <EmptyState icon={MessageSquare} label="无 LLM 调用记录" />;
    }

    if (!assistantTurnGroups.some((thread) => isThreadVisible(thread, isKindVisible, detailLevel))) {
      return <EmptyState icon={MessageSquare} label="当前筛选条件下无可见消息" />;
    }

    return (
      <div className="space-y-4">
        {assistantTurnGroups.map((thread, threadIdx) => (
          <PromptThreadGroup
            key={`main-llm-thread-${thread.id}`}
            thread={thread}
            index={threadIdx}
            toolScope={trace.tools || []}
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
            trace={trace}
            promptGroupCount={assistantTurnGroups.length}
            toolCount={allTools.length}
            openingTarget={openingTarget}
            openError={openError}
            onOpenPath={(target) => void openPath(target)}
          />
        )}
        {activeTab === 'llm' && renderLLM()}
        {activeTab === 'subagents' && (
          <SubagentsView
            subagentLogs={subagentLogs}
            groupedSubagentLogs={groupedSubagentLogs}
            allLLMCalls={allLLMCalls}
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
        {activeTab === 'taskStatus' && <TaskStatusView trace={typedTrace} />}
        {activeTab === 'vision' && <VisionView trace={trace} />}
        {activeTab === 'raw' && <RawView trace={typedTrace} copiedId={copiedId} onCopy={copyToClipboard} />}
      </div>
    </div>
  );
};

export default EnhancedTraceDetail;
