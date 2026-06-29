import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Filter,
  LayoutDashboard,
  RefreshCw,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import type { OverviewStats, Trace } from './types';
import { EnhancedTraceDetail } from './components/EnhancedTraceDetail';
import type { SessionsResponse } from './lib/sessionApiTypes';
import { transformSession, type TraceWithRaw } from './lib/sessionNormalization';
import {
  cleanSessionText,
  formatCompactDuration,
  formatInteger,
  formatTimestamp,
  formatTokens,
  shortProjectPath,
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

const DEFAULT_EMPTY_SELECTION = {
  title: 'Select a session to inspect',
  description: 'Choose a session from the list.',
};

function TraceListItem({
  trace,
  isSelected,
  onClick,
  hideProjectLabel = false,
}: {
  trace: TraceWithRaw;
  isSelected: boolean;
  onClick: () => void;
  hideProjectLabel?: boolean;
}) {
  const projectLabel = shortProjectPath(trace.projectPath);
  const createdLabel = formatTimestamp(trace.createdAt || trace.startTime);
  const modifiedLabel = formatTimestamp(trace.lastUpdatedAt || trace.lastRequestTime);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-2xl border px-4 py-3 transition-all ${
        isSelected
          ? 'bg-blue-50 border-blue-300 shadow-sm shadow-blue-100'
          : 'bg-white hover:bg-slate-50 border-slate-200 hover:border-slate-300 shadow-sm shadow-slate-200/40'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {!hideProjectLabel && projectLabel && (
            <div className={`text-sm truncate ${isSelected ? 'text-blue-700' : 'text-slate-700'}`}>📁 {projectLabel}</div>
          )}
        </div>
        {trace.status !== 'completed' && <StatusBadge status={trace.status} compact selected={isSelected} />}
      </div>

      <div className={`mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${isSelected ? 'text-blue-700' : 'text-slate-500'}`}>
        <span>🆔 {trace.sessionId}</span>
        <span>Modified {modifiedLabel}</span>
        <span>Created {createdLabel}</span>
        <span>{trace.llmCalls.length} LLM</span>
      </div>
    </button>
  );
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
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
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

        const [sessionsRes, statsRes] = await Promise.all([
          fetch(`${API_URL}/api/v1/sessions?${queryString}`),
          fetch(`${API_URL}/api/v1/stats/overview?${queryString}`),
        ]);

        if (!sessionsRes.ok || !statsRes.ok) {
          throw new Error('API request failed');
        }

        const sessionsData = (await sessionsRes.json()) as SessionsResponse;
        const statsData = (await statsRes.json()) as OverviewStats;

        const transformed = (sessionsData.sessions || []).map(transformSession);
        transformed.sort((a, b) => (b.lastRequestTime || b.startTime) - (a.lastRequestTime || a.startTime));

        setTraces(transformed);
        setStats(statsData);
        setError(null);

        setSelectedTraceId((current) => {
          if (current) {
            return transformed.find((trace) => trace.id === current)?.id || transformed[0]?.id || null;
          }
          return transformed[0]?.id || null;
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
  const groupedTraces = useMemo(() => {
    const groups = new Map<string, { key: string; label: string; traces: TraceWithRaw[] }>();

    filteredTraces.forEach((trace) => {
      const groupKey = trace.projectGroup || trace.projectPath || '(unknown-project-folder)';
      const groupLabel = shortProjectPath(trace.projectPath) || trace.projectPath || 'Unknown project';
      const existing = groups.get(groupKey);
      if (existing) {
        existing.traces.push(trace);
      } else {
        groups.set(groupKey, { key: groupKey, label: groupLabel, traces: [trace] });
      }
    });

    return Array.from(groups.values()).sort((a, b) => {
      const aTime = a.traces[0]?.lastRequestTime || a.traces[0]?.startTime || 0;
      const bTime = b.traces[0]?.lastRequestTime || b.traces[0]?.startTime || 0;
      return bTime - aTime;
    });
  }, [filteredTraces]);

  const toggleGroupCollapsed = useCallback((groupKey: string) => {
    setCollapsedGroups((current) => ({
      ...current,
      [groupKey]: !current[groupKey],
    }));
  }, []);

  const collapseAllGroups = useCallback(() => {
    setCollapsedGroups(
      Object.fromEntries(groupedTraces.map((group) => [group.key, true])) as Record<string, boolean>,
    );
  }, [groupedTraces]);

  const expandAllGroups = useCallback(() => {
    setCollapsedGroups({});
  }, []);
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

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)] xl:items-start">
          <section className="rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/70 xl:sticky xl:top-6 xl:self-start">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-slate-950">Sessions</h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={expandAllGroups}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  >
                    Expand all
                  </button>
                  <button
                    onClick={collapseAllGroups}
                    className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  >
                    Collapse all
                  </button>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600 border border-slate-200">{formatInteger(filteredTraces.length)}</span>
                </div>
              </div>

              <div className="space-y-3 max-h-[calc(100vh-21rem)] overflow-auto pr-1">
                {filteredTraces.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
                    <Terminal className="mx-auto mb-3 h-10 w-10 text-slate-400" />
                    <p className="text-base font-medium text-slate-800">No sessions match the current view</p>
                    <p className="mt-2 text-sm text-slate-500">
                      {hasActiveDateRange ? 'Try widening the selected date range.' : 'Refresh to load the latest sessions.'}
                    </p>
                  </div>
                ) : (
                  groupedTraces.map((group) => {
                    const isCollapsed = !!collapsedGroups[group.key];
                    return (
                      <div key={group.key} className="rounded-2xl border border-slate-200/80 bg-slate-50/90 p-3 shadow-sm shadow-slate-200/40">
                        <button
                          onClick={() => toggleGroupCollapsed(group.key)}
                          className="mb-3 flex w-full items-start justify-between gap-3 text-left"
                        >
                          <div className="min-w-0 flex items-start gap-2">
                            <div className="mt-0.5 text-slate-500">
                              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-900 truncate">{group.label}</div>
                              <div className="text-[11px] text-slate-400 truncate font-mono">{group.key}</div>
                            </div>
                          </div>
                          <span className="rounded-full bg-white px-2.5 py-1 text-[11px] text-slate-600 border border-slate-200">{formatInteger(group.traces.length)}</span>
                        </button>
                        {!isCollapsed && (
                          <div className="space-y-3">
                            {group.traces.map((trace) => (
                              <TraceListItem
                                key={trace.id}
                                trace={trace}
                                isSelected={selectedTrace?.id === trace.id}
                                onClick={() => setSelectedTraceId(trace.id)}
                                hideProjectLabel
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </section>

          <section className="space-y-6">
              {selectedTraceVisible && selectedTrace ? (
                <EnhancedTraceDetail trace={selectedTrace} />
              ) : (
                <div className="flex min-h-[34rem] items-center justify-center rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm shadow-slate-200/60">
                  <div className="max-w-md">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-100 text-slate-500">
                      <Terminal className="h-8 w-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-slate-900">{DEFAULT_EMPTY_SELECTION.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-500">{DEFAULT_EMPTY_SELECTION.description}</p>
                  </div>
                </div>
              )}
          </section>
        </div>
      </main>
    </div>
  );
}

function StatusBadge({
  status,
  compact = false,
  selected = false,
}: {
  status: Trace['status'];
  compact?: boolean;
  selected?: boolean;
}) {
  const classes: Record<Trace['status'], string> = {
    completed: selected ? 'bg-emerald-300 text-emerald-950' : 'bg-emerald-500/15 text-emerald-300',
    failed: selected ? 'bg-red-300 text-red-950' : 'bg-red-500/15 text-red-300',
    running: selected ? 'bg-yellow-300 text-yellow-950' : 'bg-yellow-500/15 text-yellow-300',
    cancelled: selected ? 'bg-slate-300 text-slate-900' : 'bg-slate-500/15 text-slate-300',
  };
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-medium ${classes[status]} ${compact ? '' : ''}`}>{status}</span>;
}

export default App;
