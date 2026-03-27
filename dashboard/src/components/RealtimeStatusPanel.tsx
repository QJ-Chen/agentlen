import React, { useState, useEffect } from 'react';
import {
  Activity,
  Loader2,
  CheckCircle,
  XCircle,
  Clock,
  Zap,
  Terminal,
  Wrench,
  MessageSquare,
  ChevronRight,
} from 'lucide-react';
import type { Trace } from '../types';

interface RealtimeStatusPanelProps {
  traces: (Trace & { raw?: any })[];
  onSelectTrace?: (trace: Trace & { raw?: any }) => void;
  selectedTraceId?: string;
}

interface RunningTrace {
  trace: Trace & { raw?: any };
  progress: number;
  currentStep: string;
  elapsedTime: number;
}

export const RealtimeStatusPanel: React.FC<RealtimeStatusPanelProps> = ({
  traces,
  onSelectTrace,
  selectedTraceId,
}) => {
  const [runningTraces, setRunningTraces] = useState<RunningTrace[]>([]);
  const [lastUpdate, setLastUpdate] = useState<Date>(new Date());
  const [isLive, setIsLive] = useState(true);

  // Update running traces
  useEffect(() => {
    const interval = setInterval(() => {
      if (!isLive) return;
      
      const now = Date.now();
      const active = traces
        .filter(t => t.status === 'running' || (now - t.startTime < 60000 && !t.endTime))
        .map(trace => {
          const elapsed = now - trace.startTime;
          const estimatedDuration = trace.duration || 30000; // Default 30s estimate
          const progress = Math.min((elapsed / estimatedDuration) * 100, 95);
          
          // Determine current step
          let currentStep = '初始化...';
          if (trace.tools.length > 0) {
            const lastTool = trace.tools[trace.tools.length - 1];
            if (lastTool.status === 'pending') {
              currentStep = `执行工具: ${lastTool.name}`;
            } else {
              currentStep = `已完成: ${lastTool.name}`;
            }
          } else if (trace.llmCalls.length > 0) {
            const lastLLM = trace.llmCalls[trace.llmCalls.length - 1];
            if (lastLLM.status === 'streaming') {
              currentStep = `LLM 生成中 (${lastLLM.outputTokens} tokens)`;
            } else {
              currentStep = '等待 LLM 响应...';
            }
          }
          
          return {
            trace,
            progress,
            currentStep,
            elapsedTime: elapsed,
          };
        });
      
      setRunningTraces(active);
      setLastUpdate(new Date());
    }, 500);

    return () => clearInterval(interval);
  }, [traces, isLive]);

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    const mins = Math.floor(ms / 60000);
    const secs = ((ms % 60000) / 1000).toFixed(0);
    return `${mins}m ${secs}s`;
  };

  // Recently completed traces (last 5 minutes)
  const recentCompleted = traces
    .filter(t => t.endTime && Date.now() - t.endTime < 300000)
    .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-5 h-5 text-green-400" />
          <h2 className="text-lg font-semibold">实时状态</h2>
          {runningTraces.length > 0 && (
            <span className="px-2 py-0.5 rounded-full bg-green-500/20 text-green-400 text-xs">
              {runningTraces.length} 运行中
            </span>
          )}
        </div>
        
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsLive(!isLive)}
            className={`px-3 py-1 rounded text-xs transition-colors ${
              isLive
                ? 'bg-green-500/20 text-green-400'
                : 'bg-gray-700 text-gray-400'
            }`}
          >
            {isLive ? '● 实时' : '○ 暂停'}
          </button>
          <span className="text-xs text-gray-500">
            更新于 {lastUpdate.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Running Traces */}
      {runningTraces.length > 0 ? (
        <div className="space-y-3">
          {runningTraces.map(({ trace, progress, currentStep, elapsedTime }) => (
            <div
              key={trace.id}
              onClick={() => onSelectTrace?.(trace)}
              className={`bg-slate-800/50 rounded-lg p-4 border cursor-pointer transition-all ${
                selectedTraceId === trace.id
                  ? 'border-blue-500 bg-blue-500/10'
                  : 'border-slate-700/50 hover:border-slate-600'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                  <span className="font-medium">{trace.agentName}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">
                    {trace.platform}
                  </span>
                </div>
                <span className="text-sm text-gray-400">{formatDuration(elapsedTime)}</span>
              </div>
              
              {/* Progress Bar */}
              <div className="mb-2">
                <div className="h-2 bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-gradient-to-r from-blue-500 to-cyan-400 transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
              
              {/* Current Step */}
              <div className="flex items-center gap-2 text-sm">
                <Zap className="w-3 h-3 text-yellow-400" />
                <span className="text-gray-300">{currentStep}</span>
              </div>
              
              {/* Stats */}
              <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                <span className="flex items-center gap-1">
                  <Wrench className="w-3 h-3" />
                  {trace.tools.length} tools
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="w-3 h-3" />
                  {trace.llmCalls.length} LLM calls
                </span>
                <span className="flex items-center gap-1">
                  <Terminal className="w-3 h-3" />
                  {trace.totalTokens.toLocaleString()} tokens
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-slate-800/30 rounded-lg p-8 text-center border border-slate-700/50 border-dashed">
          <CheckCircle className="w-12 h-12 mx-auto mb-3 text-gray-600" />
          <p className="text-gray-400">暂无运行中的 Agent</p>
          <p className="text-sm text-gray-500 mt-1">所有任务已完成</p>
        </div>
      )}

      {/* Recently Completed */}
      {recentCompleted.length > 0 && (
        <div>
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-gray-400" />
            <span className="text-sm font-medium text-gray-400">最近完成</span>
          </div>
          
          <div className="space-y-2">
            {recentCompleted.map(trace => (
              <div
                key={trace.id}
                onClick={() => onSelectTrace?.(trace)}
                className={`flex items-center justify-between p-3 rounded-lg border cursor-pointer transition-all ${
                  selectedTraceId === trace.id
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'bg-slate-800/30 border-slate-700/50 hover:border-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  {trace.status === 'completed' && (
                    <CheckCircle className="w-4 h-4 text-emerald-400" />
                  )}
                  {trace.status === 'failed' && (
                    <XCircle className="w-4 h-4 text-red-400" />
                  )}
                  <span className="font-medium">{trace.agentName}</span>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${
                    trace.status === 'completed'
                      ? 'bg-emerald-500/20 text-emerald-300'
                      : 'bg-red-500/20 text-red-300'
                  }`}>
                    {trace.status === 'completed' ? '完成' : '失败'}
                  </span>
                </div>
                
                <div className="flex items-center gap-4 text-sm text-gray-400">
                  <span>{formatDuration(trace.duration || 0)}</span>
                  <span className="text-emerald-400">${trace.cost.toFixed(4)}</span>
                  <ChevronRight className="w-4 h-4" />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default RealtimeStatusPanel;
