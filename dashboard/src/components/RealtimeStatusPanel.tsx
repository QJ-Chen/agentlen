import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  CheckCircle,
  ChevronRight,
  Clock,
  Loader2,
  MessageSquare,
  Terminal,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { Trace } from '../types';
import { clampNonNegative, formatCompactDuration, formatDuration, relativeTime } from '../lib/sessionUtils';

interface RealtimeStatusPanelProps {
  traces: Trace[];
  onSelectTrace?: (trace: Trace) => void;
  selectedTraceId?: string;
  lastFetchedAt?: number | null;
  isRefreshing?: boolean;
}

interface FreshTrace {
  trace: Trace;
  freshnessLabel: string;
  currentStep: string;
  elapsedTime: number;
}

export const RealtimeStatusPanel: React.FC<RealtimeStatusPanelProps> = ({
  traces,
  onSelectTrace,
  selectedTraceId,
  lastFetchedAt,
  isRefreshing = false,
}) => {
  const [freshTraces, setFreshTraces] = useState<FreshTrace[]>([]);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const currentNow = Date.now();
      setNowMs(currentNow);

      const active = traces
        .filter((trace) => currentNow - (trace.lastRequestTime || trace.startTime) < 15 * 60_000)
        .map((trace) => {
          const elapsed = clampNonNegative(currentNow - trace.startTime);
          let currentStep = 'Waiting for more activity';
          if (trace.tools.length > 0) {
            const lastTool = trace.tools[trace.tools.length - 1];
            currentStep = `Latest tool: ${lastTool.name}`;
          } else if (trace.llmCalls.length > 0) {
            const lastLLM = trace.llmCalls[trace.llmCalls.length - 1];
            currentStep = `Latest model: ${lastLLM.model}`;
          }
          return {
            trace,
            freshnessLabel: relativeTime(trace.lastRequestTime || trace.startTime, currentNow),
            currentStep,
            elapsedTime: elapsed,
          };
        })
        .sort((a, b) => (b.trace.lastRequestTime || b.trace.startTime) - (a.trace.lastRequestTime || a.trace.startTime));

      setFreshTraces(active);
    }, 1000);

    return () => clearInterval(interval);
  }, [traces]);

  const lastRefreshTimestamp = lastFetchedAt ?? 0;
  const lastRefreshLabel = lastRefreshTimestamp > 0 ? relativeTime(lastRefreshTimestamp, nowMs) : 'never';

  const recentCompleted = useMemo(
    () =>
      traces
        .filter((trace) => trace.endTime && nowMs - trace.endTime < 60 * 60_000)
        .sort((a, b) => (b.endTime || 0) - (a.endTime || 0))
        .slice(0, 6),
    [nowMs, traces],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-green-400" />
            <h2 className="text-lg font-semibold text-white">Recent Activity</h2>
            {freshTraces.length > 0 && (
              <span className="rounded-full bg-green-500/10 px-2 py-0.5 text-[11px] text-green-300">
                {freshTraces.length} fresh sessions
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-400">Newest updated sessions from the latest server refresh, with a bias toward fresh activity.</p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-400">
          <span>{isRefreshing ? 'Refreshing…' : `Updated ${lastRefreshLabel}`}</span>
        </div>
      </div>

      {freshTraces.length > 0 ? (
        <div className="space-y-3">
          {freshTraces.map(({ trace, freshnessLabel, currentStep, elapsedTime }) => (
            <div
              key={trace.id}
              onClick={() => onSelectTrace?.(trace)}
              className={`rounded-2xl border p-4 cursor-pointer transition-all ${
                selectedTraceId === trace.id
                  ? 'border-blue-500 bg-blue-500/10 shadow-lg shadow-blue-950/20'
                  : 'border-slate-700/60 bg-slate-900/80 hover:border-slate-600'
              }`}
            >
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {trace.status === 'running' ? (
                      <Loader2 className="h-4 w-4 text-blue-400 animate-spin" />
                    ) : trace.status === 'completed' ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    ) : trace.status === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-400" />
                    ) : (
                      <Clock className="h-4 w-4 text-slate-400" />
                    )}
                    <span className="font-medium text-white truncate">{trace.agentName}</span>
                    <span className="rounded-full bg-blue-500/10 px-2 py-0.5 text-[11px] text-blue-300">Claude Code</span>
                  </div>
                  <p className="mt-2 text-sm text-slate-300">{currentStep}</p>
                </div>
                <span className="text-xs text-slate-400 whitespace-nowrap">{freshnessLabel}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-slate-400 sm:grid-cols-4">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatCompactDuration(trace.duration || elapsedTime)}
                </span>
                <span className="flex items-center gap-1">
                  <Wrench className="h-3 w-3" /> {trace.tools.length} tools
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" /> {trace.llmCalls.length} LLM
                </span>
                <span className="flex items-center gap-1 text-emerald-300">
                  <Terminal className="h-3 w-3" /> {trace.totalTokens.toLocaleString()} tokens
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/60 p-8 text-center text-slate-400">
          <CheckCircle className="mx-auto mb-3 h-10 w-10 text-slate-600" />
          <p className="text-base font-medium text-slate-200">No recent session activity</p>
          <p className="mt-2 text-sm">Use the top-right refresh button to pull the latest server data after local session logs change.</p>
        </div>
      )}

      {recentCompleted.length > 0 && (
        <div className="rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-300">Recently completed</span>
          </div>

          <div className="space-y-2">
            {recentCompleted.map((trace) => (
              <div
                key={trace.id}
                onClick={() => onSelectTrace?.(trace)}
                className={`flex items-center justify-between rounded-xl border p-3 cursor-pointer transition-all ${
                  selectedTraceId === trace.id
                    ? 'border-blue-500 bg-blue-500/10'
                    : 'border-slate-700/50 bg-slate-950/50 hover:border-slate-600'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {trace.status === 'completed' ? (
                      <CheckCircle className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-400" />
                    )}
                    <span className="font-medium text-white truncate">{trace.agentName}</span>
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${trace.status === 'completed' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-red-500/15 text-red-300'}`}>
                      {trace.status === 'completed' ? 'completed' : 'failed'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-400">Claude Code · {relativeTime(trace.endTime || trace.startTime, nowMs)}</div>
                </div>

                <div className="flex items-center gap-4 text-sm text-slate-400">
                  <span>{formatDuration(trace.duration || 0)}</span>
                  <span className="text-emerald-400">${trace.cost.toFixed(4)}</span>
                  <ChevronRight className="h-4 w-4" />
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
