import { useState, useEffect, useMemo } from 'react';
import {
  LayoutDashboard,
  Activity,
  DollarSign,
  Settings,
  Menu,
  X,
  RefreshCw,
} from 'lucide-react';
import { Trace, AgentStats, CostMetrics } from './types';
import { TraceList } from './components/TraceList';
import { TraceTimeline } from './components/TraceTimeline';
import { CostPanel } from './components/CostPanel';
import { AgentSelector } from './components/AgentSelector';
import './index.css';

const API_URL = 'http://localhost:8080';

// Helper to format currency
const formatCost = (cost: number) => `$${cost.toFixed(4)}`;

// Helper to format tokens
const formatTokens = (tokens: number) => tokens.toLocaleString();

function App() {
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  
  // Real data states
  const [traces, setTraces] = useState<Trace[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [agents, setAgents] = useState<AgentStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch data from API
  const fetchData = async () => {
    try {
      setLoading(true);
      
      // Fetch traces
      const tracesRes = await fetch(`${API_URL}/api/v1/traces?limit=50`);
      const tracesData = await tracesRes.json();
      
      // Fetch stats
      const statsRes = await fetch(`${API_URL}/api/v1/stats`);
      const statsData = await statsRes.json();
      
      // Transform API data to Trace format
      const transformedTraces: Trace[] = tracesData.traces.map((t: any) => ({
        id: t.trace_id || String(t.id),
        agentId: t.agent_name,
        agentName: t.agent_name,
        platform: t.platform,
        status: t.status === 'error' ? 'failed' : 'completed',
        startTime: new Date(t.start_time).getTime(),
        endTime: t.end_time ? new Date(t.end_time).getTime() : undefined,
        duration: t.duration_ms,
        tools: JSON.parse(t.tool_calls || '[]'),
        llmCalls: [],
        totalTokens: t.input_tokens + t.output_tokens,
        cost: t.cost_usd,
      }));
      
      // Build agents list from traces
      const agentMap = new Map<string, AgentStats>();
      transformedTraces.forEach((t: Trace) => {
        const existing = agentMap.get(t.agentId);
        if (existing) {
          existing.totalExecutions++;
          existing.totalTokens += t.totalTokens;
          existing.totalCost += t.cost;
          existing.lastActive = Math.max(existing.lastActive, t.startTime);
        } else {
          agentMap.set(t.agentId, {
            agentId: t.agentId,
            agentName: t.agentName,
            platform: t.platform,
            totalExecutions: 1,
            successRate: 0.95,
            avgDuration: t.duration || 0,
            totalTokens: t.totalTokens,
            totalCost: t.cost,
            lastActive: t.startTime,
          });
        }
      });
      
      setTraces(transformedTraces);
      setStats(statsData);
      setAgents(Array.from(agentMap.values()));
      setError(null);
    } catch (err) {
      setError('Failed to fetch data from API');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Initial fetch and polling
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 3000); // Poll every 3 seconds
    return () => clearInterval(interval);
  }, []);

  const filteredTraces = useMemo(() => {
    if (!selectedAgentId) return traces;
    return traces.filter((t) => t.agentId === selectedAgentId);
  }, [traces, selectedAgentId]);

  const selectedTrace = useMemo(
    () => traces.find((t) => t.id === selectedTraceId),
    [traces, selectedTraceId]
  );

  const totalStats = useMemo(() => {
    const filtered = selectedAgentId
      ? traces.filter((t) => t.agentId === selectedAgentId)
      : traces;
    return {
      cost: filtered.reduce((sum, t) => sum + t.cost, 0),
      tokens: filtered.reduce((sum, t) => sum + t.totalTokens, 0),
      requests: filtered.length,
    };
  }, [traces, selectedAgentId]);

  // Generate cost metrics from traces
  const costMetrics: CostMetrics[] = useMemo(() => {
    const daily = new Map<string, { cost: number; tokens: number; requests: number }>();
    
    traces.forEach(t => {
      const date = new Date(t.startTime).toISOString().split('T')[0];
      const existing = daily.get(date) || { cost: 0, tokens: 0, requests: 0 };
      existing.cost += t.cost;
      existing.tokens += t.totalTokens;
      existing.requests += 1;
      daily.set(date, existing);
    });
    
    return Array.from(daily.entries())
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-7);
  }, [traces]);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-slate-100 flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">Connection Error</h1>
          <p className="text-slate-400 mb-4">{error}</p>
          <p className="text-slate-500 text-sm">Make sure the API server is running on {API_URL}</p>
          <button
            onClick={fetchData}
            className="mt-4 px-4 py-2 bg-blue-500 hover:bg-blue-600 rounded-lg flex items-center gap-2 mx-auto"
          >
            <RefreshCw className="w-4 h-4" />
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                <LayoutDashboard className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gradient">AgentLens</h1>
            </div>
            <div className="flex items-center gap-4">
              {stats && (
                <div className="hidden md:flex items-center gap-4 text-sm text-slate-400">
                  <span>Traces: <strong className="text-white">{stats.total_traces}</strong></span>
                  <span>Tokens: <strong className="text-white">{formatTokens(stats.total_tokens)}</strong></span>
                  <span>Cost: <strong className="text-white">{formatCost(stats.total_cost)}</strong></span>
                </div>
              )}
              <button
                onClick={fetchData}
                className="p-2 rounded-lg hover:bg-slate-700 transition-colors"
                disabled={loading}
              >
                <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="lg:hidden p-2 rounded-lg hover:bg-slate-700 transition-colors"
              >
                {sidebarOpen ? (
                  <X className="w-5 h-5" />
                ) : (
                  <Menu className="w-5 h-5" />
                )}
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {traces.length === 0 && !loading ? (
          <div className="text-center py-20">
            <Activity className="w-16 h-16 text-slate-600 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-400 mb-2">No Data Yet</h2>
            <p className="text-slate-500">Start using your agents to see traces here</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Left Sidebar - Agent Selector */}
            <div
              className={`
                lg:col-span-3
                ${sidebarOpen ? 'block' : 'hidden lg:block'}
              `}
            >
              <AgentSelector
                agents={agents}
                selectedAgentId={selectedAgentId}
                onSelectAgent={setSelectedAgentId}
              />
            </div>

            {/* Middle - Trace List */}
            <div className="lg:col-span-4">
              <TraceList
                traces={filteredTraces}
                selectedTraceId={selectedTraceId}
                onSelectTrace={(trace) => setSelectedTraceId(trace.id)}
              />
            </div>

            {/* Right - Trace Timeline or Cost Panel */}
            <div className="lg:col-span-5">
              {selectedTrace ? (
                <TraceTimeline trace={selectedTrace} />
              ) : (
                <CostPanel
                  metrics={costMetrics.length > 0 ? costMetrics : Array.from({length: 7}, (_, i) => {
                    const d = new Date();
                    d.setDate(d.getDate() - (6 - i));
                    return { date: d.toISOString().split('T')[0], cost: 0, tokens: 0, requests: 0 };
                  })}
                  totalCost={totalStats.cost}
                  totalTokens={totalStats.tokens}
                  totalRequests={totalStats.requests}
                />
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
