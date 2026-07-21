import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Activity,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Filter,
  LayoutDashboard,
  RefreshCw,
  Search,
  X,
} from 'lucide-react';
import type { OverviewStats, HierarchyNode, ProjectMetadata } from './types';
import { NodeDetailPane } from './components/NodeDetailPane';
import { HierarchyTree } from './components/HierarchyTree';
import type { HierarchyChildrenResponse, HierarchyResponse, ProjectMetadataResponse, SessionsResponse } from './lib/sessionApiTypes';
import { API_URL } from './lib/api';
import { useLanguage } from './lib/language';
import { transformSession, type TraceWithRaw } from './lib/sessionNormalization';
import {
  formatInteger,
  formatTokens,
  toEndOfLocalDayISOString,
  toStartOfLocalDayISOString,
} from './lib/sessionUtils';
import './index.css';

function mergeNodeChildren(node: HierarchyNode, nodeId: string, children: HierarchyNode[]): HierarchyNode {
  if (node.id === nodeId) {
    return { ...node, children, hasChildren: children.length > 0 || node.hasChildren };
  }
  if (!Array.isArray(node.children) || node.children.length === 0) {
    return node;
  }
  return {
    ...node,
    children: node.children.map((child) => mergeNodeChildren(child, nodeId, children)),
  };
}

function buildDateRangeLabel(startDate: string, endDate: string): string {
  if (startDate && endDate) return `${startDate} → ${endDate}`;
  if (startDate) return `from ${startDate}`;
  if (endDate) return `until ${endDate}`;
  return '';
}

function StatsCard({
  title,
  value,
  subtext,
  icon: Icon,
  detail,
}: {
  title: string;
  value: string;
  subtext: string;
  icon: ComponentType<{ className?: string }>;
  detail?: string;
}) {
  return (
    <div className="rounded-2xl border border-ink-100 bg-white px-5 py-4 shadow-sm shadow-ink-100/60">
      <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-ink-700/60">
        <Icon className="h-3.5 w-3.5 text-clay-600" />
        {title}
      </div>
      <p className="mt-2 font-mono text-2xl font-semibold leading-none tracking-tight text-ink-900 md:text-[1.75rem]">{value}</p>
      <p className="mt-2 text-sm text-ink-700/80">{subtext}</p>
      {detail && <p className="mt-1 text-xs text-ink-700/60 line-clamp-2">{detail}</p>}
    </div>
  );
}

const SESSIONS_PAGE_SIZE = 200;

function localDateString(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  return match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null;
}

