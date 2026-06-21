import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Activity,
  BarChart3,
  ChevronDown,
  ChevronRight,
  Filter,
  LayoutDashboard,
  Network,
  RefreshCw,
  Search,
  Terminal,
  X,
} from 'lucide-react';
import type { OverviewStats, ProjectStats, SubagentLog, Trace } from './types';
import { EnhancedTraceDetail } from './components/EnhancedTraceDetail';
import { AgentInteractionGraph } from './components/AgentInteractionGraph';
import { RealtimeStatusPanel } from './components/RealtimeStatusPanel';
import {
  cleanSessionText,
  formatCompactDuration,
  formatInteger,
  formatTokens,
  shortProjectPath,
} from './lib/sessionUtils';
import './index.css';

const API_URL = 'http://localhost:8080';

type ViewMode = 'sessions' | 'analytics' | 'activity';
type TraceWithRaw = Trace & { raw?: RawSessionRecord };

interface RawToolCall {
  tool_use_id?: string;
  tool_name?: string;
  name?: string;
  timestamp?: string | number;
  duration_ms?: number;
  is_error?: boolean;
  error?: string;
  error_message?: string;
  input?: Record<string, unknown>;
  input_args?: Record<string, unknown>;
  output?: unknown;
  output_result?: unknown;
}

interface RawLLMCall {
  id?: string;
  model?: string;
  start_time?: string | number;
  timestamp?: string | number;
  duration_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  prompt?: string;
  response?: string;
  prompt_id?: string;
}

interface RawSubagentLog {
  id?: string;
  agent_id?: string;
  agent_type?: string;
  description?: string;
  tool_use_id?: string;
  launch_batch_id?: string;
  launch_timestamp?: string | number;
  launch_order?: number;
  launch_prompt_id?: string;
  launch_user_prompt?: string;
  session_file_path?: string;
  start_time?: string | number;
  end_time?: string | number;
  duration_ms?: number;
  status?: string;
  model?: string;
  prompt?: string;
  response?: string;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  tool_calls?: RawToolCall[];
  llm_calls?: RawLLMCall[];
  meta?: Record<string, unknown>;
}

interface RawSessionRecord {
  id?: string | number;
  trace_id?: string;
  session_id?: string;
  agent_name?: string;
  platform?: 'claude-code';
  status?: string;
  start_time?: string | number;
  end_time?: string | number;
  duration_ms?: number;
  tool_calls?: RawToolCall[];
  llm_calls?: RawLLMCall[];
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  cost_usd?: number;
  project_path?: string;
  session_file_path?: string;
  prompt?: string;
  response?: string;
  model?: string;
  metadata?: Record<string, unknown>;
}

interface SessionsResponse {
  sessions: RawSessionRecord[];
}

interface ProjectsResponse {
  projects: ProjectStats[];
}

const DEFAULT_EMPTY_SELECTION = {
  title: 'Select a session to inspect',
  description:
    'Review prompt/response previews, tool activity, model usage, cost, and source provenance for one coding-agent session.',
};

function normalizeStatus(status: string): Trace['status'] {
  if (status === 'failed' || status === 'error' || status === 'timeout') return 'failed';
  if (status === 'running' || status === 'pending') return 'running';
  if (status === 'cancelled' || status === 'canceled') return 'cancelled';
  return 'completed';
}

function normalizeSubagentStatus(status: string): SubagentLog['status'] {
  return normalizeStatus(status) as SubagentLog['status'];
}

function toTimestamp(value?: string | number | null): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  if (typeof value === 'number') {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? undefined : parsed;
}

function buildMergedTools(record: RawSessionRecord | RawSubagentLog, recordStartTime: number) {
  const merged = new Map<string, {
    id: string;
    name: string;
    startTime: number;
    endTime: number;
    duration: number;
    status: 'success' | 'error' | 'pending';
    input?: Record<string, unknown>;
    output?: unknown;
    error?: string;
  }>();

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
      };

      base.name = tool.name || tool.tool_name || base.name;
      base.input = tool.input || tool.input_args || base.input;
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
    });
  });

  return Array.from(merged.values()).sort((a, b) => a.startTime - b.startTime);
}

