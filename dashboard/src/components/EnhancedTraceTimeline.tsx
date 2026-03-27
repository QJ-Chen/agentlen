import React, { useState, useMemo } from 'react';
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
import type { Trace } from '../types';

interface EnhancedTraceTimelineProps {
  trace: Trace & { raw?: any };
}

type EventType = 'tool' | 'llm' | 'start' | 'end';

interface TimelineEvent {
  id: string;
  type: EventType;
  name: string;
  startTime: number;
  endTime: number;
  duration: number;
  status: 'success' | 'error' | 'pending' | 'completed';
  details?: any;
  input?: any;
  output?: any;
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

  // Build timeline events from trace data
  const events = useMemo(() => {
    const timelineEvents: TimelineEvent[] = [];

    // Start event
    timelineEvents.push({
      id: 'start',
      type: 'start',
      name: '开始执行',
      startTime: trace.startTime,
      endTime: trace.startTime,
      duration: 0,
      status: 'completed',
    });

    // Tool calls
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

    // LLM calls
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

    // Parse raw data for additional events
    if (trace.raw?.tool_calls) {
      try {
        const rawTools = JSON.parse(trace.raw.tool_calls);
        rawTools.forEach((tool: any, idx: number) => {
          // Check if already added
          const exists = timelineEvents.some(e => 
            e.type === 'tool' && e.name === tool.name && 
            Math.abs(e.startTime - new Date(tool.timestamp || trace.startTime).getTime()) < 1000
          );
          if (!exists) {
            timelineEvents.push({
              id: `raw-tool-${idx}`,
              type: 'tool',
              name: tool.name || 'Unknown Tool',
              startTime: new Date(tool.timestamp || trace.startTime).getTime(),
              endTime: new Date(tool.timestamp || trace.startTime).getTime() + (tool.duration_ms || 0),
              duration: tool.duration_ms || 0,
              status: tool.status || 'success',
              input: tool.input || tool.input_args,
              output: tool.output || tool.result,
              error: tool.error,
              details: tool,
            });
          }
        });
      } catch (e) {
        // Ignore parse errors
      }
    }

    // Sort by start time
    timelineEvents.sort((a, b) => a.startTime - b.startTime);

    // End event
    if (trace.endTime) {
      timelineEvents.push({
        id: 'end',
        type: 'end',
        name: trace.status === 'completed' ? '执行完成' : 
              trace.status === 'failed' ? '执行失败' : '已取消',
        startTime: trace.endTime,
        endTime: trace.endTime,
        duration: 0,
        status: trace.status as any,
      });
    }

    return timelineEvents;
  }, [trace]);

  // Calculate timeline scale
  const timeRange = useMemo(() => {
    if (events.length < 2) return { start: 0, end: 1000, duration: 1000, scale: 0.1 };
    const start = events[0].startTime;
    const end = events[events.length - 1].endTime;
    const duration = end - start || 1000;
    return { start, end, duration, scale: 100 / duration };
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
        return event.status === 'completed' 
          ? <CheckCircle className="w-4 h-4 text-white" />
          : <XCircle className="w-4 h-4 text-white" />;
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
        return event.status === 'completed' 
          ? 'bg-emerald-500/10 border-emerald-500/30'
          : 'bg-red-500/10 border-red-500/30';
      case 'tool':
        return 'bg-violet-500/10 border-violet-500/30';
      case 'llm':
        return 'bg-cyan-500/10 border-cyan-500/30';
      default:
        return 'bg-gray-500/10 border-gray-500/30';
    }
  };

  // Calculate position on timeline bar
  const getTimelinePosition = (time: number) => {
    const offset = time - timeRange.start;
    return (offset / timeRange.duration) * 100;
  };

  // Calculate width on timeline bar
  const getTimelineWidth = (duration: number) => {
    return (duration / timeRange.duration) * 100;
  };

  return (
    <div className="space-y-4">
      {/* Timeline Visualization Bar */}
      <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
        <div className="flex items-center gap-2 mb-3">
          <Clock className="w-4 h-4 text-blue-400" />
          <span className="text-sm font-medium">执行时序图</span>
          <span className="text-xs text-gray-400 ml-auto">
            总时长: {formatDuration(trace.duration || 0)}
          </span>
        </div>
        
        {/* Timeline Bar */}
        <div className="relative h-8 bg-slate-900 rounded-full overflow-hidden">
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((pct) => (
            <div
              key={pct}
              className="absolute top-0 bottom-0 w-px bg-slate-700/50"
              style={{ left: `${pct}%` }}
            />
          ))}
          
