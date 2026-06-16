import React, { useMemo, useState } from 'react';
import { ArrowRight, BarChart3, CheckCircle, GitBranch, Layers, Network, XCircle } from 'lucide-react';
import type { Trace } from '../types';
import { formatCompactDuration, formatTokens, shortProjectPath } from '../lib/sessionUtils';

interface AgentInteractionGraphProps {
  traces: Trace[];
  selectedTraceId?: string;
  onSelectTrace?: (trace: Trace) => void;
}

export const AgentInteractionGraph: React.FC<AgentInteractionGraphProps> = ({
  traces,
  selectedTraceId,
  onSelectTrace,
}) => {
  const [viewMode, setViewMode] = useState<'projects' | 'sessions'>('projects');

  const projectGroups = useMemo(() => {
    const grouped = new Map<string, Trace[]>();
    traces.forEach((trace) => {
      const key = trace.projectPath || '(unknown project)';
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(trace);
    });
    return Array.from(grouped.entries())
      .map(([projectPath, items]) => ({
        projectPath,
        items: items.sort((a, b) => (b.lastRequestTime || b.startTime) - (a.lastRequestTime || a.startTime)),
        totalTokens: items.reduce((sum, item) => sum + item.totalTokens, 0),
        totalCost: items.reduce((sum, item) => sum + item.cost, 0),
      }))
      .sort((a, b) => b.totalCost - a.totalCost);
  }, [traces]);

  const sessionFlows = useMemo(() => {
    const grouped = new Map<string, Trace[]>();
    traces.forEach((trace) => {
      const key = trace.sessionId || trace.id;
      if (!grouped.has(key)) grouped.set(key, []);
      grouped.get(key)!.push(trace);
    });
    return Array.from(grouped.entries())
      .map(([sessionId, items]) => ({
        sessionId,
        items: items.sort((a, b) => a.startTime - b.startTime),
      }))
      .sort(
        (a, b) =>
          (b.items[b.items.length - 1]?.lastRequestTime || b.items[b.items.length - 1]?.startTime || 0) -
          (a.items[a.items.length - 1]?.lastRequestTime || a.items[a.items.length - 1]?.startTime || 0),
      );
  }, [traces]);

  return (
    <div className="space-y-6 rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-slate-950/30">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Network className="h-5 w-5 text-blue-400" />
            <h2 className="text-lg font-semibold text-white">Session Intelligence Views</h2>
          </div>
          <p className="mt-1 text-sm text-slate-400">Explore sessions by project or chronological flow to find where work and spend concentrate.</p>
        </div>

        <div className="inline-flex rounded-xl bg-slate-950/80 p-1 border border-slate-800 self-start">
          {([
            ['projects', 'Projects'],
            ['sessions', 'Session flow'],
          ] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`rounded-lg px-3 py-2 text-sm transition-colors ${
                viewMode === mode ? 'bg-blue-600 text-white shadow-md shadow-blue-950/40' : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label="Projects" value={String(projectGroups.length)} color="text-blue-400" />
        <SummaryCard label="Sessions" value={String(sessionFlows.length)} color="text-violet-400" />
        <SummaryCard label="Claude sources" value={String(traces.length)} color="text-cyan-400" />
        <SummaryCard label="Tokens" value={formatTokens(traces.reduce((sum, trace) => sum + trace.totalTokens, 0))} color="text-emerald-400" />
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
        {viewMode === 'projects' && (
          <div className="space-y-4">
            {projectGroups.slice(0, 12).map((project) => (
              <div key={project.projectPath} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="mb-3 flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="font-medium text-white break-all">{project.projectPath}</div>
                    <div className="mt-1 text-xs text-slate-400">
                      {project.items.length} sessions · {formatTokens(project.totalTokens)} · ${project.totalCost.toFixed(4)}
                    </div>
                  </div>
                  <Layers className="h-4 w-4 text-blue-400 shrink-0" />
                </div>
                <div className="space-y-2">
                  {project.items.slice(0, 4).map((trace) => (
                    <TraceChip key={trace.id} trace={trace} selectedTraceId={selectedTraceId} onSelectTrace={onSelectTrace} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        {viewMode === 'sessions' && (
          <div className="space-y-4">
            {sessionFlows.slice(0, 12).map(({ sessionId, items }) => (
              <div key={sessionId} className="rounded-xl border border-slate-800 bg-slate-900/70 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <GitBranch className="h-4 w-4 text-blue-400" />
                  <span className="text-sm font-medium text-white">Session flow</span>
                  <span className="text-xs text-slate-500 font-mono">{sessionId.slice(0, 20)}</span>
                  <span className="text-xs text-slate-500 ml-auto">{items.length} records</span>
                </div>

                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {items.map((trace, idx) => (
                    <React.Fragment key={trace.id}>
                      <TraceChip trace={trace} selectedTraceId={selectedTraceId} onSelectTrace={onSelectTrace} compact />
                      {idx < items.length - 1 && <ArrowRight className="h-4 w-4 text-slate-600 flex-shrink-0" />}
                    </React.Fragment>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

function SummaryCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900/70 p-4 text-center">
      <div className={`text-3xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">{label}</div>
    </div>
  );
}

function TraceChip({
  trace,
  selectedTraceId,
  onSelectTrace,
  compact = false,
}: {
  trace: Trace;
  selectedTraceId?: string;
  onSelectTrace?: (trace: Trace) => void;
  compact?: boolean;
}) {
  return (
    <button
      onClick={() => onSelectTrace?.(trace)}
      className={`text-left rounded-xl border transition-all ${
        selectedTraceId === trace.id
          ? 'bg-blue-500/10 border-blue-500'
          : 'bg-slate-950/40 border-slate-800 hover:border-slate-700'
      } ${compact ? 'p-3 min-w-[220px]' : 'p-3 w-full'}`}
    >
      <div className="flex items-center gap-2">
        {trace.status === 'completed' ? (
          <CheckCircle className="h-3 w-3 text-emerald-400" />
        ) : trace.status === 'failed' ? (
          <XCircle className="h-3 w-3 text-red-400" />
        ) : (
          <BarChart3 className="h-3 w-3 text-blue-400" />
        )}
        <span className="text-sm font-medium text-white truncate">{trace.agentName}</span>
      </div>
      <div className="mt-1 text-xs text-slate-400">
        Claude Code · {formatCompactDuration(trace.duration)} · {formatTokens(trace.totalTokens)}
      </div>
      {trace.projectPath && <div className="mt-1 text-[11px] text-slate-500 truncate">{shortProjectPath(trace.projectPath)}</div>}
      <div className="mt-1 text-xs text-emerald-400">${trace.cost.toFixed(4)}</div>
    </button>
  );
}

export default AgentInteractionGraph;