function buildLLMCalls(record: RawSessionRecord | RawSubagentLog, recordStartTime: number) {
  return (record.llm_calls || []).map((call, idx) => {
    const startTime = toTimestamp(call.start_time || call.timestamp) ?? recordStartTime;
    const duration = call.duration_ms || 0;
    const inputTokens = call.input_tokens || 0;
    const outputTokens = call.output_tokens || 0;
    return {
      id: call.id || `llm-${idx}`,
      model: call.model || record.model || 'unknown',
      startTime,
      endTime: startTime + duration,
      duration,
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      cost: call.cost_usd || 0,
      status: call.response ? 'success' : 'streaming',
      prompt: call.prompt || '',
      response: call.response || '',
      promptId: call.prompt_id || '',
    } as const;
  });
}

function normalizeSubagentLog(subagent: RawSubagentLog): SubagentLog {
  const startTime = toTimestamp(subagent.start_time) ?? 0;
  const endTime = toTimestamp(subagent.end_time);
  const duration = subagent.duration_ms || (endTime ? Math.max(0, endTime - startTime) : 0);
  const toolCalls = buildMergedTools(subagent, startTime);
  const llmCalls = buildLLMCalls(subagent, startTime);
  const inputTokens = subagent.input_tokens || 0;
  const outputTokens = subagent.output_tokens || 0;

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
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: subagent.cost_usd || 0,
    toolCalls,
    llmCalls,
    meta: subagent.meta || {},
  };
}

