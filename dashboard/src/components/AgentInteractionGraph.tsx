import React, { useState, useMemo } from 'react';
import {
  Network,
  Users,
  ArrowRight,
  GitBranch,
  CheckCircle,
  XCircle,
  Loader2,
} from 'lucide-react';
import type { Trace } from '../types';

interface AgentInteractionGraphProps {
  traces: (Trace & { raw?: any })[];
  selectedTraceId?: string;
  onSelectTrace?: (trace: Trace & { raw?: any }) => void;
}

interface AgentNode {
  id: string;
  name: string;
  platform: string;
  x: number;
  y: number;
  color: string;
  stats: {
    calls: number;
    tokens: number;
    cost: number;
    duration: number;
  };
}

interface AgentEdge {
  from: string;
  to: string;
  count: number;
  label: string;
}

export const AgentInteractionGraph: React.FC<AgentInteractionGraphProps> = ({
  traces,
  selectedTraceId,
  onSelectTrace,
}) => {
  const [viewMode, setViewMode] = useState<'flow' | 'tree' | 'matrix'>('flow');
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  // Extract agent interactions from traces
  const { agents, interactions, sessions } = useMemo(() => {
    const agentMap = new Map<string, AgentNode>();
    const edgeMap = new Map<string, AgentEdge>();
    const sessionMap = new Map<string, Trace[]>();

    // Group traces by session
    traces.forEach(trace => {
      const sessionId = trace.raw?.session_id || trace.id;
      if (!sessionMap.has(sessionId)) {
        sessionMap.set(sessionId, []);
      }
      sessionMap.get(sessionId)!.push(trace);
    });

    // Build agent nodes
    traces.forEach(trace => {
      const agentId = trace.agentId || trace.agentName;
      if (!agentMap.has(agentId)) {
        const platformColors: Record<string, string> = {
          'openclaw': '#3b82f6',
          'claude-code': '#f97316',
          'kimi-code': '#8b5cf6',
          'cursor': '#10b981',
        };
        
        agentMap.set(agentId, {
          id: agentId,
          name: trace.agentName,
          platform: trace.platform,
          x: 0,
          y: 0,
          color: platformColors[trace.platform] || '#6b7280',
          stats: { calls: 0, tokens: 0, cost: 0, duration: 0 },
        });
      }
      
      const agent = agentMap.get(agentId)!;
      agent.stats.calls++;
      agent.stats.tokens += trace.totalTokens;
      agent.stats.cost += trace.cost;
      agent.stats.duration += trace.duration || 0;
    });

    // Build interactions (edges)
    sessionMap.forEach((sessionTraces) => {
      // Sort by start time
      sessionTraces.sort((a, b) => a.startTime - b.startTime);
      
      // Create edges between consecutive agents in session
      for (let i = 0; i < sessionTraces.length - 1; i++) {
        const from = sessionTraces[i].agentId || sessionTraces[i].agentName;
        const to = sessionTraces[i + 1].agentId || sessionTraces[i + 1].agentName;
        
        if (from !== to) {
          const edgeKey = `${from}->${to}`;
          if (edgeMap.has(edgeKey)) {
            edgeMap.get(edgeKey)!.count++;
          } else {
            edgeMap.set(edgeKey, {
              from,
              to,
              count: 1,
              label: 'calls',
            });
          }
        }
      }
    });

    // Calculate positions for flow layout
    const agentsList = Array.from(agentMap.values());
    const cols = Math.ceil(Math.sqrt(agentsList.length));
    agentsList.forEach((agent, idx) => {
      agent.x = (idx % cols) * 200 + 100;
      agent.y = Math.floor(idx / cols) * 150 + 100;
    });

    return {
      agents: agentsList,
      interactions: Array.from(edgeMap.values()),
      sessions: Array.from(sessionMap.entries()),
    };
  }, [traces]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatCost = (cost: number) => {
    if (cost < 0.01) return `<$0.01`;
    return `$${cost.toFixed(2)}`;
  };

  // Render Flow View
  const renderFlowView = () => (
    <div className="relative min-h-[400px] overflow-auto">
      <svg className="absolute inset-0 w-full h-full" style={{ minWidth: '600px', minHeight: '400px' }}>
        {/* Draw edges */}
        {interactions.map((edge, idx) => {
          const fromAgent = agents.find(a => a.id === edge.from);
          const toAgent = agents.find(a => a.id === edge.to);
          if (!fromAgent || !toAgent) return null;
          
          return (
            <g key={idx}>
              <line
                x1={fromAgent.x}
                y1={fromAgent.y}
                x2={toAgent.x}
                y2={toAgent.y}
                stroke="#4b5563"
                strokeWidth={Math.min(edge.count * 2, 8)}
                strokeDasharray="5,5"
                markerEnd="url(#arrowhead)"
              />
              <text
                x={(fromAgent.x + toAgent.x) / 2}
                y={(fromAgent.y + toAgent.y) / 2 - 10}
                fill="#9ca3af"
                fontSize="12"
                textAnchor="middle"
              >
                {edge.count} calls
              </text>
            </g>
          );
        })}
        
        {/* Arrow marker */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="28"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#4b5563" />
          </marker>
        </defs>
      </svg>
      
      {/* Draw nodes */}
      {agents.map((agent) => (
        <div
          key={agent.id}
          className={`absolute transform -translate-x-1/2 -translate-y-1/2 cursor-pointer transition-all ${
            selectedAgent === agent.id ? 'scale-110 z-10' : 'hover:scale-105'
          }`}
          style={{ left: agent.x, top: agent.y }}
          onClick={() => setSelectedAgent(selectedAgent === agent.id ? null : agent.id)}
        >
          <div
            className={`w-16 h-16 rounded-full flex items-center justify-center border-4 ${
              selectedAgent === agent.id ? 'border-white' : 'border-transparent'
            }`}
            style={{ backgroundColor: agent.color }}
          >
            <Users className="w-8 h-8 text-white" />
          </div>
          <div className="mt-2 text-center">
            <div className="text-sm font-medium bg-slate-800 px-2 py-1 rounded whitespace-nowrap">
              {agent.name}
            </div>
            <div className="text-xs text-gray-400 mt-1">{agent.stats.calls} calls</div>
          </div>
        </div>
      ))}
    </div>
  );

  // Render Session Flow View
  const renderSessionFlow = () => (
    <div className="space-y-4">
      {sessions.slice(0, 10).map(([sessionId, sessionTraces]) => (
        <div key={sessionId} className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-3">
            <GitBranch className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-medium">Session</span>
            <span className="text-xs text-gray-500 font-mono">{sessionId.slice(0, 16)}...</span>
            <span className="text-xs text-gray-400 ml-auto">{sessionTraces.length} traces</span>
          </div>
          
          {/* Session Timeline */}
          <div className="flex items-center gap-2 overflow-x-auto pb-2">
            {sessionTraces.sort((a, b) => a.startTime - b.startTime).map((trace, idx) => (
              <React.Fragment key={trace.id}>
                <div
                  className={`flex-shrink-0 p-3 rounded-lg border cursor-pointer transition-all ${
                    selectedTraceId === trace.id
                      ? 'bg-blue-500/20 border-blue-500'
                      : 'bg-slate-700/50 border-slate-600 hover:border-slate-500'
                  }`}
                  onClick={() => onSelectTrace?.(trace)}
                >
                  <div className="flex items-center gap-2">
                    {trace.status === 'completed' && <CheckCircle className="w-3 h-3 text-emerald-400" />}
                    {trace.status === 'failed' && <XCircle className="w-3 h-3 text-red-400" />}
                    {trace.status === 'running' && <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />}
                    <span className="text-sm font-medium">{trace.agentName}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-1">
                    {trace.tools.length} tools · {trace.totalTokens.toLocaleString()} tokens
                  </div>
                </div>
                {idx < sessionTraces.length - 1 && (
                  <ArrowRight className="w-4 h-4 text-gray-600 flex-shrink-0" />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>
      ))}
      
      {sessions.length > 10 && (
        <div className="text-center text-sm text-gray-500">
          +{sessions.length - 10} more sessions
        </div>
      )}
    </div>
  );

  // Render Matrix View
  const renderMatrixView = () => {
    return (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th className="p-2 text-left text-gray-400">From \ To</th>
              {agents.map(agent => (
                <th key={agent.id} className="p-2 text-center text-gray-400" style={{ color: agent.color }}>
                  {agent.name.slice(0, 10)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {agents.map(fromAgent => (
              <tr key={fromAgent.id}>
                <td className="p-2 font-medium" style={{ color: fromAgent.color }}>
                  {fromAgent.name}
                </td>
                {agents.map(toAgent => {
                  const edge = interactions.find(
                    e => e.from === fromAgent.id && e.to === toAgent.id
                  );
                  return (
                    <td key={toAgent.id} className="p-2 text-center">
                      {edge ? (
                        <span className="inline-block px-2 py-1 rounded bg-blue-500/20 text-blue-300">
                          {edge.count}
                        </span>
                      ) : (
                        <span className="text-gray-600">-</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-5 h-5 text-blue-400" />
          <h2 className="text-lg font-semibold">Agent 交互图</h2>
        </div>
        
        {/* View Mode Toggle */}
        <div className="flex bg-slate-800 rounded-lg p-1">
          {(['flow', 'tree', 'matrix'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1 rounded text-sm transition-colors ${
                viewMode === mode
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {mode === 'flow' && '流程图'}
              {mode === 'tree' && '会话流'}
              {mode === 'matrix' && '调用矩阵'}
            </button>
          ))}
        </div>
      </div>

      {/* Stats Summary */}
      <div className="grid grid-cols-4 gap-3">
        <div className="bg-slate-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-blue-400">{agents.length}</div>
          <div className="text-xs text-gray-500">Agents</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-violet-400">{interactions.length}</div>
          <div className="text-xs text-gray-500">Interactions</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-cyan-400">{sessions.length}</div>
          <div className="text-xs text-gray-500">Sessions</div>
        </div>
        <div className="bg-slate-800/50 rounded-lg p-3 text-center">
          <div className="text-2xl font-bold text-emerald-400">
            {traces.reduce((sum, t) => sum + t.totalTokens, 0).toLocaleString()}
          </div>
          <div className="text-xs text-gray-500">Total Tokens</div>
        </div>
      </div>

      {/* Content */}
      <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
        {viewMode === 'flow' && renderFlowView()}
        {viewMode === 'tree' && renderSessionFlow()}
        {viewMode === 'matrix' && renderMatrixView()}
      </div>

      {/* Selected Agent Details */}
      {selectedAgent && (
        <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
          <div className="flex items-center gap-2 mb-3">
            <Users className="w-4 h-4 text-blue-400" />
            <span className="font-medium">
              {agents.find(a => a.id === selectedAgent)?.name}
            </span>
            <span className="text-xs text-gray-400 ml-auto">Agent Stats</span>
          </div>
          
          {(() => {
            const agent = agents.find(a => a.id === selectedAgent)!;
            return (
              <div className="grid grid-cols-4 gap-4 text-sm">
                <div>
                  <span className="text-gray-500 block text-xs">Total Calls</span>
                  <span className="text-lg font-semibold">{agent.stats.calls}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Total Tokens</span>
                  <span className="text-lg font-semibold">{agent.stats.tokens.toLocaleString()}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Total Cost</span>
                  <span className="text-lg font-semibold text-emerald-400">{formatCost(agent.stats.cost)}</span>
                </div>
                <div>
                  <span className="text-gray-500 block text-xs">Avg Duration</span>
                  <span className="text-lg font-semibold">
                    {formatDuration(agent.stats.duration / agent.stats.calls)}
                  </span>
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default AgentInteractionGraph;
