import { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, Activity, RefreshCw, Menu, X } from 'lucide-react';
import type { Trace, AgentStats } from './types';
import './index.css';

const API_URL = 'http://localhost:8080';

// Simple Trace List Component
const SimpleTraceList = ({ traces, selectedId, onSelect }: { 
  traces: Trace[]; 
  selectedId?: string;
  onSelect: (t: Trace) => void;
}) => {
  if (traces.length === 0) {
    return <div className="text-gray-400 text-center py-8">暂无数据</div>;
  }
  
  return (
    <div className="space-y-2">
      {traces.map((trace) => (
        <div
          key={trace.id}
          onClick={() => onSelect(trace)}
          className={`p-3 rounded cursor-pointer transition-colors ${
            selectedId === trace.id 
              ? 'bg-blue-600 text-white' 
              : 'bg-slate-800 hover:bg-slate-700'
          }`}
        >
          <div className="flex justify-between items-center">
            <span className="font-medium truncate">{trace.agentName}</span>
            <span className={`text-xs px-2 py-1 rounded ${
              trace.status === 'completed' ? 'bg-green-900 text-green-300' :
              trace.status === 'failed' ? 'bg-red-900 text-red-300' :
              'bg-yellow-900 text-yellow-300'
            }`}>
              {trace.status}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {new Date(trace.startTime).toLocaleTimeString()} | 
            {trace.platform} | 
            {trace.totalTokens.toLocaleString()} tokens
          </div>
        </div>
      ))}
    </div>
  );
};

// Simple Stats Component
const StatsPanel = ({ stats }: { stats: any }) => {
  if (!stats) return <div className="text-gray-400">加载中...</div>;
  
  return (
    <div className="grid grid-cols-2 gap-4">
      <div className="bg-slate-800 p-4 rounded">
        <div className="text-2xl font-bold text-blue-400">{stats.total_traces}</div>
        <div className="text-xs text-gray-400">总 Traces</div>
      </div>
      <div className="bg-slate-800 p-4 rounded">
        <div className="text-2xl font-bold text-green-400">{stats.total_tokens?.toLocaleString()}</div>
        <div className="text-xs text-gray-400">总 Tokens</div>
      </div>
      <div className="bg-slate-800 p-4 rounded">
        <div className="text-2xl font-bold text-yellow-400">${stats.total_cost?.toFixed(4)}</div>
        <div className="text-xs text-gray-400">总成本</div>
      </div>
      <div className="bg-slate-800 p-4 rounded">
        <div className="text-2xl font-bold text-purple-400">{stats.platforms?.length || 0}</div>
        <div className="text-xs text-gray-400">平台数</div>
      </div>
    </div>
  );
};

// Trace Detail Component
const TraceDetail = ({ trace }: { trace: Trace }) => {
  return (
    <div className="bg-slate-800 p-4 rounded space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-2">{trace.agentName}</h3>
        <div className="text-sm text-gray-400 space-y-1">
          <p><span className="text-gray-500">ID:</span> {trace.id}</p>
          <p><span className="text-gray-500">平台:</span> {trace.platform}</p>
          <p><span className="text-gray-500">状态:</span> {trace.status}</p>
          <p><span className="text-gray-500">时间:</span> {new Date(trace.startTime).toLocaleString()}</p>
          <p><span className="text-gray-500">耗时:</span> {trace.duration ? `${trace.duration}ms` : '-'}</p>
        </div>
      </div>
      
      <div className="border-t border-slate-700 pt-4">
        <h4 className="font-medium mb-2">统计</h4>
        <div className="grid grid-cols-3 gap-2 text-sm">
          <div className="bg-slate-900 p-2 rounded text-center">
            <div className="text-blue-400 font-bold">{trace.tools?.length || 0}</div>
            <div className="text-xs text-gray-500">工具调用</div>
          </div>
          <div className="bg-slate-900 p-2 rounded text-center">
            <div className="text-green-400 font-bold">{trace.totalTokens?.toLocaleString()}</div>
            <div className="text-xs text-gray-500">Tokens</div>
          </div>
          <div className="bg-slate-900 p-2 rounded text-center">
            <div className="text-yellow-400 font-bold">${trace.cost?.toFixed(4)}</div>
            <div className="text-xs text-gray-500">成本</div>
          </div>
        </div>
      </div>
    </div>
  );
};