function transformSession(record: RawSessionRecord): TraceWithRaw {
  const recordStartTime = toTimestamp(record.start_time) ?? 0;

  const tools = buildMergedTools(record, recordStartTime);
  const llmCalls = buildLLMCalls(record, recordStartTime);
  const rawSubagentLogs = Array.isArray(record.metadata?.subagent_logs)
    ? (record.metadata?.subagent_logs as RawSubagentLog[])
    : [];
  const subagentLogs = rawSubagentLogs.map(normalizeSubagentLog);

  const startTime = recordStartTime || Date.now();
  const endTime = toTimestamp(record.end_time);
  const lastRequestTime =
    Math.max(
      startTime,
      ...tools.map((tool) => tool.endTime || tool.startTime),
      ...llmCalls.map((call) => call.endTime || call.startTime),
    ) || startTime;

  return {
    id: record.trace_id || record.session_id || String(record.id || startTime),
    sessionId: record.session_id || record.trace_id || String(record.id || startTime),
    agentId: record.agent_name || record.platform || 'claude-code',
    agentName: record.agent_name || 'claude-code',
    platform: record.platform || 'claude-code',
    status: normalizeStatus(record.status || 'completed'),
    startTime,
    endTime,
    lastRequestTime,
    duration: record.duration_ms || 0,
    tools,
    llmCalls,
    subagentLogs,
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
  const promptPreview =
    cleanSessionText(trace.llmCalls[0]?.prompt || trace.prompt || '').replace(/\n/g, ' ').slice(0, 100) ||
    'No prompt preview';
  const projectLabel = shortProjectPath(trace.projectPath);

  return (
    <button
      onClick={onClick}
      className={`w-full text-left rounded-xl border p-3 transition-all ${
        isSelected
          ? 'bg-blue-600/20 border-blue-500 shadow-lg shadow-blue-900/20'
          : 'bg-slate-800/70 hover:bg-slate-800 border-slate-700/60 hover:border-slate-600'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium leading-6 ${isSelected ? 'text-white' : 'text-gray-100'}`}>💬 {promptPreview}</div>
          {!hideProjectLabel && projectLabel && (
            <div className={`text-xs mt-2 truncate ${isSelected ? 'text-blue-200' : 'text-slate-500'}`}>📁 {projectLabel}</div>
          )}
        </div>
        {trace.status !== 'completed' && <StatusBadge status={trace.status} compact selected={isSelected} />}
      </div>

      <div className={`mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] ${isSelected ? 'text-blue-100' : 'text-slate-500'}`}>
        <span>🆔 {trace.sessionId}</span>
        <span>{trace.llmCalls.length} LLM</span>
        <span>{trace.tools.length} tools</span>
        <span>{formatTokens(trace.totalTokens)}</span>
        <span className={isSelected ? 'text-emerald-200' : 'text-emerald-400'}>${trace.cost.toFixed(4)}</span>
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
    <div className="rounded-2xl border border-slate-700/60 bg-slate-800/80 px-4 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] uppercase tracking-[0.16em] text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-bold leading-none text-white md:text-[2rem]">{value}</p>
          <p className="mt-2 text-sm text-slate-400">{subtext}</p>
          {detail && <p className="mt-1 text-xs text-slate-500 line-clamp-2">{detail}</p>}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${color}`}>
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
  const [projects, setProjects] = useState<ProjectStats[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('sessions');
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const [sessionsRes, statsRes, projectsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/sessions?limit=200`),
        fetch(`${API_URL}/api/v1/stats/overview`),
        fetch(`${API_URL}/api/v1/stats/projects`),
      ]);

      if (!sessionsRes.ok || !statsRes.ok || !projectsRes.ok) {
        throw new Error('API request failed');
      }

      const sessionsData = (await sessionsRes.json()) as SessionsResponse;
      const statsData = (await statsRes.json()) as OverviewStats;
      const projectsData = (await projectsRes.json()) as ProjectsResponse;

      const transformed = (sessionsData.sessions || []).map(transformSession);
      transformed.sort((a, b) => (b.lastRequestTime || b.startTime) - (a.lastRequestTime || a.startTime));

      setTraces(transformed);
      setStats(statsData);
      setProjects(projectsData.projects || []);
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
    }
  }, []);

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
  const hasActiveFilters = searchQuery.length > 0 || statusFilter !== 'all';
  const selectedTraceVisible = selectedTrace && filteredTraces.some((trace) => trace.id === selectedTrace.id);

  const selectedProjectCount = useMemo(() => new Set(filteredTraces.map((trace) => trace.projectPath || '(unknown)')).size, [filteredTraces]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="max-w-md rounded-2xl border border-red-900/40 bg-slate-900 p-8 text-center shadow-xl">
          <h1 className="text-2xl font-bold text-red-400 mb-4">连接错误</h1>
          <p className="text-slate-300 mb-4">{error}</p>
          <button onClick={() => void fetchData()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors">
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-50 border-b border-slate-800/80 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600/15 text-blue-400 ring-1 ring-blue-500/20">
                <LayoutDashboard className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <h1 className="text-2xl font-bold text-white">AgentLens</h1>
                <p className="text-sm text-slate-400">Local-first Claude Code session intelligence</p>
              </div>
            </div>

            <div className="flex items-center gap-2 text-sm text-slate-400">
              {stats && <span className="hidden xl:inline">{formatInteger(stats.total_sessions)} sessions tracked</span>}
              <button onClick={() => void fetchData()} className="rounded-xl border border-slate-700/70 bg-slate-900/70 p-2 hover:border-slate-600 hover:bg-slate-800 transition-colors" disabled={loading}>
                <RefreshCw className={`h-5 w-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {stats && (
        <section className="border-b border-slate-900/50 bg-slate-950">
          <div className="mx-auto max-w-7xl px-4 py-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <StatsCard
                title="Sessions"
                value={formatInteger(stats.total_sessions)}
                subtext="Recent imported sessions"
                detail={`${selectedProjectCount} visible projects in current view`}
                icon={Activity}
                color="bg-blue-500"
              />
              <StatsCard
                title="Tokens"
                value={formatTokens(stats.total_tokens)}
                subtext={`${formatInteger(stats.total_llm_calls)} LLM calls observed`}
                detail="Prompt + completion usage across imported sessions"
                icon={BarChart3}
                color="bg-violet-500"
              />
              <StatsCard
                title="Cost"
                value={`$${stats.total_cost.toFixed(2)}`}
                subtext={`${formatInteger(stats.total_tool_calls)} tool events captured`}
                detail="Local forensic view of spend, not a billing source of truth"
                icon={LayoutDashboard}
                color="bg-emerald-500"
              />
              <StatsCard
                title="Avg duration"
                value={formatCompactDuration(stats.avg_duration_ms)}
                subtext={`${stats.active_days.length} active days in this window`}
                detail="Derived from imported session timestamps"
                icon={Terminal}
                color="bg-orange-500"
              />
            </div>
          </div>
        </section>
      )}

      <main className="mx-auto max-w-7xl px-4 py-5 space-y-5">
        <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-3 shadow-lg shadow-slate-950/40">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { id: 'sessions', label: 'Sessions Inbox', icon: Activity },
                { id: 'analytics', label: 'Analytics', icon: Network },
                { id: 'activity', label: 'Recent Activity', icon: Terminal },
              ].map((mode) => (
                <button
                  key={mode.id}
                  onClick={() => setViewMode(mode.id as ViewMode)}
                  className={`inline-flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                    viewMode === mode.id
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-950/40'
                      : 'bg-slate-800/70 text-slate-300 hover:bg-slate-800 hover:text-white'
                  }`}
                >
                  <mode.icon className="h-4 w-4" />
                  {mode.label}
                </button>
              ))}
            </div>

            {viewMode === 'sessions' && (
              <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-end xl:min-w-[28rem]">
                <div className="relative flex-1 xl:min-w-[22rem]">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    placeholder="Search session, project, or prompt…"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full rounded-xl border border-slate-700 bg-slate-950/80 py-2 pl-10 pr-4 text-sm text-white placeholder:text-slate-500 focus:border-blue-500 focus:outline-none"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-400">
                    <Filter className="h-4 w-4" />
                    <span className="text-slate-200">Claude Code only</span>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/70 px-3 py-2 text-sm text-slate-400">
                    <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="bg-transparent focus:outline-none text-slate-200">
                      <option value="all">All status</option>
                      <option value="completed">completed</option>
                      <option value="failed">failed</option>
                      <option value="running">running</option>
                      <option value="cancelled">cancelled</option>
                    </select>
                  </div>
                  {hasActiveFilters && (
                    <button
                      onClick={() => {
                        setSearchQuery('');
                        setStatusFilter('all');
                      }}
                      className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-sm text-slate-300 hover:border-slate-600 hover:text-white"
                    >
                      <X className="h-3.5 w-3.5" /> Clear
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {viewMode === 'sessions' && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-slate-400">
              <span>
                Showing <span className="text-slate-100">{formatInteger(filteredTraces.length)}</span> of{' '}
                <span className="text-slate-100">{formatInteger(traces.length)}</span> imported sessions
              </span>
              {hasActiveFilters && <span className="rounded-full bg-blue-500/10 px-3 py-1 text-blue-300">Filters active</span>}
            </div>
          )}
        </section>

        {viewMode === 'sessions' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/30 xl:sticky xl:top-[13rem] xl:self-start">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-white">Sessions Inbox</h2>
                  <p className="text-sm text-slate-400">Imported local agent sessions ready for replay and debugging</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={expandAllGroups}
                    className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    Expand all
                  </button>
                  <button
                    onClick={collapseAllGroups}
                    className="rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-1.5 text-xs text-slate-300 hover:border-slate-600 hover:text-white"
                  >
                    Collapse all
                  </button>
                  <span className="rounded-full bg-slate-800 px-3 py-1 text-xs text-slate-300">{formatInteger(filteredTraces.length)}</span>
                </div>
              </div>

              <div className="space-y-3 max-h-[calc(100vh-21rem)] overflow-auto pr-1">
                {filteredTraces.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/70 p-8 text-center text-slate-400">
                    <Terminal className="mx-auto mb-3 h-10 w-10 text-slate-600" />
                    <p className="text-base font-medium text-slate-200">No sessions match the current filters</p>
                    <p className="mt-2 text-sm">Click the refresh button to load the latest Claude Code sessions.</p>
                  </div>
                ) : (
                  groupedTraces.map((group) => {
                    const isCollapsed = !!collapsedGroups[group.key];
                    return (
                      <div key={group.key} className="rounded-2xl border border-slate-800/80 bg-slate-950/40 p-3">
                        <button
                          onClick={() => toggleGroupCollapsed(group.key)}
                          className="mb-3 flex w-full items-start justify-between gap-3 text-left"
                        >
                          <div className="min-w-0 flex items-start gap-2">
                            <div className="mt-0.5 text-slate-400">
                              {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                            </div>
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-white truncate">{group.label}</div>
                              <div className="text-[11px] text-slate-500 truncate font-mono">{group.key}</div>
                            </div>
                          </div>
                          <span className="rounded-full bg-slate-800 px-2.5 py-1 text-[11px] text-slate-300">{formatInteger(group.traces.length)}</span>
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
                <div className="flex min-h-[34rem] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 p-10 text-center shadow-inner shadow-slate-950/20">
                  <div className="max-w-md">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/70 text-slate-500">
                      <Terminal className="h-8 w-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-white">{DEFAULT_EMPTY_SELECTION.title}</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400">{DEFAULT_EMPTY_SELECTION.description}</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}

        {viewMode === 'analytics' && (
          <div className="space-y-6">
            <AgentInteractionGraph traces={traces} selectedTraceId={selectedTrace?.id} onSelectTrace={(trace) => setSelectedTraceId(trace.id)} />

            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
                <h3 className="text-lg font-semibold text-white">Top Tools</h3>
                <p className="mt-1 text-sm text-slate-400">Most frequently observed tool calls across imported sessions.</p>
                <div className="mt-4 space-y-2">
                  {(stats?.top_tools || []).map((tool) => (
                    <div key={tool.name} className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-3 py-3 text-sm">
                      <span className="text-slate-200">{tool.name}</span>
                      <span className="text-slate-400">{formatInteger(tool.count)}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
                <h3 className="text-lg font-semibold text-white">Project Rollups</h3>
                <p className="mt-1 text-sm text-slate-400">Project-level usage, activity, and spend for the imported sessions.</p>
                <div className="mt-4 space-y-3 max-h-96 overflow-auto pr-1">
                  {projects.slice(0, 12).map((project) => (
                    <div key={project.project_path} className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-4 text-sm">
                      <div className="font-medium text-white break-all">{project.project_path}</div>
                      <div className="mt-2 text-slate-400">
                        {project.session_count} sessions · {formatTokens(project.total_tokens)} · ${project.total_cost.toFixed(4)}
                      </div>
                      <div className="mt-1 text-xs text-slate-500">Average duration {formatCompactDuration(project.avg_duration_ms)}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {viewMode === 'activity' && (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[360px_minmax(0,1fr)]">
            <section className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4 shadow-lg shadow-slate-950/30">
              <RealtimeStatusPanel traces={traces} selectedTraceId={selectedTrace?.id} onSelectTrace={(trace) => setSelectedTraceId(trace.id)} />
            </section>
            <section className="space-y-6">
              {selectedTrace ? (
                <EnhancedTraceDetail trace={selectedTrace} />
              ) : (
                <div className="flex min-h-[34rem] items-center justify-center rounded-2xl border border-dashed border-slate-800 bg-slate-900/50 p-10 text-center shadow-inner shadow-slate-950/20">
                  <div className="max-w-md">
                    <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-slate-800/70 text-slate-500">
                      <Terminal className="h-8 w-8" />
                    </div>
                    <h3 className="text-xl font-semibold text-white">Review recent session activity</h3>
                    <p className="mt-3 text-sm leading-6 text-slate-400">Choose a recent session to inspect the latest tool and model activity in context.</p>
                  </div>
                </div>
              )}
            </section>
          </div>
        )}
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
