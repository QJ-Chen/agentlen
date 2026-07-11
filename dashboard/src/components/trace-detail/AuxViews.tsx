import { Check, Code, FileText, Hash, Layers, MessageSquare } from 'lucide-react';
import type { Trace } from '../../types';
import type { RawSessionRecord } from '../../lib/sessionApiTypes';
import { EmptyState, JsonOrTextBlock, MetricCard } from '../TraceDetailBlocks';
import { SURFACE_CLASS } from './shared';

interface TaskSummary {
  created?: number;
  updated?: number;
  listed?: number;
  got?: number;
  latest_statuses?: Array<{ taskId: string; status: string }>;
  latest?: { taskId?: string; status?: string; subject?: string; description?: string } | null;
  tasks?: Array<{
    taskId: string;
    status?: string;
    subject?: string;
    description?: string;
    created_prompt_idx?: number;
    latest_status_prompt_idx?: number;
  }>;
}

export function TaskStatusView({ trace }: { trace: Trace & { raw?: RawSessionRecord } }) {
  const taskSummary = trace.metadata?.task_summary as TaskSummary | undefined;
  const tasks = taskSummary?.tasks || [];

  if (tasks.length === 0 || !taskSummary) {
    return <EmptyState icon={Layers} label="无任务状态摘要" />;
  }

  return (
    <div className="space-y-4">
      <div className={SURFACE_CLASS}>
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
          <Layers className="h-4 w-4 text-slate-400" />
          任务状态
        </h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4 text-sm">
          <MetricCard icon={Check} color="text-emerald-600" value={String(taskSummary.created || 0)} label="创建" />
          <MetricCard icon={MessageSquare} color="text-cyan-600" value={String(taskSummary.updated || 0)} label="更新" />
          <MetricCard icon={Hash} color="text-violet-600" value={String(taskSummary.listed || 0)} label="列表" />
          <MetricCard icon={Code} color="text-orange-600" value={String(taskSummary.got || 0)} label="获取" />
        </div>
        <div className="mt-4 space-y-2">
          {tasks.map((task) => (
            <div key={task.taskId} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-xs text-slate-600 truncate">{task.taskId}</span>
                <span className="rounded-full border border-clay-100 bg-clay-50 px-2.5 py-1 text-xs text-clay-700">{task.status || 'unknown'}</span>
              </div>
              {task.subject && <div className="text-sm font-medium text-slate-900">{task.subject}</div>}
              {task.description && <div className="text-xs text-slate-500 whitespace-pre-wrap">{task.description}</div>}
              {task.created_prompt_idx != null && (
                <div className="text-[11px] text-slate-400">created at user prompt #{task.created_prompt_idx}</div>
              )}
              {task.latest_status_prompt_idx != null && task.latest_status_prompt_idx !== task.created_prompt_idx && (
                <div className="text-[11px] text-slate-400">latest status updated at user prompt #{task.latest_status_prompt_idx}</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function VisionView({ trace }: { trace: Trace }) {
  const references = trace.visionReferences || [];
  if (references.length === 0) {
    return <EmptyState icon={FileText} label="No vision context found." />;
  }

  return (
    <div className="space-y-4">
      <div className={SURFACE_CLASS}>
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
          <FileText className="h-4 w-4 text-slate-400" />
          Vision context
        </h3>
        <div className="space-y-3">
          {references.map((reference, index) => (
            <div key={`${reference.path}-${index}`} className="rounded-2xl border border-slate-200 bg-slate-50/80 px-4 py-3">
              <div className="text-sm font-medium text-slate-900 break-all">{reference.path}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                {reference.origin && <span>{reference.origin}</span>}
                {reference.mime_type && (
                  <>
                    <span>·</span>
                    <span>{reference.mime_type}</span>
                  </>
                )}
                {reference.absolute_path && reference.absolute_path !== reference.path && (
                  <>
                    <span>·</span>
                    <span className="break-all font-mono">{reference.absolute_path}</span>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function RawView({
  trace,
  copiedId,
  onCopy,
}: {
  trace: Trace & { raw?: RawSessionRecord };
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const rawJson = JSON.stringify(trace.raw || trace, null, 2);
  return (
    <JsonOrTextBlock
      title="原始 Session 记录"
      value={rawJson}
      copyId="raw-trace"
      copiedId={copiedId}
      onCopy={onCopy}
    />
  );
}
