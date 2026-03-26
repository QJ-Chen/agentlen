import { useState, useEffect, useMemo } from 'react';
import { LayoutDashboard, Activity, RefreshCw, Menu, X, ChevronDown, ChevronRight, Terminal, MessageSquare, Wrench, Clock, DollarSign, Hash } from 'lucide-react';
import type { Trace, ToolCall, LLMCall } from './types';
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

// Tool Call Detail Component
const ToolCallDetail = ({ tool, index }: { tool: any; index: number }) => {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="border border-slate-700 rounded-lg mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 bg-slate-800 hover:bg-slate-750 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <Wrench className="w-4 h-4 text-blue-400" />
          <span className="font-medium">{tool.name || 'Unknown Tool'}</span>
          <span className={`text-xs px-2 py-0.5 rounded ${
            tool.status === 'success' ? 'bg-green-900 text-green-300' :
            tool.status === 'error' ? 'bg-red-900 text-red-300' :
            'bg-yellow-900 text-yellow-300'
          }`}>
            {tool.status || 'success'}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span>{formatDuration(tool.duration_ms || tool.duration)}</span>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>
      
      {expanded && (
        <div className="px-4 py-3 bg-slate-900 border-t border-slate-700">
          {/* Input */}
          <div className="mb-3">
            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">输入参数</h5>
            <pre className="bg-slate-950 p-3 rounded text-sm text-green-400 overflow-auto max-h-40">
              {JSON.stringify(tool.input || tool.input_args || {}, null, 2)}
            </pre>
          </div>
          
          {/* Output */}
          <div>
            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">输出结果</h5>
            <pre className="bg-slate-950 p-3 rounded text-sm text-blue-400 overflow-auto max-h-40">
              {typeof tool.output === 'string' 
                ? tool.output 
                : JSON.stringify(tool.output || tool.result || 'No output', null, 2)}
            </pre>
          </div>
          
          {/* Error */}
          {tool.error && (
            <div className="mt-3">
              <h5 className="text-xs font-semibold text-red-500 uppercase mb-2">错误</h5>
              <pre className="bg-red-950/30 p-3 rounded text-sm text-red-400 overflow-auto">
                {tool.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// LLM Call Detail Component
const LLMCallDetail = ({ call, index }: { call: any; index: number }) => {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className="border border-slate-700 rounded-lg mb-2 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 bg-slate-800 hover:bg-slate-750 flex items-center justify-between text-left"
      >
        <div className="flex items-center gap-3">
          <MessageSquare className="w-4 h-4 text-purple-400" />
          <span className="font-medium">{call.model || 'LLM Call'}</span>
          <span className="text-xs text-gray-400">
            {(call.inputTokens || call.input_tokens || 0).toLocaleString()} → {(call.outputTokens || call.output_tokens || 0).toLocaleString()} tokens
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-400">
          <span className="text-yellow-400">${(call.cost || call.cost_usd || 0).toFixed(4)}</span>
          <span>{formatDuration(call.duration_ms || call.duration)}</span>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>
      </button>
      
      {expanded && (
        <div className="px-4 py-3 bg-slate-900 border-t border-slate-700">
          {/* Prompt */}
          <div className="mb-3">
            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">提示词 (Prompt)</h5>
            <pre className="bg-slate-950 p-3 rounded text-sm text-gray-300 overflow-auto max-h-60 whitespace-pre-wrap">
              {call.prompt || call.input || 'No prompt recorded'}
            </pre>
          </div>
          
          {/* Response */}
          <div>
            <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">响应 (Response)</h5>
            <pre className="bg-slate-950 p-3 rounded text-sm text-blue-300 overflow-auto max-h-60 whitespace-pre-wrap">
              {call.response || call.output || call.result || 'No response recorded'}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

// Trace Detail Component with full call chain
const TraceDetail = ({ trace }: { trace: Trace & { raw?: any } }) => {
  const [activeTab, setActiveTab] = useState<'overview' | 'tools' | 'llm' | 'raw'>('overview');
  
  // Parse tool_calls from response if available
  const toolCalls = useMemo(() => {
    if (trace.tools && trace.tools.length > 0) return trace.tools;
    if (trace.raw?.tool_calls) {
      try {
        return JSON.parse(trace.raw.tool_calls);
      } catch { return []; }
    }
    return [];
  }, [trace]);
  
  // Parse LLM calls
  const llmCalls = useMemo(() => {
    if (trace.llmCalls && trace.llmCalls.length > 0) return trace.llmCalls;
    return [{
      model: trace.raw?.model || 'unknown',
      prompt: trace.raw?.prompt || '',
      response: trace.raw?.response || '',
      inputTokens: trace.raw?.input_tokens || 0,
      outputTokens: trace.raw?.output_tokens || 0,
      cost: trace.raw?.cost_usd || 0,
      duration_ms: trace.raw?.duration_ms || 0
    }];
  }, [trace]);
  
  return (
    <div className="bg-slate-800 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-750 border-b border-slate-700">
        <h3 className="text-lg font-semibold">{trace.agentName}</h3>
        <div className="text-sm text-gray-400 mt-1">
          <span className={`inline-block w-2 h-2 rounded-full mr-2 ${
            trace.status === 'completed' ? 'bg-green-500' :
            trace.status === 'failed' ? 'bg-red-500' :
            'bg-yellow-500'
          }`} />
          {trace.status} | {trace.platform} | {formatTime(trace.startTime)}
        </div>
      </div>
      
      {/* Tabs */}
      <div className="flex border-b border-slate-700">
        {['overview', 'tools', 'llm', 'raw'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab as any)}
            className={`px-4 py-2 text-sm font-medium capitalize ${
              activeTab === tab 
                ? 'bg-blue-600 text-white' 
                : 'text-gray-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {tab === 'overview' && '概览'}
            {tab === 'tools' && `工具调用 (${toolCalls.length})`}
            {tab === 'llm' && `LLM 调用 (${llmCalls.length})`}
            {tab === 'raw' && '原始数据'}
          </button>
        ))}
      </div>
      
      {/* Content */}
      <div className="p-4">
        {activeTab === 'overview' && (
          <div className="space-y-4">
            <div className="grid grid-cols-4 gap-3">
              <div className="bg-slate-900 p-3 rounded text-center">
                <Clock className="w-5 h-5 mx-auto mb-1 text-blue-400" />
                <div className="text-lg font-bold">{formatDuration(trace.duration)}</div>
                <div className="text-xs text-gray-500">执行时间</div>
              </div>
              <div className="bg-slate-900 p-3 rounded text-center">
                <Wrench className="w-5 h-5 mx-auto mb-1 text-green-400" />
                <div className="text-lg font-bold">{toolCalls.length}</div>
                <div className="text-xs text-gray-500">工具调用</div>
              </div>
              <div className="bg-slate-900 p-3 rounded text-center">
                <Hash className="w-5 h-5 mx-auto mb-1 text-purple-400" />
                <div className="text-lg font-bold">{trace.totalTokens.toLocaleString()}</div>
                <div className="text-xs text-gray-500">Tokens</div>
              </div>
              <div className="bg-slate-900 p-3 rounded text-center">
                <DollarSign className="w-5 h-5 mx-auto mb-1 text-yellow-400" />
                <div className="text-lg font-bold">${trace.cost.toFixed(4)}</div>
                <div className="text-xs text-gray-500">成本</div>
              </div>
            </div>
            
            {/* Quick Preview */}
            {toolCalls.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-400 mb-2">工具调用预览</h4>
                <div className="space-y-1">
                  {toolCalls.slice(0, 3).map((tool: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <Wrench className="w-3 h-3 text-blue-400" />
                      <span>{tool.name || 'unknown'}</span>
                      <span className="text-gray-500">({formatDuration(tool.duration_ms || tool.duration)})</span>
                    </div>
                  ))}
                  {toolCalls.length > 3 && (
                    <div className="text-xs text-gray-500">+{toolCalls.length - 3} more...</div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
        
        {activeTab === 'tools' && (
          <div>
            {toolCalls.length === 0 ? (
              <div className="text-gray-500 text-center py-8">无工具调用记录</div>
            ) : (
              <div>
                {toolCalls.map((tool: any, index: number) => (
                  <ToolCallDetail key={index} tool={tool} index={index} />
                ))}
              </div>
            )}
          </div>
        )}
        
        {activeTab === 'llm' && (
          <div>
            {llmCalls.map((call: any, index: number) => (
              <LLMCallDetail key={index} call={call} index={index} />
            ))}
          </div>
        )}
        
        {activeTab === 'raw' && (
          <div>
            <pre className="bg-slate-950 p-4 rounded text-xs text-gray-400 overflow-auto max-h-[500px]">
              {JSON.stringify(trace.raw || trace, null, 2)}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
};

// Simple Trace List
const TraceList = ({ traces, selectedId, onSelect }: { 
  traces: Trace[]; 
  selectedId?: string;
  onSelect: (t: Trace & { raw?: any }) => void;
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
            <span className={`text-xs px-2 py-0.5 rounded ${
              trace.status === 'completed' ? 'bg-green-900 text-green-300' :
              trace.status === 'failed' ? 'bg-red-900 text-red-300' :
              'bg-yellow-900 text-yellow-300'
            }`}>
              {trace.status}
            </span>
          </div>
          <div className="text-xs text-gray-400 mt-1">
            {formatTime(trace.startTime)} | {trace.platform}
          </div>
          <div className="flex gap-3 mt-2 text-xs">
            <span className="text-gray-500">{(trace as any).tools?.length || 0} 工具</span>
            <span className="text-gray-500">{trace.totalTokens.toLocaleString()} tokens</span>
            <span className="text-yellow-400">${trace.cost.toFixed(4)}</span>
          </div>
        </div>
      ))}
    </div>
  );
};

function App() {
  const [selectedTrace, setSelectedTrace] = useState<(Trace & { raw?: any }) | null>(null);
  const [traces, setTraces] = useState<(Trace & { raw?: any })[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = async () => {
    try {
      setLoading(true);
      
      const [tracesRes, statsRes] = await Promise.all([
        fetch(`${API_URL}/api/v1/traces?limit=50`),
        fetch(`${API_URL}/api/v1/stats`)
      ]);
      
      const tracesData = await tracesRes.json();
      const statsData = await statsRes.json();
      
      const transformedTraces = (tracesData.traces || []).map((t: any) => ({
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
        raw: t, // Keep raw data for detailed view
      }));
      
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
    const interval = setInterval(fetchData, 3000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-red-400 mb-4">连接错误</h1>
          <p className="text-gray-400 mb-4">{error}</p>
          <button onClick={fetchData} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded">
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
                  {stats.total_traces} traces | {stats.total_tokens?.toLocaleString()} tokens
                </span>
              )}
            </div>
            <button onClick={fetchData} className="p-2 rounded hover:bg-slate-700" disabled={loading}>
              <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left - Trace List */}
          <div className="lg:col-span-1">
            <div className="bg-slate-800 rounded-lg p-4">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Activity className="w-5 h-5 text-blue-500" />
                执行记录 ({traces.length})
              </h2>
              <div className="max-h-[calc(100vh-200px)] overflow-auto">
                <TraceList
                  traces={traces}
                  selectedId={selectedTrace?.id}
                  onSelect={setSelectedTrace}
                />
              </div>
            </div>
          </div>

          {/* Right - Detail */}
          <div className="lg:col-span-2">
            {selectedTrace ? (
              <TraceDetail trace={selectedTrace} />
            ) : (
              <div className="bg-slate-800 rounded-lg p-12 text-center text-gray-400">
                <Terminal className="w-16 h-16 mx-auto mb-4 text-gray-600" />
                <p className="text-lg">选择一个 Trace 查看详细调用过程</p>
                <p className="text-sm text-gray-500 mt-2">包括工具参数、提示词、响应内容等</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