function App() {
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Data states
  const [traces, setTraces] = useState<Trace[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data
  const fetchData = async () => {
    try {
      setLoading(true);
      
      const [tracesRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/traces?limit=50`),
        fetch(`${API_URL}/api/v1/stats`)
      ]);
      
      const tracesData = await tracesRes.json();
      const statsData = await statsRes.json();
      
      // Transform API data
      const transformedTraces: Trace[] = (tracesData.traces || []).map((t: any) => ({
        id: t.trace_id || String(t.id),
        agentId: t.agent_name,
        agentName: t.agent_name,
        platform: t.platform,
        status: t.status === 'error' ? 'failed' : (t.status || 'completed'),
        startTime: new Date(t.start_time).getTime(),
        endTime: t.end_time ? new Date(t.end_time).getTime() : undefined,
        duration: t.duration_ms,
        tools: [],
        llmCalls: [],
        totalTokens: (t.input_tokens || 0) + (t.output_tokens || 0),
        cost: t.cost_usd || 0,
      }));
      
      setTraces(transformedTraces);
      setStats(statsData);
      setError(null);
    } catch (err) {
      setError('无法连接到 API 服务器');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  const selectedTrace = useMemo(
    () => traces.find((t) => t.id === selectedTraceId),
    [traces, selectedTraceId]
  );

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">连接错误</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <p className="text-gray-500 text-sm">请确保 API 服务器运行在 {API_URL}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded"
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
              <LayoutDashboard className="w-6 h-6 text-blue-500" />
              <h1 className="text-xl font-bold">AgentLens</h1>
              {stats && (
                <span className="text-sm text-gray-400 ml-4">
                  Traces: {stats.total_traces} | Tokens: {stats.total_tokens?.toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={fetchData}
                className="p-2 rounded hover:bg-slate-700"
                disabled={loading}
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 rounded hover:bg-slate-700"
              >
                {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        {traces.length === 0 && !loading ? (
          <div className="text-center py-20">
            <Activity className="w-16 h-16 text-gray-600 mx-auto mb-4" />
            <h2 className="text-xl text-gray-400 mb-2">暂无数据</h2>
            <p className="text-gray-500">运行 session_scanner.py 或 workflow_tracer.py 来生成数据</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left - Trace List */}
            <div className="lg:col-span-1">
              <div className="bg-slate-800 rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-500" />
                  执行记录 ({traces.length})
                </h2>
                <div className="max-h-[600px] overflow-auto">
                  <SimpleTraceList
                    traces={traces}
                    selectedId={selectedTraceId}
                    onSelect={(t) => setSelectedTraceId(t.id)}
                  />
                </div>
              </div>
            </div>

            {/* Middle - Stats */}
            <div className="lg:col-span-1">
              <div className="bg-slate-800 rounded-lg p-4">
                <h2 className="text-lg font-semibold mb-4">统计概览</h2>
                <StatsPanel stats={stats} />
                
                {stats?.platforms && (
                  <div className="mt-6">
                    <h3 className="font-medium mb-3">平台分布</h3>
                    <div className="space-y-2">
                      {stats.platforms.map((p: any) => (
                        <div key={p.platform} className="flex justify-between items-center bg-slate-900 p-2 rounded">
                          <span className="text-sm">{p.platform}</span>
                          <span className="text-sm text-gray-400">{p.count} 次</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right - Detail */}
            <div className="lg:col-span-1">
              {selectedTrace ? (
                <TraceDetail trace={selectedTrace} />
              ) : (
                <div className="bg-slate-800 rounded-lg p-8 text-center text-gray-400">
                  <Activity className="w-12 h-12 mx-auto mb-4 text-gray-600" />
                  <p>选择一个 Trace 查看详情</p>
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
