import React from 'react';
import {
  VerticalTimeline,
  VerticalTimelineElement,
} from 'react-vertical-timeline-component';
import {
  Play,
  CheckCircle,
  XCircle,
  Loader2,
  Wrench,
  MessageSquare,
  Clock,
} from 'lucide-react';
import { Trace, ToolCall, LLMCall } from '../types';

interface TraceTimelineProps {
  trace: Trace;
}

const statusIcons = {
  success: CheckCircle,
  error: XCircle,
  pending: Loader2,
};

const statusColors = {
  success: '#10b981',
  error: '#ef4444',
  pending: '#3b82f6',
};

export const TraceTimeline: React.FC<TraceTimelineProps> = ({ trace }) => {
  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  const formatDuration = (ms: number) => {
    if (ms < 1) return '<1ms';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Combine and sort all events
  const events: Array<
    | ({ type: 'tool' } & ToolCall)
    | ({ type: 'llm' } & LLMCall)
  > = [
    ...trace.tools.map((t) => ({ ...t, type: 'tool' as const })),
    ...trace.llmCalls.map((l) => ({ ...l, type: 'llm' as const })),
  ].sort((a, b) => a.startTime - b.startTime);

  return (
    <div className="card h-full flex flex-col">
      <div className="flex items-center gap-2 mb-4">
        <Clock className="w-5 h-5 text-blue-500" />
        <h2 className="text-lg font-semibold">执行时序</h2>
        <span className="ml-auto text-sm text-gray-400">
          {trace.agentName}
        </span>
      </div>

      {/* Trace Header Info */}
      <div className="bg-slate-800/50 rounded-lg p-4 mb-4 border border-slate-700/50">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <span className="text-gray-400 block text-xs mb-1">状态</span>
            <span
              className={`inline-flex items-center gap-1 ${
                trace.status === 'completed'
                  ? 'text-emerald-400'
                  : trace.status === 'failed'
                  ? 'text-red-400'
                  : trace.status === 'running'
                  ? 'text-blue-400'
                  : 'text-gray-400'
              }`}
            >
              {trace.status === 'running' && (
                <Loader2 className="w-3 h-3 animate-spin" />
              )}
              {trace.status === 'completed' && <CheckCircle className="w-3 h-3" />}
              {trace.status === 'failed' && <XCircle className="w-3 h-3" />}
              {trace.status === 'cancelled' && <XCircle className="w-3 h-3" />}
              {trace.status === 'completed'
                ? '已完成'
                : trace.status === 'failed'
                ? '失败'
                : trace.status === 'running'
                ? '运行中'
                : '已取消'}
            </span>
          </div>
          <div>
            <span className="text-gray-400 block text-xs mb-1">开始时间</span>
            <span>{formatTime(trace.startTime)}</span>
          </div>
          <div>
            <span className="text-gray-400 block text-xs mb-1">持续时间</span>
            <span>
              {trace.duration ? formatDuration(trace.duration) : '-'}
            </span>
          </div>
          <div>
            <span className="text-gray-400 block text-xs mb-1">总成本</span>
            <span className="text-emerald-400">${trace.cost.toFixed(4)}</span>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm mt-3 pt-3 border-t border-slate-700/50">
          <div>
            <span className="text-gray-400 block text-xs mb-1">工具调用</span>
            <span>{trace.tools.length} 次</span>
          </div>
          <div>
            <span className="text-gray-400 block text-xs mb-1">LLM 调用</span>
            <span>{trace.llmCalls.length} 次 · {trace.totalTokens.toLocaleString()} tokens</span>
          </div>
        </div>
      </div>

      {/* Timeline */}
      <div className="flex-1 overflow-auto">
        <div className="relative">
          {/* Timeline Line */}
          <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-slate-700" />

          <div className="space-y-4">
            {/* Start Event */}
            <div className="relative flex items-start gap-4">
              <div className="relative z-10 w-8 h-8 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                <Play className="w-4 h-4 text-white" />
              </div>
              <div className="flex-1 bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                <div className="flex items-center justify-between">
                  <span className="font-medium">开始执行</span>
                  <span className="text-xs text-gray-400">
                    {formatTime(trace.startTime)}
                  </span>
                </div>
              </div>
            </div>

            {/* Events */}
            {events.map((event, index) => {
              const isTool = event.type === 'tool';
              const Icon = isTool ? Wrench : MessageSquare;
              const StatusIcon = statusIcons[event.status];
              const color = isTool ? '#8b5cf6' : '#3b82f6';

              return (
                <div key={event.id} className="relative flex items-start gap-4">
                  <div
                    className="relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: `${color}30` }}
                  >
                    <Icon className="w-4 h-4" style={{ color }} />
                  </div>
                  <div className="flex-1 bg-slate-800/50 rounded-lg p-3 border border-slate-700/50 hover:border-slate-600 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-medium">
                          {isTool ? event.name : event.model}
                        </span>
                        <span
                          className="text-xs px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `${color}20`,
                            color,
                          }}
                        >
                          {isTool ? '工具' : 'LLM'}
                        </span>
                      </div>
                      <StatusIcon
                        className={`w-4 h-4 ${event.status === 'pending' ? 'animate-spin' : ''}`}
                        style={{ color: statusColors[event.status] }}
                      />
                    </div>

                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
                      <span>{formatDuration(event.duration)}</span>
                      <span>{formatTime(event.startTime)}</span>
                      {!isTool && (
                        <span>
                          {(event as LLMCall).inputTokens.toLocaleString()} in /{' '}
                          {(event as LLMCall).outputTokens.toLocaleString()} out
                        </span>
                      )}
                      {!isTool && (
                        <span className="text-emerald-400">
                          ${(event as LLMCall).cost.toFixed(4)}
                        </span>
                      )}
                    </div>

                    {isTool && event.input && (
                      <div className="mt-2 p-2 bg-slate-900/50 rounded text-xs font-mono overflow-x-auto">
                        <pre className="text-gray-400">
                          {JSON.stringify(event.input, null, 2).slice(0, 200)}
                          {JSON.stringify(event.input).length > 200 && '...'}
                        </pre>
                      </div>
                    )}

                    {event.error && (
                      <div className="mt-2 p-2 bg-red-500/10 border border-red-500/30 rounded text-xs text-red-400">
                        {event.error}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}

            {/* End Event */}
            {trace.status !== 'running' && (
              <div className="relative flex items-start gap-4">
                <div
                  className={`relative z-10 w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                    trace.status === 'completed'
                      ? 'bg-emerald-500'
                      : trace.status === 'failed'
                      ? 'bg-red-500'
                      : 'bg-gray-500'
                  }`}
                >
                  {trace.status === 'completed' ? (
                    <CheckCircle className="w-4 h-4 text-white" />
                  ) : (
                    <XCircle className="w-4 h-4 text-white" />
                  )}
                </div>
                <div className="flex-1 bg-slate-800/50 rounded-lg p-3 border border-slate-700/50">
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {trace.status === 'completed'
                        ? '执行完成'
                        : trace.status === 'failed'
                        ? '执行失败'
                        : '已取消'}
                    </span>
                    {trace.endTime && (
                      <span className="text-xs text-gray-400">
                        {formatTime(trace.endTime)}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default TraceTimeline;
