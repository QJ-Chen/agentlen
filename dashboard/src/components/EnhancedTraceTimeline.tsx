import React, { useMemo, useState } from 'react';
import {
  Play,
  CheckCircle,
  XCircle,
  Wrench,
  MessageSquare,
  Clock,
  ChevronDown,
  ChevronRight,
  Terminal,
  FileText,
  AlertCircle,
} from 'lucide-react';
import type { LLMCall, ToolCall, Trace } from '../types';

interface EnhancedTraceTimelineProps {
  trace: Trace;
}

type EventType = 'tool' | 'llm' | 'start' | 'end';
type EventStatus = 'success' | 'error' | 'pending' | 'completed';
type TimelineDetail = ToolCall | LLMCall;

interface TimelineEvent {
  id: string;
  type: EventType;
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: EventStatus;
  details?: TimelineDetail;
  input?: Record<string, unknown>;
  output?: unknown;
  error?: string;
}

export const EnhancedTraceTimeline: React.FC<EnhancedTraceTimelineProps> = ({ trace }) => {
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [selectedEvent, setSelectedEvent] = useState<string | null>(null);

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

  const events = useMemo(() => {
    const timelineEvents: TimelineEvent[] = [];

    timelineEvents.push({
      id: 'start',
      type: 'start',
      name: '开始执行',
      startTime: trace.startTime,
      endTime: trace.startTime,
      duration: 0,
      status: 'completed',
    });

    trace.tools.forEach((tool, idx) => {
      timelineEvents.push({
        id: `tool-${idx}`,
        type: 'tool',
        name: tool.name,
        startTime: tool.startTime,
        endTime: tool.endTime,
        duration: tool.duration,
        status: tool.status,
        input: tool.input,
        output: tool.output,
        error: tool.error,
        details: tool,
      });
    });

    trace.llmCalls.forEach((call, idx) => {
      timelineEvents.push({
        id: `llm-${idx}`,
        type: 'llm',
        name: call.model,
        startTime: call.startTime,
        endTime: call.endTime,
        duration: call.duration,
        status: call.status === 'streaming' ? 'pending' : call.status,
        details: call,
      });
    });

    timelineEvents.sort((a, b) => a.startTime - b.startTime);

    if (trace.endTime) {
      timelineEvents.push({
        id: 'end',
        type: 'end',
        name: trace.status === 'completed' ? '执行完成' : trace.status === 'failed' ? '执行失败' : '已取消',
        startTime: trace.endTime,
        endTime: trace.endTime,
        duration: 0,
        status: trace.status === 'failed' ? 'error' : 'completed',
      });
    }

    return timelineEvents;
  }, [trace]);

  const timeRange = useMemo(() => {
    if (events.length < 2) return { start: 0, end: 1000, duration: 1000 };
    const start = events[0].startTime;
    const end = events[events.length - 1].endTime;
    const duration = end - start || 1000;
    return { start, end, duration };
  }, [events]);

  const toggleExpand = (id: string) => {
    const newExpanded = new Set(expandedEvents);
    if (newExpanded.has(id)) {
      newExpanded.delete(id);
    } else {
      newExpanded.add(id);
    }
    setExpandedEvents(newExpanded);
  };

  const getEventIcon = (event: TimelineEvent) => {
    switch (event.type) {
      case 'start':
        return <Play className="w-4 h-4 text-white" />;
      case 'end':
        return event.status === 'completed' ? <CheckCircle className="w-4 h-4 text-white" /> : <XCircle className="w-4 h-4 text-white" />;
      case 'tool':
        return <Wrench className="w-4 h-4" />;
      case 'llm':
        return <MessageSquare className="w-4 h-4" />;
      default:
        return <Clock className="w-4 h-4" />;
    }
  };

  const getEventColor = (event: TimelineEvent) => {
    switch (event.type) {
      case 'start':
        return 'bg-blue-500';
      case 'end':
        return event.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500';
      case 'tool':
        return 'bg-violet-500';
      case 'llm':
        return 'bg-cyan-500';
      default:
        return 'bg-gray-500';
    }
  };

  const getEventBgColor = (event: TimelineEvent) => {
    switch (event.type) {
      case 'start':
        return 'bg-blue-500/10 border-blue-500/30';
      case 'end':
        return event.status === 'completed' ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-red-500/10 border-red-500/30';
      case 'tool':
        return 'bg-violet-500/10 border-violet-500/30';
      case 'llm':
        return 'bg-cyan-500/10 border-cyan-500/30';
      default:
        return 'bg-gray-500/10 border-gray-500/30';
    }
  };

  const getTimelinePosition = (time: number) => {
    const offset = time - timeRange.start;
    return (offset / timeRange.duration) * 100;
  };

  const getTimelineWidth = (duration: number) => (duration / timeRange.duration) * 100;

  return (
    <div className="space-y-4">
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium">执行时序图</span>
          <span className="text-xs text-gray-400 ml-auto">总时长: {formatDuration(trace.duration || 0)}</span>
        </div>

        <div className="relative h-8 bg-slate-900 rounded-full overflow-hidden">
          {[0, 25, 50, 75, 100].map((pct) => (
            <div key={pct} className="absolute top-0 bottom-0 w-px bg-slate-700/50" style={{ left: `${pct}%` }} />
          ))}

          {events.filter((event) => event.type !== 'start' && event.type !== 'end').map((event) => {
            const left = getTimelinePosition(event.startTime);
            const width = Math.max(getTimelineWidth(event.duration), 0.5);
            return (
              <div
                key={event.id}
                className={`absolute top-1 bottom-1 rounded cursor-pointer transition-all hover:opacity-80 ${
                  event.type === 'tool' ? 'bg-violet-500/60' : 'bg-cyan-500/60'
                } ${selectedEvent === event.id ? 'ring-2 ring-white' : ''}`}
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={() => setSelectedEvent(selectedEvent === event.id ? null : event.id)}
                title={`${event.name} (${formatDuration(event.duration)})`}
              />
            );
          })}
        </div>

        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0s</span>
          <span>{formatDuration(timeRange.duration * 0.25)}</span>
          <span>{formatDuration(timeRange.duration * 0.5)}</span>
          <span>{formatDuration(timeRange.duration * 0.75)}</span>
          <span>{formatDuration(timeRange.duration)}</span>
        </div>
      </div>

      <div className="space-y-2">
        {events.map((event) => {
          const isExpanded = expandedEvents.has(event.id);
          const isSelected = selectedEvent === event.id;
          const llmDetails = event.type === 'llm' ? (event.details as LLMCall | undefined) : undefined;

          return (
            <div key={event.id} className={`rounded-lg border transition-all ${isSelected ? 'ring-2 ring-blue-500' : ''} ${getEventBgColor(event)}`}>
              <button onClick={() => toggleExpand(event.id)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${getEventColor(event)}`}>
                  {getEventIcon(event)}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{event.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${event.type === 'tool' ? 'bg-violet-500/20 text-violet-300' : event.type === 'llm' ? 'bg-cyan-500/20 text-cyan-300' : 'bg-gray-500/20 text-gray-300'}`}>
                      {event.type === 'tool' ? '工具' : event.type === 'llm' ? 'LLM' : event.type === 'start' ? '开始' : '结束'}
                    </span>
                    {event.status === 'error' && <AlertCircle className="w-4 h-4 text-red-400" />}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>{formatTime(event.startTime)}</span>
                    {event.duration > 0 && <span className="text-gray-500">({formatDuration(event.duration)})</span>}
                    {llmDetails && (
                      <span className="text-cyan-400">
                        {llmDetails.inputTokens.toLocaleString()} → {llmDetails.outputTokens.toLocaleString()} tokens
                      </span>
                    )}
                  </div>
                </div>

                {event.type !== 'start' && event.type !== 'end' && (
                  <div className="text-gray-400">{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</div>
                )}
              </button>

              {isExpanded && event.type !== 'start' && event.type !== 'end' && (
                <div className="px-4 pb-4 border-t border-slate-700/50">
                  {event.input && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Terminal className="w-3 h-3 text-gray-500" />
                        <span className="text-xs font-medium text-gray-400">输入参数</span>
                      </div>
                      <pre className="bg-slate-950 p-3 rounded text-xs text-green-400 overflow-auto max-h-40">{JSON.stringify(event.input, null, 2)}</pre>
                    </div>
                  )}

                  {event.output !== undefined && event.output !== null && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-3 h-3 text-gray-500" />
                        <span className="text-xs font-medium text-gray-400">输出结果</span>
                      </div>
                      <pre className="bg-slate-950 p-3 rounded text-xs text-blue-400 overflow-auto max-h-40">{typeof event.output === 'string' ? event.output : String(JSON.stringify(event.output, null, 2) || '')}</pre>
                    </div>
                  )}

                  {event.error && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-3 h-3 text-red-500" />
                        <span className="text-xs font-medium text-red-400">错误信息</span>
                      </div>
                      <pre className="bg-red-950/30 p-3 rounded text-xs text-red-400 overflow-auto">{event.error}</pre>
                    </div>
                  )}

                  {llmDetails?.prompt && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <MessageSquare className="w-3 h-3 text-gray-500" />
                        <span className="text-xs font-medium text-gray-400">提示词 (Prompt)</span>
                      </div>
                      <pre className="bg-slate-950 p-3 rounded text-xs text-gray-300 overflow-auto max-h-60 whitespace-pre-wrap">{llmDetails.prompt}</pre>
                    </div>
                  )}

                  {llmDetails?.response && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-3 h-3 text-gray-500" />
                        <span className="text-xs font-medium text-gray-400">响应 (Response)</span>
                      </div>
                      <pre className="bg-slate-950 p-3 rounded text-xs text-blue-300 overflow-auto max-h-60 whitespace-pre-wrap">{llmDetails.response}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default EnhancedTraceTimeline;
