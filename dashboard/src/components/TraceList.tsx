import React from 'react';
import { Activity, CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import type { Trace } from '../types';

interface TraceListProps {
  traces: Trace[];
  selectedTraceId?: string;
  onSelectTrace?: (trace: Trace) => void;
}

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

const statusIcons = {
  running: Loader2,
  completed: CheckCircle,
  failed: XCircle,
  cancelled: XCircle,
};

const statusColors = {
  running: '#3b82f6',
  completed: '#10b981',
  failed: '#ef4444',
  cancelled: '#94a3b8',
};

export const TraceList: React.FC<TraceListProps> = ({
  traces,
  selectedTraceId,
  onSelectTrace,
}) => {
  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  };

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  return (
    <div className="card h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-5 h-5 text-blue-500" />
        <h2 className="text-lg font-semibold">执行记录</h2>
        <span className="ml-auto text-sm text-gray-400">
          共 {traces.length} 条记录
        </span>
      </div>

      <div className="flex-1 overflow-auto -mx-5 px-5">
        <div className="space-y-2">
          {traces.map((trace) => {
            const StatusIcon = statusIcons[trace.status];
            const isSelected = selectedTraceId === trace.id;

            return (
              <div
                key={trace.id}
                onClick={() => onSelectTrace?.(trace)}
                className={`
                  p-3 rounded-lg cursor-pointer transition-all duration-200
                  ${isSelected ? 'bg-blue-500/20 border border-blue-500/50' : 'bg-slate-800/50 hover:bg-slate-800 border border-transparent'}
                `}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <div
                      className="w-2 h-2 rounded-full flex-shrink-0"
                      style={{ backgroundColor: platformColors[trace.platform] }}
                    />
                    <span className="font-medium truncate">
                      {/* Claude Code 和 Kimi Code 显示工作目录，OpenClaw 显示 agentName */}
                      {(trace.platform === 'claude-code' || trace.platform === 'kimi-code') && trace.projectPath
                        ? trace.projectPath.split('/').pop() || trace.projectPath
                        : trace.agentName}
                    </span>
                  </div>
                  <StatusIcon
                    className={`w-4 h-4 flex-shrink-0 ${trace.status === 'running' ? 'animate-spin' : ''}`}
                    style={{ color: statusColors[trace.status] }}
                  />
                </div>

                <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {formatTime(trace.startTime)}
                  </span>
                  <span>{formatDuration(trace.duration)}</span>
                  <span
                    className="px-1.5 py-0.5 rounded text-xs"
                    style={{
                      backgroundColor: `${platformColors[trace.platform]}20`,
                      color: platformColors[trace.platform],
                    }}
                  >
                    {platformLabels[trace.platform]}
                  </span>
                </div>

                <div className="flex items-center gap-3 mt-2 text-xs">
                  <span className="text-gray-500">
                    {trace.tools.length} 个工具调用
                  </span>
                  <span className="text-gray-500">
                    {trace.totalTokens.toLocaleString()} tokens
                  </span>
                  <span className="text-emerald-400">
                    ${trace.cost.toFixed(4)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TraceList;
