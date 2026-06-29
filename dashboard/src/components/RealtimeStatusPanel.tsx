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
            <Activity className="h-5 w-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-slate-950">Recent Activity</h2>
            {freshTraces.length > 0 && (
              <span className="rounded-full border border-emerald-100 bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">
                {freshTraces.length} fresh sessions
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-slate-500">Newest sessions.</p>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span>{isRefreshing ? 'Refreshing…' : `Updated ${lastRefreshLabel}`}</span>
        </div>
      </div>

      {freshTraces.length > 0 ? (
        <div className="space-y-3">
          {freshTraces.map(({ trace, freshnessLabel, currentStep, elapsedTime }) => (
            <div
              key={trace.id}
              onClick={() => onSelectTrace?.(trace)}
              className={`cursor-pointer rounded-3xl border p-4 transition-all ${
                selectedTraceId === trace.id
                  ? 'border-blue-300 bg-blue-50 shadow-sm shadow-blue-100'
                  : 'border-slate-200 bg-white shadow-sm shadow-slate-200/50 hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {trace.status === 'running' ? (
                      <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    ) : trace.status === 'completed' ? (
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                    ) : trace.status === 'failed' ? (
                      <XCircle className="h-4 w-4 text-red-600" />
                    ) : (
                      <Clock className="h-4 w-4 text-slate-400" />
                    )}
                    <span className="truncate font-medium text-slate-900">{trace.agentName}</span>
                    <span className="rounded-full border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] text-blue-700">
                      Claude Code
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-slate-600">{currentStep}</p>
                </div>
                <span className="whitespace-nowrap text-xs text-slate-500">{freshnessLabel}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {formatCompactDuration(trace.duration || elapsedTime)}
                </span>
                <span className="flex items-center gap-1">
                  <Wrench className="h-3 w-3" /> {trace.tools.length} tools
                </span>
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" /> {trace.llmCalls.length} LLM
                </span>
                <span className="flex items-center gap-1 text-emerald-700">
                  <Terminal className="h-3 w-3" /> {trace.totalTokens.toLocaleString()} tokens
                </span>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-slate-500">
          <CheckCircle className="mx-auto mb-3 h-10 w-10 text-slate-400" />
          <p className="text-base font-medium text-slate-800">No recent session activity</p>
          <p className="mt-2 text-sm">No recent sessions.</p>
        </div>
      )}

      {recentCompleted.length > 0 && (
        <div className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm shadow-slate-200/50">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">Recently completed</span>
          </div>

          <div className="space-y-2">
            {recentCompleted.map((trace) => (
              <div
                key={trace.id}
                onClick={() => onSelectTrace?.(trace)}
                className={`flex cursor-pointer items-center justify-between rounded-2xl border p-3 transition-all ${
                  selectedTraceId === trace.id
                    ? 'border-blue-300 bg-blue-50'
                    : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                }`}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    {trace.status === 'completed' ? (
                      <CheckCircle className="h-4 w-4 text-emerald-600" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600" />
                    )}
                    <span className="truncate font-medium text-slate-900">{trace.agentName}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[11px] ${
                        trace.status === 'completed'
                          ? 'border border-emerald-100 bg-emerald-50 text-emerald-700'
                          : 'border border-red-100 bg-red-50 text-red-700'
                      }`}
                    >
                      {trace.status === 'completed' ? 'completed' : 'failed'}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Claude Code · {relativeTime(trace.endTime || trace.startTime, nowMs)}
                  </div>
                </div>

                <div className="flex items-center gap-4 text-sm text-slate-500">
                  <span>{formatDuration(trace.duration || 0)}</span>
                  <span className="text-emerald-700">${trace.cost.toFixed(4)}</span>
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
