import React from 'react';
import {
  Cpu,
  Terminal,
  Sparkles,
  MousePointer,
  CheckCircle,
  XCircle,
  Clock,
} from 'lucide-react';
import { AgentStats } from '../types';

interface AgentSelectorProps {
  agents: AgentStats[];
  selectedAgentId?: string;
  onSelectAgent?: (agentId: string | null) => void;
}

const platformIcons: Record<string, React.ElementType> = {
  openclaw: Cpu,
  'claude-code': Terminal,
  'kimi-code': Sparkles,
  cursor: MousePointer,
};

const platformColors: Record<string, string> = {
  openclaw: '#3b82f6',
  'claude-code': '#f59e0b',
  'kimi-code': '#8b5cf6',
  cursor: '#10b981',
};

const platformLabels: Record<string, string> = {
  openclaw: 'OpenClaw',
  'claude-code': 'Claude Code',
  'kimi-code': 'Kimi Code',
  cursor: 'Cursor',
};

export const AgentSelector: React.FC<AgentSelectorProps> = ({
  agents,
  selectedAgentId,
  onSelectAgent,
}) => {
  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTimeAgo = (timestamp: number) => {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);

    if (minutes < 1) return '刚刚';
    if (minutes < 60) return `${minutes}分钟前`;
    if (hours < 24) return `${hours}小时前`;
    return `${days}天前`;
  };

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-4">
        <Cpu className="w-5 h-5 text-purple-500" />
        <h2 className="text-lg font-semibold">Agent 平台</h2>
      </div>

      {/* All Agents Option */}
      <div
        onClick={() => onSelectAgent?.(null)}
        className={`
          p-3 rounded-lg cursor-pointer transition-all duration-200 mb-3
          ${selectedAgentId === undefined
            ? 'bg-blue-500/20 border border-blue-500/50'
            : 'bg-slate-800/50 hover:bg-slate-800 border border-transparent'}
        `}
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="font-medium">全部 Agent</div>
            <div className="text-xs text-gray-400">
              {agents.length} 个平台 · {agents.reduce((sum, a) => sum + a.totalExecutions, 0)} 次执行
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2 max-h-96 overflow-auto -mx-5 px-5">
        {agents.map((agent) => {
          const PlatformIcon = platformIcons[agent.platform] || Cpu;
          const isSelected = selectedAgentId === agent.agentId;
          const successRate = Math.round(agent.successRate * 100);

          return (
            <div
              key={agent.agentId}
              onClick={() => onSelectAgent?.(agent.agentId)}
              className={`
                p-3 rounded-lg cursor-pointer transition-all duration-200
                ${isSelected ? 'bg-blue-500/20 border border-blue-500/50' : 'bg-slate-800/50 hover:bg-slate-800 border border-transparent'}
              `}
            >
              <div className="flex items-start gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ backgroundColor: `${platformColors[agent.platform]}20` }}
                >
                  <PlatformIcon
                    className="w-5 h-5"
                    style={{ color: platformColors[agent.platform] }}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium truncate">{agent.agentName}</span>
                    <span
                      className="text-xs px-1.5 py-0.5 rounded flex-shrink-0"
                      style={{
                        backgroundColor: `${platformColors[agent.platform]}20`,
                        color: platformColors[agent.platform],
                      }}
                    >
                      {platformLabels[agent.platform]}
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div className="flex items-center gap-1 text-gray-400">
                      <CheckCircle className="w-3 h-3" />
                      <span>{agent.totalExecutions} 次执行</span>
                    </div>
                    <div className="flex items-center gap-1 text-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>{formatDuration(agent.avgDuration)} 平均</span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-1">
                      {successRate >= 90 ? (
                        <CheckCircle className="w-3 h-3 text-emerald-500" />
                      ) : successRate >= 70 ? (
                        <Clock className="w-3 h-3 text-yellow-500" />
                      ) : (
                        <XCircle className="w-3 h-3 text-red-500" />
                      )}
                      <span
                        className={`text-xs ${
                          successRate >= 90
                            ? 'text-emerald-500'
                            : successRate >= 70
                            ? 'text-yellow-500'
                            : 'text-red-500'
                        }`}
                      >
                        {successRate}% 成功率
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatTimeAgo(agent.lastActive)}
                    </span>
                  </div>

                  {/* Success Rate Bar */}
                  <div className="w-full bg-slate-700 rounded-full h-1.5 mt-2">
                    <div
                      className={`h-1.5 rounded-full transition-all duration-500 ${
                        successRate >= 90
                          ? 'bg-emerald-500'
                          : successRate >= 70
                          ? 'bg-yellow-500'
                          : 'bg-red-500'
                      }`}
                      style={{ width: `${successRate}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default AgentSelector;
