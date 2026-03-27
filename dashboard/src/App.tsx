import { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Activity,
  RefreshCw,
  Terminal,
  Filter,
  Search,
  BarChart3,
  Network,
} from 'lucide-react';
import type { Trace } from './types';
import { EnhancedTraceDetail } from './components/EnhancedTraceDetail';
import { EnhancedTraceTimeline } from './components/EnhancedTraceTimeline';
import { AgentInteractionGraph } from './components/AgentInteractionGraph';
import { RealtimeStatusPanel } from './components/RealtimeStatusPanel';
import './index.css';

const API_URL = 'http://localhost:8080';

// Format helpers
const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
};

const formatDuration = (ms?: number) => {
  if (!ms) return '-';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
};

// Simple Trace List Item
const TraceListItem = ({
  trace,
  isSelected,
  onClick,
}: {
  trace: Trace & { raw?: any };
  isSelected: boolean;
  onClick: () => void;
}) => (
  <div
    onClick={onClick}
    className={`p-3 rounded-lg cursor-pointer transition-all ${
      isSelected
        ? 'bg-blue-600 text-white shadow-lg'
        : 'bg-slate-800 hover:bg-slate-700 border border-slate-700/50'
    }`}
  >
    <div className="flex items-center justify-between">
      <span className={`font-medium truncate ${isSelected ? 'text-white' : 'text-gray-200'}`}>
        {trace.agentName}
      </span>
      <span
        className={`text-xs px-2 py-0.5 rounded ${
          trace.status === 'completed'
            ? isSelected ? 'bg-emerald-400 text-emerald-900' : 'bg-emerald-900 text-emerald-300'
            : trace.status === 'failed'
            ? isSelected ? 'bg-red-400 text-red-900' : 'bg-red-900 text-red-300'
            : isSelected ? 'bg-yellow-400 text-yellow-900' : 'bg-yellow-900 text-yellow-300'
        }`}
      >
        {trace.status}
      </span>
    </div>
    <div className={`text-xs mt-1 ${isSelected ? 'text-blue-100' : 'text-gray-400'}`}>
      {formatTime(trace.startTime)} · {trace.platform}
    </div>
    <div className={`flex gap-3 mt-2 text-xs ${isSelected ? 'text-blue-100' : 'text-gray-500'}`}>
      <span>{trace.tools?.length || 0} 工具</span>
      <span>{trace.totalTokens.toLocaleString()} tokens</span>
      <span className={isSelected ? 'text-emerald-200' : 'text-emerald-400'}>
        ${trace.cost.toFixed(4)}
      </span>
    </div>
  </div>
);

// Stats Card
const StatsCard = ({
  title,
  value,
  subtext,
  icon: Icon,
  color,
}: {
  title: string;
  value: string;
  subtext: string;
  icon: any;
  color: string;
}) => (
  <div className="bg-slate-800 rounded-lg p-4 border border-slate-700/50">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-400">{title}</p>
        <p className="text-2xl font-bold mt-1">{value}</p>
        <p className="text-xs text-gray-500 mt-1">{subtext}</p>
      </div>
      <div className={`p-3 rounded-lg ${color}`}>
        <Icon className="w-6 h-6 text-white" />
      </div>
    </div>
  </div>
);

// View Mode Type
type ViewMode = 'list' | 'interactions' | 'realtime';