function toLocalDateValue(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function DatePicker({
  value,
  min,
  max,
  language,
  label,
  onChange,
}: {
  value: string;
  min?: string;
  max?: string;
  language: 'en' | 'zh';
  label: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const selected = parseLocalDate(value) || new Date();
    return new Date(selected.getFullYear(), selected.getMonth(), 1);
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const locale = language === 'en' ? 'en-US' : 'zh-CN';

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const firstWeekday = visibleMonth.getDay();
  const daysInMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0).getDate();
  const weekdays = Array.from({ length: 7 }, (_, day) =>
    new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(new Date(2026, 0, 4 + day)),
  );
  const cells = Array.from({ length: firstWeekday + daysInMonth }, (_, index) =>
    index < firstWeekday ? null : index - firstWeekday + 1,
  );

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => {
          if (!open) {
            const selected = parseLocalDate(value);
            if (selected) setVisibleMonth(new Date(selected.getFullYear(), selected.getMonth(), 1));
          }
          setOpen((current) => !current);
        }}
        className="inline-flex min-w-36 items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 hover:border-slate-300 focus:border-clay-500 focus:bg-white focus:outline-none"
      >
        <span>{value || (language === 'en' ? 'Select date' : '选择日期')}</span>
        <CalendarDays className="h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-72 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl shadow-slate-300/40">
          <div className="mb-3 flex items-center justify-between">
            <button type="button" aria-label={language === 'en' ? 'Previous month' : '上个月'} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold text-slate-800">
              {new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(visibleMonth)}
            </span>
            <button type="button" aria-label={language === 'en' ? 'Next month' : '下个月'} onClick={() => setVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1))} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center">
            {weekdays.map((weekday) => <span key={weekday} className="py-1 text-[11px] font-medium text-slate-400">{weekday}</span>)}
            {cells.map((day, index) => {
              if (day === null) return <span key={`empty-${index}`} />;
              const dateValue = toLocalDateValue(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), day));
              const disabled = Boolean((min && dateValue < min) || (max && dateValue > max));
              return (
                <button
                  key={dateValue}
                  type="button"
                  disabled={disabled}
                  onClick={() => { onChange(dateValue); setOpen(false); }}
                  className={`rounded-lg py-1.5 text-xs transition-colors ${dateValue === value ? 'bg-ink-900 text-white' : 'text-slate-700 hover:bg-clay-50'} disabled:cursor-not-allowed disabled:text-slate-300 disabled:hover:bg-transparent`}
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function App() {
  const { language, setLanguage, t } = useLanguage();
  const DATE_PRESETS = [{ label: t('today'), days: 0 }, { label: t('last7'), days: 6 }, { label: t('last30'), days: 29 }];
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traces, setTraces] = useState<TraceWithRaw[]>([]);
  const [sessionsTotal, setSessionsTotal] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [projectMetadata, setProjectMetadata] = useState<ProjectMetadata | null>(null);
  const [projectMetadataLoading, setProjectMetadataLoading] = useState(false);
  const [projectMetadataError, setProjectMetadataError] = useState<string | null>(null);
  const [hierarchyRoot, setHierarchyRoot] = useState<HierarchyNode | null>(null);
  const [sessionDetailsById, setSessionDetailsById] = useState<Record<string, TraceWithRaw>>({});
  const [, setLoadingNodeChildrenIds] = useState<Set<string>>(new Set());
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set());
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const fetchGenerationRef = useRef(0);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const loadMoreGenerationRef = useRef(0);
  const loadMoreAbortRef = useRef<AbortController | null>(null);
  const hierarchyFetchGenerationRef = useRef(0);
  const hierarchyFetchAbortRef = useRef<AbortController | null>(null);
  const hasLoadedInitiallyRef = useRef(false);
  const dateRangeEffectReadyRef = useRef(false);
  const hasActiveDateRange = startDate.length > 0 || endDate.length > 0;
  const activeDateRangeLabel = buildDateRangeLabel(startDate, endDate);

  const fetchHierarchyRoot = useCallback(async () => {
    const generation = ++hierarchyFetchGenerationRef.current;
    hierarchyFetchAbortRef.current?.abort();
    const controller = new AbortController();
    hierarchyFetchAbortRef.current = controller;
    const params = new URLSearchParams();
    const startTime = toStartOfLocalDayISOString(startDate);
    const endTime = toEndOfLocalDayISOString(endDate);
    if (startTime) params.set('start_time', startTime);
    if (endTime) params.set('end_time', endTime);
    if (debouncedQuery) params.set('query', debouncedQuery);
    const queryString = params.toString();

    try {
      const response = await fetch(
        `${API_URL}/api/v1/hierarchy${queryString ? `?${queryString}` : ''}`,
        { signal: controller.signal },
      );
      if (!response.ok) {
        throw new Error('Failed to load hierarchy');
      }
      const hierarchyData = (await response.json()) as HierarchyResponse;
      if (generation !== hierarchyFetchGenerationRef.current) return;
      const firstProjectNodeId = hierarchyData.root?.children?.find((child) => child.type === 'projects-root')?.children?.[0]?.id || null;
      setHierarchyRoot(hierarchyData.root || null);
      setExpandedNodeIds(new Set());
      setSelectedNodeId((existingNodeId) => {
        if (existingNodeId && hierarchyData.root) {
          const stack = [hierarchyData.root];
          while (stack.length > 0) {
            const node = stack.pop();
            if (!node) continue;
            if (node.id === existingNodeId) return existingNodeId;
            if (node.children) stack.push(...node.children);
          }
        }
        return firstProjectNodeId || 'global-root';
      });
    } catch (requestError) {
      const isAbort = requestError instanceof Error && requestError.name === 'AbortError';
      if (generation === hierarchyFetchGenerationRef.current && !isAbort) {
        setError(t('connection'));
      }
    } finally {
      if (generation === hierarchyFetchGenerationRef.current) {
        hierarchyFetchAbortRef.current = null;
      }
    }
  }, [startDate, endDate, debouncedQuery, t]);

  const buildSessionParams = useCallback(
    (offset: number) => {
      const params = new URLSearchParams({ limit: String(SESSIONS_PAGE_SIZE), offset: String(offset) });
      const startTime = toStartOfLocalDayISOString(startDate);
      const endTime = toEndOfLocalDayISOString(endDate);
      if (startTime) params.set('start_time', startTime);
      if (endTime) params.set('end_time', endTime);
      if (debouncedQuery) params.set('query', debouncedQuery);
      return params;
    },
    [startDate, endDate, debouncedQuery],
  );

  const fetchData = useCallback(async () => {
    const generation = ++fetchGenerationRef.current;
    fetchAbortRef.current?.abort();
    loadMoreAbortRef.current?.abort();
    loadMoreGenerationRef.current += 1;
    const controller = new AbortController();
    fetchAbortRef.current = controller;

    setLoading(true);
    setLoadingMore(false);
    setError(null);

    // Snapshot both query strings so state changes cannot alter this request.
    const sessionQuery = buildSessionParams(0).toString();
    const statsParams = new URLSearchParams();
    const startTime = toStartOfLocalDayISOString(startDate);
    const endTime = toEndOfLocalDayISOString(endDate);
    if (startTime) statsParams.set('start_time', startTime);
    if (endTime) statsParams.set('end_time', endTime);
    const statsQuery = statsParams.toString();

    try {
      const [sessionsRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/sessions?${sessionQuery}`, { signal: controller.signal }),
        fetch(`${API_URL}/api/v1/stats/overview?${statsQuery}`, { signal: controller.signal }),
      ]);

      if (!sessionsRes.ok || !statsRes.ok) {
        throw new Error('API request failed');
      }

      const sessionsData = (await sessionsRes.json()) as SessionsResponse;
      const statsData = (await statsRes.json()) as OverviewStats;
      if (generation !== fetchGenerationRef.current) return;

      const transformed = (sessionsData.sessions || []).map(transformSession);
      transformed.sort((a, b) => (b.lastRequestTime || b.startTime) - (a.lastRequestTime || a.startTime));
      setTraces(transformed);
      setSessionsTotal(sessionsData.total ?? transformed.length);
      setStats(statsData);
      setError(null);
      setSelectedTraceId((current) => (
        current && transformed.some((trace) => trace.id === current)
          ? current
          : transformed[0]?.id || null
      ));
    } catch (requestError) {
      const isAbort = requestError instanceof Error && requestError.name === 'AbortError';
      if (generation === fetchGenerationRef.current && !isAbort) {
        setError(t('connection'));
      }
    } finally {
      if (generation === fetchGenerationRef.current) {
        setLoading(false);
        fetchAbortRef.current = null;
      }
    }
  }, [startDate, endDate, buildSessionParams, t]);

  const loadMoreSessions = useCallback(async () => {
    if (loadingMore) return;
    const generation = ++loadMoreGenerationRef.current;
    const refreshGeneration = fetchGenerationRef.current;
    const filterKey = buildSessionParams(0).toString();
    const offset = traces.length;
    loadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    loadMoreAbortRef.current = controller;
    setLoadingMore(true);
    try {
      const response = await fetch(
        `${API_URL}/api/v1/sessions?${buildSessionParams(offset).toString()}`,
        { signal: controller.signal },
      );
      if (!response.ok) throw new Error('API request failed');
      const payload = (await response.json()) as SessionsResponse;
      if (
        generation !== loadMoreGenerationRef.current
        || refreshGeneration !== fetchGenerationRef.current
        || filterKey !== buildSessionParams(0).toString()
      ) return;

      const next = (payload.sessions || []).map(transformSession);
      setSessionsTotal(payload.total ?? offset + next.length);
      setTraces((current) => {
        const seen = new Set(current.map((trace) => trace.id));
        return [...current, ...next.filter((trace) => !seen.has(trace.id))];
      });
    } catch {
      // Keep the current page; full-refresh failures use the main error banner.
    } finally {
      if (generation === loadMoreGenerationRef.current) {
        setLoadingMore(false);
        loadMoreAbortRef.current = null;
      }
    }
  }, [buildSessionParams, traces.length, loadingMore]);

  useEffect(() => {
    if (hasLoadedInitiallyRef.current) return;
    hasLoadedInitiallyRef.current = true;
    void Promise.all([fetchData(), fetchHierarchyRoot()]);
  }, [fetchData, fetchHierarchyRoot]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedQuery(searchQuery.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchQuery]);

  useEffect(() => {
    if (!dateRangeEffectReadyRef.current) {
      dateRangeEffectReadyRef.current = true;
      return;
    }
    if (!hasLoadedInitiallyRef.current) return;
    void Promise.all([fetchData(), fetchHierarchyRoot()]);
  }, [fetchData, fetchHierarchyRoot, startDate, endDate, debouncedQuery]);

  useEffect(() => {
    setSelectedTraceId((current) => current ?? traces[0]?.id ?? null);
  }, [traces]);

  const selectedTrace = useMemo(() => {
    if (selectedTraceId && sessionDetailsById[selectedTraceId]) {
      return sessionDetailsById[selectedTraceId];
    }
    return traces.find((trace) => trace.id === selectedTraceId) || null;
  }, [selectedTraceId, sessionDetailsById, traces]);

  const toggleHierarchyNode = useCallback(async (id: string) => {
    const targetNode = (() => {
      if (!hierarchyRoot) return null;
      const stack: HierarchyNode[] = [hierarchyRoot];
      while (stack.length > 0) {
        const current = stack.pop();
        if (!current) continue;
        if (current.id === id) return current;
        if (current.children) {
          for (const child of current.children) stack.push(child);
        }
      }
      return null;
    })();

    const shouldLoadChildren = Boolean(
      targetNode
      && targetNode.hasChildren
      && targetNode.id.startsWith('session:')
      && (!Array.isArray(targetNode.children) || targetNode.children.length <= 1),
    );

    if (shouldLoadChildren) {
      setLoadingNodeChildrenIds((current) => new Set(current).add(id));
      try {
        const params = new URLSearchParams({ node_id: id });
        const response = await fetch(`${API_URL}/api/v1/hierarchy/children?${params.toString()}`);
        if (!response.ok) {
          throw new Error('Failed to load node children');
        }
        const payload = (await response.json()) as HierarchyChildrenResponse;
        setHierarchyRoot((currentRoot) => (currentRoot ? mergeNodeChildren(currentRoot, id, payload.children) : currentRoot));
      } catch {
        setError(t('connection'));
      } finally {
        setLoadingNodeChildrenIds((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        });
      }
    }

    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, [hierarchyRoot, t]);

  const handleResizeStart = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = leftPanelWidth;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const nextWidth = Math.min(520, Math.max(240, startWidth + (moveEvent.clientX - startX)));
      setLeftPanelWidth(nextWidth);
    };

    const handleMouseUp = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [leftPanelWidth]);

  const handleSelectHierarchyNode = useCallback(
    (node: HierarchyNode) => {
      setSelectedNodeId(node.id);
      if (node.sessionId) {
        setSelectedTraceId(node.sessionId);
        setError(null);
        if (!sessionDetailsById[node.sessionId]) {
          void (async () => {
            try {
              const response = await fetch(
                `${API_URL}/api/v1/sessions/${encodeURIComponent(node.sessionId || '')}?detail=summary`,
              );
              if (!response.ok) {
                throw new Error('Failed to load session detail');
              }
              const payload = (await response.json()) as TraceWithRaw['raw'];
              const normalized = transformSession(payload as SessionsResponse['sessions'][number]);
              setSessionDetailsById((current) => ({ ...current, [node.sessionId as string]: normalized }));
            } catch {
        setError(t('connection'));
            }
          })();
        }
      }
    },
    [sessionDetailsById, t],
  );

  const selectedHierarchyNode = useMemo(() => {
    if (!hierarchyRoot || !selectedNodeId) return null;
    const stack: HierarchyNode[] = [hierarchyRoot];
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      if (current.id === selectedNodeId) return current;
      if (current.children) {
        for (const child of current.children) stack.push(child);
      }
    }
    return null;
  }, [hierarchyRoot, selectedNodeId]);

  const selectedProjectPath = useMemo(() => {
    if (selectedHierarchyNode) {
      return selectedHierarchyNode.projectPath || '';
    }
    return selectedTrace?.projectPath || '';
  }, [selectedHierarchyNode, selectedTrace]);

  useEffect(() => {
    if (!selectedProjectPath) {
      setProjectMetadata(null);
      setProjectMetadataError(null);
      setProjectMetadataLoading(false);
      return;
    }

    const controller = new AbortController();
    const loadProjectMetadata = async () => {
      try {
        setProjectMetadataLoading(true);
        setProjectMetadataError(null);
        const params = new URLSearchParams({ project_path: selectedProjectPath || '' });
        const response = await fetch(`${API_URL}/api/v1/projects/by-path?${params.toString()}`, {
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error('Failed to load project metadata');
        }
        const payload = (await response.json()) as ProjectMetadataResponse;
        setProjectMetadata(payload);
      } catch (error) {
        if (controller.signal.aborted) return;
        setProjectMetadata(null);
        setProjectMetadataError(error instanceof Error ? error.message : 'Failed to load project metadata');
      } finally {
        if (!controller.signal.aborted) {
          setProjectMetadataLoading(false);
        }
      }
    };

    void loadProjectMetadata();
    return () => controller.abort();
  }, [selectedProjectPath]);

  const hasActiveSessionFilters = searchQuery.length > 0;
  const hasMoreSessions = traces.length < sessionsTotal;

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm shadow-slate-200">
          <h1 className="text-2xl font-semibold text-red-600 mb-4">连接错误</h1>
          <p className="text-slate-600 mb-4">{error}</p>
          <button onClick={() => void fetchData()} className="px-4 py-2 bg-clay-600 text-white hover:bg-clay-700 rounded-xl transition-colors shadow-sm">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-ink-900">
      <header className="border-b border-ink-100 bg-white/92 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-ink-900 text-clay-200">
                <LayoutDashboard className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h1 className="text-xl font-bold tracking-tight text-ink-900">
                  Agent<span className="text-clay-600">Lens</span>
                </h1>
                <p className="font-mono text-[11px] text-ink-700/60">local session intelligence</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-ink-700/70">
              {stats && <span className="hidden font-mono text-xs xl:inline">{formatInteger(stats.total_sessions)} sessions</span>}
              <button onClick={() => void Promise.all([fetchData(), fetchHierarchyRoot()])} className="rounded-xl border border-ink-100 bg-white p-2 text-ink-700 hover:border-ink-200 hover:bg-ink-50 transition-colors shadow-sm" disabled={loading}>
                <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')} className="rounded-xl border border-ink-100 bg-white px-3 py-2 text-xs font-medium text-ink-700 hover:bg-ink-50">{t('toggle')}</button>
            </div>
          </div>
        </div>
      </header>

      {stats && (
        <section className="border-b border-ink-100 bg-transparent">
          <div className="mx-auto max-w-7xl px-4 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
              <StatsCard
                title="Sessions"
                value={formatInteger(stats.total_sessions)}
                subtext={`${stats.total_projects} projects`}
                icon={Activity}
              />
              <StatsCard
                title="Tokens"
                value={formatTokens(stats.total_tokens)}
                subtext={`${formatInteger(stats.total_llm_calls)} LLM calls`}
                icon={BarChart3}
              />
              <StatsCard
                title="Cost"
                value={`$${stats.total_cost.toFixed(2)}`}
                subtext={`${formatInteger(stats.total_tool_calls)} tools`}
                icon={LayoutDashboard}
              />
            </div>
          </div>
        </section>
      )}

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-5">
        <section className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm shadow-ink-100/60">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-xl bg-ink-900 px-4 py-2 text-sm font-medium text-paper shadow-sm">
                <Activity className="h-4 w-4 text-clay-200" />
                {t('inbox')}
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  <Filter className="h-4 w-4" />
                  <span className="text-slate-700">{t('activeBetween')}</span>
                </div>
                {DATE_PRESETS.map((preset) => {
                  const presetStart = localDateString(preset.days);
                  const presetEnd = localDateString(0);
                  const isActive = startDate === presetStart && endDate === presetEnd;
                  return (
                    <button
                      key={preset.label}
                      onClick={() => {
                        setStartDate(presetStart);
                        setEndDate(presetEnd);
                      }}
                      className={`rounded-full px-3 py-1.5 text-sm transition-colors ${
                        isActive
                          ? 'bg-ink-900 text-white'
                          : 'border border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900'
                      }`}
                    >
                      {preset.label}
                    </button>
                  );
                })}
                <DatePicker
                  value={startDate}
                  onChange={setStartDate}
                  max={endDate || undefined}
                  language={language}
                  label={language === 'en' ? 'Start date' : '开始日期'}
                />
                <span className="text-sm text-slate-400">→</span>
                <DatePicker
                  value={endDate}
                  onChange={setEndDate}
                  min={startDate || undefined}
                  language={language}
                  label={language === 'en' ? 'End date' : '结束日期'}
                />
                {hasActiveDateRange && (
                  <button
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  >
                    <X className="h-3.5 w-3.5" /> {t('reset')}
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end xl:min-w-[28rem]">
                <div className="relative flex-1 xl:min-w-[22rem]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder={t('search')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-clay-500 focus:bg-white focus:outline-none"
                  />
                </div>

                {hasActiveSessionFilters && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  >
                    <X className="h-3.5 w-3.5" /> {t('clear')}
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>
              {t('showing')} <span className="font-mono text-slate-900">{formatInteger(traces.length)}</span> {t('of')}{' '}
              <span className="font-mono text-slate-900">{formatInteger(sessionsTotal)}</span> matching sessions
            </span>
            {hasMoreSessions && (
              <button
                onClick={() => void loadMoreSessions()}
                disabled={loadingMore}
                className="rounded-xl border border-ink-100 bg-white px-3 py-1 text-ink-700 hover:border-ink-200 hover:bg-ink-50 disabled:opacity-50"
              >
                {loadingMore ? t('loading') : `${t('loadMore')} (${formatInteger(sessionsTotal - traces.length)})`}
              </button>
            )}
            {hasActiveDateRange && (
              <span className="rounded-full border border-clay-100 bg-clay-50 px-3 py-1 text-clay-700">
                {t('dateRange')}: {activeDateRangeLabel}
              </span>
            )}
            {hasActiveSessionFilters && (
              <span className="rounded-full bg-clay-50 px-3 py-1 text-clay-700 border border-clay-100">{t('active')}</span>
            )}
          </div>
        </section>

        <div
          className="grid grid-cols-1 gap-6 lg:[grid-template-columns:minmax(240px,var(--left-panel-width))_12px_minmax(0,1fr)] lg:items-start"
          style={{ '--left-panel-width': `${leftPanelWidth}px` } as React.CSSProperties}
        >
          <section className="rounded-2xl border border-ink-100 bg-white p-4 shadow-sm shadow-ink-100/60 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
            <HierarchyTree
              root={hierarchyRoot}
              expanded={expandedNodeIds}
              selectedId={selectedNodeId}
              onToggle={toggleHierarchyNode}
              onSelect={handleSelectHierarchyNode}
            />
          </section>

          <div
            className="hidden lg:flex cursor-col-resize items-stretch justify-center select-none"
            onMouseDown={handleResizeStart}
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize left panel"
          >
            <div className="h-full min-h-[24rem] w-1 rounded-full bg-slate-300 shadow-sm transition-colors hover:bg-clay-500" />
          </div>

          <section className="space-y-6 min-w-0">
            <NodeDetailPane
              node={selectedHierarchyNode}
              selectedTrace={selectedTrace}
              projectMetadata={projectMetadata}
              projectMetadataLoading={projectMetadataLoading}
              projectMetadataError={projectMetadataError}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
