import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Activity,
  BarChart3,
  Filter,
  LayoutDashboard,
  RefreshCw,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import type { OverviewStats, HierarchyNode, ProjectMetadata } from './types';
import { NodeDetailPane } from './components/NodeDetailPane';
import { HierarchyTree } from './components/HierarchyTree';
import type { HierarchyResponse, ProjectMetadataResponse, SessionsResponse } from './lib/sessionApiTypes';
import { transformSession, type TraceWithRaw } from './lib/sessionNormalization';
import {
  cleanSessionText,
  formatCompactDuration,
  formatInteger,
  formatTokens,
  toEndOfLocalDayISOString,
  toStartOfLocalDayISOString,
} from './lib/sessionUtils';
import './index.css';

const API_URL = 'http://localhost:8080';

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
  color,
  detail,
}: {
  title: string;
  value: string;
  subtext: string;
  icon: ComponentType<{ className?: string }>;
  color: string;
  detail?: string;
}) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white px-5 py-4 shadow-sm shadow-slate-200/70">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-400">{title}</p>
          <p className="mt-2 text-2xl font-semibold leading-none text-slate-950 md:text-[2rem]">{value}</p>
          <p className="mt-2 text-sm text-slate-500">{subtext}</p>
          {detail && <p className="mt-1 text-xs text-slate-400 line-clamp-2">{detail}</p>}
        </div>
        <div className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ${color}`}>
          <Icon className="h-5 w-5 text-white" />
        </div>
      </div>
    </div>
  );
}

function App() {
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [traces, setTraces] = useState<TraceWithRaw[]>([]);
  const [stats, setStats] = useState<OverviewStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [projectMetadata, setProjectMetadata] = useState<ProjectMetadata | null>(null);
  const [projectMetadataLoading, setProjectMetadataLoading] = useState(false);
  const [projectMetadataError, setProjectMetadataError] = useState<string | null>(null);
  const [hierarchyRoot, setHierarchyRoot] = useState<HierarchyNode | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [expandedNodeIds, setExpandedNodeIds] = useState<Set<string>>(new Set(['global-root', 'projects-root']));
  const [leftPanelWidth, setLeftPanelWidth] = useState(320);
  const fetchInFlightRef = useRef<Promise<void> | null>(null);
  const hasLoadedInitiallyRef = useRef(false);
  const dateRangeEffectReadyRef = useRef(false);
  const hasActiveDateRange = startDate.length > 0 || endDate.length > 0;
  const activeDateRangeLabel = buildDateRangeLabel(startDate, endDate);

  const fetchData = useCallback(async () => {
    if (fetchInFlightRef.current) {
      return fetchInFlightRef.current;
    }

    const request = (async () => {
      try {
        setLoading(true);
        const params = new URLSearchParams({ limit: '200' });
        const startTime = toStartOfLocalDayISOString(startDate);
        const endTime = toEndOfLocalDayISOString(endDate);
        if (startTime) params.set('start_time', startTime);
        if (endTime) params.set('end_time', endTime);
        const queryString = params.toString();

        const [sessionsRes, statsRes, hierarchyRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/sessions?${queryString}`),
          fetch(`${API_URL}/api/v1/stats/overview?${queryString}`),
          fetch(`${API_URL}/api/v1/hierarchy`),
        ]);

        if (!sessionsRes.ok || !statsRes.ok || !hierarchyRes.ok) {
          throw new Error('API request failed');
        }

        const sessionsData = (await sessionsRes.json()) as SessionsResponse;
        const statsData = (await statsRes.json()) as OverviewStats;
        const hierarchyData = (await hierarchyRes.json()) as HierarchyResponse;

        const transformed = (sessionsData.sessions || []).map(transformSession);
        transformed.sort((a, b) => (b.lastRequestTime || b.startTime) - (a.lastRequestTime || a.startTime));

        setTraces(transformed);
        setStats(statsData);
        setHierarchyRoot(hierarchyData.root || null);
        setError(null);

        setSelectedTraceId((current) => {
          const nextSelectedId = current && transformed.find((trace) => trace.id === current)?.id
            ? current
            : transformed[0]?.id || null;
          setSelectedNodeId((existingNodeId) => existingNodeId || (transformed[0]?.projectPath ? `project:${transformed[0].projectPath}` : (nextSelectedId ? `session:${nextSelectedId}` : 'global-root')));
          return nextSelectedId;
        });
      } catch {
        setError('无法连接到 AgentLens API 服务器');
      } finally {
        setLoading(false);
        fetchInFlightRef.current = null;
      }
    })();

    fetchInFlightRef.current = request;
    return request;
  }, [startDate, endDate]);

  useEffect(() => {
    if (hasLoadedInitiallyRef.current) return;
    hasLoadedInitiallyRef.current = true;
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    if (!dateRangeEffectReadyRef.current) {
      dateRangeEffectReadyRef.current = true;
      return;
    }
    if (!hasLoadedInitiallyRef.current) return;
    void fetchData();
  }, [fetchData, startDate, endDate]);

  useEffect(() => {
    setSelectedTraceId((current) => current ?? traces[0]?.id ?? null);
  }, [traces]);

  const selectedTrace = useMemo(
    () => traces.find((trace) => trace.id === selectedTraceId) || null,
    [selectedTraceId, traces],
  );

  const toggleHierarchyNode = useCallback((id: string) => {
    setExpandedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

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
      }
    },
    [],
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
    if (selectedHierarchyNode?.projectPath) return selectedHierarchyNode.projectPath;
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

  const selectedProjectSessions = useMemo(() => {
    const projectPath = selectedProjectPath;
    if (!projectPath) return [] as TraceWithRaw[];
    return traces
      .filter((trace) => trace.projectPath === projectPath)
      .sort((a, b) => (b.lastRequestTime || b.startTime) - (a.lastRequestTime || a.startTime));
  }, [selectedProjectPath, traces]);

  const filteredTraces = useMemo(() => {
    return traces.filter((trace) => {
      const matchesSearch =
        !searchQuery ||
        trace.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        trace.sessionId.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (trace.projectPath || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        (trace.projectGroup || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
        cleanSessionText(trace.prompt || '').toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus = statusFilter === 'all' || trace.status === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [traces, searchQuery, statusFilter]);
  const hasActiveSessionFilters = searchQuery.length > 0 || statusFilter !== 'all';
  const selectedTraceVisible = selectedTrace && filteredTraces.some((trace) => trace.id === selectedTrace.id);

  const rangedProjectCount = useMemo(() => new Set(traces.map((trace) => trace.projectPath || '(unknown)')).size, [traces]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-950 flex items-center justify-center p-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center shadow-sm shadow-slate-200">
          <h1 className="text-2xl font-semibold text-red-600 mb-4">连接错误</h1>
          <p className="text-slate-600 mb-4">{error}</p>
          <button onClick={() => void fetchData()} className="px-4 py-2 bg-blue-600 text-white hover:bg-blue-700 rounded-xl transition-colors shadow-sm">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 ring-1 ring-blue-100">
                <LayoutDashboard className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-semibold text-slate-950">AgentLens</h1>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-500">
              {stats && <span className="hidden xl:inline">{formatInteger(stats.total_sessions)} sessions</span>}
              <button onClick={() => void fetchData()} className="rounded-xl border border-slate-200 bg-white p-2 text-slate-600 hover:border-slate-300 hover:bg-slate-50 transition-colors shadow-sm" disabled={loading}>
                <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {stats && (
        <section className="border-b border-slate-200/80 bg-transparent">
          <div className="mx-auto max-w-7xl px-4 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatsCard
                title="Sessions"
                value={formatInteger(stats.total_sessions)}
                subtext={`${rangedProjectCount} projects`}
                icon={Activity}
                color="bg-blue-500"
              />
              <StatsCard
                title="Tokens"
                value={formatTokens(stats.total_tokens)}
                subtext={`${formatInteger(stats.total_llm_calls)} LLM calls`}
                icon={BarChart3}
                color="bg-violet-500"
              />
              <StatsCard
                title="Cost"
                value={`$${stats.total_cost.toFixed(2)}`}
                subtext={`${formatInteger(stats.total_tool_calls)} tools`}
                icon={LayoutDashboard}
                color="bg-emerald-500"
              />
              <StatsCard
                title="Avg duration"
                value={formatCompactDuration(stats.avg_duration_ms)}
                subtext={`${stats.active_days.length} active days`}
                icon={Terminal}
                color="bg-orange-500"
              />
            </div>
          </div>
        </section>
      )}

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-5">
        <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/70">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm shadow-blue-200">
                <Activity className="h-4 w-4" />
                Sessions Inbox
              </div>
            </div>

            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                  <Filter className="h-4 w-4" />
                  <span className="text-slate-700">Started between</span>
                </div>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  max={endDate || undefined}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
                  aria-label="Start date"
                />
                <span className="text-sm text-slate-400">→</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  min={startDate || undefined}
                  className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:bg-white focus:outline-none"
                  aria-label="End date"
                />
                {hasActiveDateRange && (
                  <button
                    onClick={() => {
                      setStartDate('');
                      setEndDate('');
                    }}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  >
                    <X className="h-3.5 w-3.5" /> Reset dates
                  </button>
                )}
              </div>

              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end xl:min-w-[28rem]">
                <div className="relative flex-1 xl:min-w-[22rem]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search session, project, or prompt…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-blue-500 focus:bg-white focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    <Filter className="h-4 w-4" />
                    <span className="text-slate-700">Claude Code only</span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-500">
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent focus:outline-none text-slate-700">
                      <option value="all">All status</option>
                      <option value="completed">completed</option>
                      <option value="failed">failed</option>
                      <option value="running">running</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                  {hasActiveSessionFilters && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setStatusFilter('all');
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-600 hover:border-slate-300 hover:text-slate-900"
                    >
                      <X className="h-3.5 w-3.5" /> Clear
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
            <span>
              Showing <span className="text-slate-900">{formatInteger(filteredTraces.length)}</span> of{' '}
              <span className="text-slate-900">{formatInteger(traces.length)}</span> imported sessions
            </span>
            {hasActiveDateRange && (
              <span className="rounded-full border border-violet-100 bg-violet-50 px-3 py-1 text-violet-700">
                Date range: {activeDateRangeLabel}
              </span>
            )}
            {hasActiveSessionFilters && (
              <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700 border border-blue-100">Inbox filters active</span>
            )}
          </div>
        </section>

        <div
          className="grid grid-cols-1 gap-6 lg:[grid-template-columns:minmax(240px,var(--left-panel-width))_12px_minmax(0,1fr)] lg:items-start"
          style={{ '--left-panel-width': `${leftPanelWidth}px` } as React.CSSProperties}
        >
          <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/70 lg:sticky lg:top-6 lg:self-start lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
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
            <div className="h-full min-h-[24rem] w-1 rounded-full bg-slate-300 shadow-sm transition-colors hover:bg-blue-400" />
          </div>

          <section className="space-y-6 min-w-0">
            <NodeDetailPane
              node={selectedHierarchyNode}
              selectedTrace={selectedTraceVisible && selectedTrace ? selectedTrace : null}
              projectMetadata={projectMetadata}
              projectMetadataLoading={projectMetadataLoading}
              projectMetadataError={projectMetadataError}
              projectSessions={selectedProjectSessions}
              selectedTraceId={selectedTrace?.id}
              onSelectTrace={(traceId) => {
                setSelectedTraceId(traceId || null);
              }}
            />
          </section>
        </div>
      </main>
    </div>
  );
}

export default App;