          {/* Event bars */}
          {events.filter(e => e.type !== 'start' && e.type !== 'end').map((event) => {
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
        
        {/* Time labels */}
        <div className="flex justify-between text-xs text-gray-500 mt-1">
          <span>0s</span>
          <span>{formatDuration(timeRange.duration * 0.25)}</span>
          <span>{formatDuration(timeRange.duration * 0.5)}</span>
          <span>{formatDuration(timeRange.duration * 0.75)}</span>
          <span>{formatDuration(timeRange.duration)}</span>
        </div>
        
        {/* Legend */}
        <div className="flex gap-4 mt-3 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-violet-500/60" />
            <span className="text-gray-400">工具调用</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-3 h-3 rounded bg-cyan-500/60" />
            <span className="text-gray-400">LLM 调用</span>
          </div>
        </div>
      </div>

      {/* Detailed Event List */}
      <div className="space-y-2">
        {events.map((event) => {
          const isExpanded = expandedEvents.has(event.id);
          const isSelected = selectedEvent === event.id;
          
          return (
            <div
              key={event.id}
              className={`rounded-lg border transition-all ${
                isSelected ? 'ring-2 ring-blue-500' : ''
              } ${getEventBgColor(event)}`}
            >
              {/* Event Header */}
              <button
                onClick={() => toggleExpand(event.id)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                {/* Icon */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${getEventColor(event)}`}>
                  {getEventIcon(event)}
                </div>
                
                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{event.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      event.type === 'tool' ? 'bg-violet-500/20 text-violet-300' :
                      event.type === 'llm' ? 'bg-cyan-500/20 text-cyan-300' :
                      'bg-gray-500/20 text-gray-300'
                    }`}>
                      {event.type === 'tool' ? '工具' :
                       event.type === 'llm' ? 'LLM' :
                       event.type === 'start' ? '开始' : '结束'}
                    </span>
                    {event.status === 'error' && (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>{formatTime(event.startTime)}</span>
                    {event.duration > 0 && (
                      <span className="text-gray-500">({formatDuration(event.duration)})</span>
                    )}
                    {event.type === 'llm' && event.details && (
                      <span className="text-cyan-400">
                        {event.details.inputTokens?.toLocaleString() || 0} → {event.details.outputTokens?.toLocaleString() || 0} tokens
                      </span>
                    )}
                  </div>
                </div>
                
                {/* Expand Icon */}
                {event.type !== 'start' && event.type !== 'end' && (
                  <div className="text-gray-400">
                    {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </div>
                )}
              </button>
              
              {/* Expanded Details */}
              {isExpanded && event.type !== 'start' && event.type !== 'end' && (
                <div className="px-4 pb-4 border-t border-slate-700/50">
                  {/* Input */}
                  {event.input && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <Terminal className="w-3 h-3 text-gray-500" />
                        <span className="text-xs font-medium text-gray-400">输入参数</span>
                      </div>
                      <pre className="bg-slate-950 p-3 rounded text-xs text-green-400 overflow-auto max-h-40">
                        {JSON.stringify(event.input, null, 2)}
                      </pre>
                    </div>
                  )}
                  
                  {/* Output */}
                  {event.output && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <FileText className="w-3 h-3 text-gray-500" />
                        <span className="text-xs font-medium text-gray-400">输出结果</span>
                      </div>
                      <pre className="bg-slate-950 p-3 rounded text-xs text-blue-400 overflow-auto max-h-40">
                        {typeof event.output === 'string' 
                          ? event.output 
                          : JSON.stringify(event.output, null, 2)}
                      </pre>
                    </div>
                  )}
                  
                  {/* Error */}
                  {event.error && (
                    <div className="mt-3">
                      <div className="flex items-center gap-2 mb-2">
                        <AlertCircle className="w-3 h-3 text-red-500" />
                        <span className="text-xs font-medium text-red-400">错误信息</span>
                      </div>
                      <pre className="bg-red-950/30 p-3 rounded text-xs text-red-400 overflow-auto">
                        {event.error}
                      </pre>
                    </div>
                  )}
                  
                  {/* LLM Specific: Prompt & Response */}
                  {event.type === 'llm' && event.details && (
                    <>
                      {event.details.prompt && (
                        <div className="mt-3">
                          <div className="flex items-center gap-2 mb-2">
                            <MessageSquare className="w-3 h-3 text-gray-500" />
                            <span className="text-xs font-medium text-gray-400">提示词 (Prompt)</span>
                          </div>
                          <pre className="bg-slate-950 p-3 rounded text-xs text-gray-300 overflow-auto max-h-60 whitespace-pre-wrap">
                            {event.details.prompt}
                          </pre>
                        </div>
                      )}
                      
                      {event.details.response && (
                        <div className="mt-3">
                          <div className="flex items-center gap-2 mb-2">
                            <FileText className="w-3 h-3 text-gray-500" />
                            <span className="text-xs font-medium text-gray-400">响应 (Response)</span>
                          </div>
                          <pre className="bg-slate-950 p-3 rounded text-xs text-blue-300 overflow-auto max-h-60 whitespace-pre-wrap">
                            {event.details.response}
                          </pre>
                        </div>
                      )}
                    </>
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