function App() {
  const [selectedTrace, setSelectedTrace] = useState<(Trace & { raw?: any }) | null>(null);
  const [traces, setTraces] = useState<(Trace & { raw?: any })[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [searchQuery, setSearchQuery] = useState('');
  const [platformFilter, setPlatformFilter] = useState<string>('all');

  const fetchData = async () => {
    try {
      setLoading(true);

      const [tracesRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/traces?limit=100`),
        fetch(`${API_URL}/api/v1/stats`),
      ]);

      const tracesData = await tracesRes.json();
      const statsData = await statsRes.json();

      const transformedTraces = (tracesData.traces || []).map((t: any) => {
        // Parse tool_calls from API response
        const tools = (t.tool_calls || []).map((tool: any, idx: number) => ({
          id: tool.tool_use_id || `tool-${idx}`,
          name: tool.name || 'Unknown',
          startTime: tool.timestamp ? new Date(tool.timestamp * 1000).getTime() : new Date(t.start_time).getTime(),
          endTime: tool.timestamp ? new Date(tool.timestamp * 1000).getTime() : new Date(t.end_time || t.start_time).getTime(),
          duration: 0,
          // If tool has a timestamp and the trace is completed, consider it success
          status: t.status === 'success' || t.status === 'completed' ? 'success' : 
                  tool.error ? 'error' : 'success',
          input: tool.input,
          output: tool.output,
        }));

        // Parse llm_calls from response field if exists
        let llmCalls: any[] = [];
        // Get trace-level prompt/response as fallback
        const tracePrompt = t.prompt || '';
        const traceResponse = t.response || '';
        
        if (t.response) {
          try {
            const respData = JSON.parse(t.response);
            const rawLLMCalls = respData.llm_calls || [];
            
            if (rawLLMCalls.length > 0) {
              // Distribute trace-level prompt/response to LLM calls
              llmCalls = rawLLMCalls.map((call: any, idx: number) => {
                // Use call-level prompt/response if available, otherwise use trace-level
                const hasCallPrompt = call.prompt && call.prompt.trim().length > 0;
                const hasCallResponse = call.response && call.response.trim().length > 0;
                
                return {
                  id: `llm-${idx}`,
                  model: call.model || 'unknown',
                  startTime: call.timestamp ? new Date(call.timestamp * 1000).getTime() : new Date(t.start_time).getTime(),
                  endTime: call.timestamp ? new Date(call.timestamp * 1000).getTime() : new Date(t.end_time || t.start_time).getTime(),
                  duration: 0,
                  inputTokens: call.input_tokens || 0,
                  outputTokens: call.output_tokens || 0,
                  totalTokens: (call.input_tokens || 0) + (call.output_tokens || 0),
                  cost: 0,
                  status: call.response ? 'success' : 'streaming',
                  // Use call-level if available, otherwise fall back to trace-level for first/last call
                  prompt: hasCallPrompt ? call.prompt : (idx === 0 ? tracePrompt : ''),
                  response: hasCallResponse ? call.response : (idx === rawLLMCalls.length - 1 ? traceResponse : ''),
                };
              });
            } else if (tracePrompt || traceResponse) {
              // If no llm_calls but trace has prompt/response, create a synthetic LLM call
              llmCalls = [{
                id: 'llm-0',
                model: t.model || 'unknown',
                startTime: new Date(t.start_time).getTime(),
                endTime: t.end_time ? new Date(t.end_time).getTime() : new Date(t.start_time).getTime(),
                duration: t.duration_ms || 0,
                inputTokens: t.input_tokens || 0,
                outputTokens: t.output_tokens || 0,
                totalTokens: (t.input_tokens || 0) + (t.output_tokens || 0),
                cost: t.cost_usd || 0,
                status: t.status === 'success' || t.status === 'completed' ? 'success' : 'streaming',
                prompt: tracePrompt,
                response: traceResponse,
              }];
            }
          } catch (e) {
            // If JSON parse fails but trace has prompt/response, create synthetic LLM call
            if (tracePrompt || traceResponse) {
              llmCalls = [{
                id: 'llm-0',
                model: t.model || 'unknown',
                startTime: new Date(t.start_time).getTime(),
                endTime: t.end_time ? new Date(t.end_time).getTime() : new Date(t.start_time).getTime(),
                duration: t.duration_ms || 0,
                inputTokens: t.input_tokens || 0,
                outputTokens: t.output_tokens || 0,
                totalTokens: (t.input_tokens || 0) + (t.output_tokens || 0),
                cost: t.cost_usd || 0,
                status: t.status === 'success' || t.status === 'completed' ? 'success' : 'streaming',
                prompt: tracePrompt,
                response: traceResponse,
              }];
            }
          }
        }

        return {
          id: t.trace_id || String(t.id),
          agentId: t.agent_name,
          agentName: t.agent_name,
          platform: t.platform,
          status: t.status === 'error' ? 'failed' : t.status || 'completed',
          startTime: new Date(t.start_time).getTime(),
          endTime: t.end_time ? new Date(t.end_time).getTime() : undefined,
          duration: t.duration_ms,
          tools,
          llmCalls,
          totalTokens: (t.input_tokens || 0) + (t.output_tokens || 0),
          cost: t.cost_usd || 0,
          raw: t,
        };
      });

      setTraces(transformedTraces);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError('无法连接到 API 服务器');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 5000);
    return () => clearInterval(interval);
  }, []);

  // Filter traces
  const filteredTraces = useMemo(() => {
    return traces.filter((trace) => {
      const matchesSearch =
        !searchQuery ||
        trace.agentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
        trace.id.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesPlatform =
        platformFilter === 'all' || trace.platform === platformFilter;
      return matchesSearch && matchesPlatform;
    });
  }, [traces, searchQuery, platformFilter]);

  // Get unique platforms
  const platforms = useMemo(() => {
    const set = new Set(traces.map((t) => t.platform));
    return Array.from(set);
  }, [traces]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">连接错误</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <button
            onClick={fetchData}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-white">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <LayoutDashboard className="w-7 h-7 text-blue-500" />
              <h1 className="text-xl font-bold">AgentLens</h1>
              {stats && (
                <span className="text-sm text-gray-400 hidden sm:inline">
                  {stats.total_traces} traces · {stats.total_tokens?.toLocaleString()} tokens · $
                  {stats.total_cost?.toFixed(2)}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchData}
                className="p-2 rounded-lg hover:bg-slate-700 transition-colors"
                disabled={loading}
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Stats Bar */}
      {stats && (
        <div className="bg-slate-800/50 border-b border-slate-700">
          <div className="max-w-7xl mx-auto px-4 py-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatsCard
                title="总 Traces"
                value={stats.total_traces.toString()}
                subtext="最近 24 小时"
                icon={Activity}
                color="bg-blue-500"
              />
              <StatsCard
                title="总 Tokens"
                value={stats.total_tokens?.toLocaleString() || '0'}
                subtext="输入 + 输出"
                icon={BarChart3}
                color="bg-violet-500"
              />
              <StatsCard
                title="总成本"
                value={`$${stats.total_cost?.toFixed(2) || '0'}`}
                subtext="USD"
                icon={LayoutDashboard}
                color="bg-emerald-500"
              />
              <StatsCard
                title="平均耗时"
                value={formatDuration(stats.avg_duration_ms)}
                subtext="每次调用"
                icon={Terminal}
                color="bg-orange-500"
              />
            </div>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {/* View Mode Tabs */}
        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex bg-slate-800 rounded-lg p-1">
            {[
              { id: 'list', label: '列表视图', icon: Activity },
              { id: 'interactions', label: '交互图', icon: Network },
              { id: 'realtime', label: '实时状态', icon: Terminal },
            ].map((mode) => (
              <button
                key={mode.id}
                onClick={() => setViewMode(mode.id as ViewMode)}
                className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${
                  viewMode === mode.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white hover:bg-slate-700'
                }`}
              >
                <mode.icon className="w-4 h-4" />
                {mode.label}
              </button>
            ))}
          </div>

          {/* Search & Filter */}
          {viewMode === 'list' && (
            <>
              <div className="flex-1 min-w-[200px] max-w-md">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    type="text"
                    placeholder="搜索 Agent..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Filter className="w-4 h-4 text-gray-500" />
                <select
                  value={platformFilter}
                  onChange={(e) => setPlatformFilter(e.target.value)}
                  className="bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="all">所有平台</option>
                  {platforms.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* Content Area */}
        {viewMode === 'list' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left - Trace List */}
            <div className="lg:col-span-1">
              <div className="bg-slate-800 rounded-lg p-4 border border-slate-700/50">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-500" />
                  执行记录 ({filteredTraces.length})
                </h2>
                <div className="max-h-[calc(100vh-400px)] overflow-auto space-y-2">
                  {filteredTraces.length === 0 ? (
                    <div className="text-center py-8 text-gray-500">
                      <Terminal className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p>暂无数据</p>
                    </div>
                  ) : (
                    filteredTraces.map((trace) => (
                      <TraceListItem
                        key={trace.id}
                        trace={trace}
                        isSelected={selectedTrace?.id === trace.id}
                        onClick={() => setSelectedTrace(trace)}
                      />
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* Right - Detail */}
            <div className="lg:col-span-2">
              {selectedTrace ? (
                <EnhancedTraceDetail trace={selectedTrace} />
              ) : (
                <div className="bg-slate-800 rounded-lg p-12 text-center text-gray-400 border border-slate-700/50 border-dashed">
                  <Terminal className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                  <p className="text-lg">选择一个 Trace 查看详细调用过程</p>
                  <p className="text-sm text-gray-500 mt-2">
                    包括工具参数、提示词、响应内容等
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {viewMode === 'interactions' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <AgentInteractionGraph
                traces={traces}
                selectedTraceId={selectedTrace?.id}
                onSelectTrace={setSelectedTrace}
              />
            </div>
            <div className="lg:col-span-1">
              {selectedTrace ? (
                <EnhancedTraceDetail trace={selectedTrace} />
              ) : (
                <div className="bg-slate-800 rounded-lg p-8 text-center text-gray-400 border border-slate-700/50 border-dashed">
                  <Network className="w-12 h-12 mx-auto mb-3 text-gray-600" />
                  <p>点击交互图中的 Agent 查看详情</p>
                </div>
              )}
            </div>
          </div>
        )}

        {viewMode === 'realtime' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-1">
              <RealtimeStatusPanel
                traces={traces}
                selectedTraceId={selectedTrace?.id}
                onSelectTrace={setSelectedTrace}
              />
            </div>
            <div className="lg:col-span-2">
              {selectedTrace ? (
                <>
                  <EnhancedTraceDetail trace={selectedTrace} />
                  <div className="mt-6">
                    <h3 className="text-lg font-semibold mb-4">执行时序</h3>
                    <div className="bg-slate-800 rounded-lg p-4 border border-slate-700/50">
                      <EnhancedTraceTimeline trace={selectedTrace} />
                    </div>
                  </div>
                </>
              ) : (
                <div className="bg-slate-800 rounded-lg p-12 text-center text-gray-400 border border-slate-700/50 border-dashed">
                  <Terminal className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                  <p className="text-lg">选择一个运行中的任务查看详情</p>
                </div>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
