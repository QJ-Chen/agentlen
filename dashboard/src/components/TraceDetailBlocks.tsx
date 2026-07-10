import { useState, type ComponentType } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, FileText, TerminalSquare } from 'lucide-react';
import type { SessionControlBlock } from '../lib/sessionUtils';

export function MetricCard({
  icon: Icon,
  color,
  value,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  color: string;
  value: string;
  label: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-4 text-center shadow-sm shadow-slate-200/70">
      <Icon className={`mx-auto mb-2 h-6 w-6 ${color}`} />
      <div className="text-2xl font-semibold text-slate-950">{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

export function InfoField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <span className={mono ? 'font-mono text-xs text-slate-700' : 'font-medium text-slate-900'}>{value}</span>
    </div>
  );
}

export function PathField({
  label,
  value,
  actionLabel,
  actionIcon: ActionIcon,
  actionPending = false,
  onAction,
}: {
  label: string;
  value: string;
  actionLabel?: string;
  actionIcon?: ComponentType<{ className?: string }>;
  actionPending?: boolean;
  onAction?: () => void;
}) {
  return (
    <div className="mt-3 flex items-start justify-between gap-3 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-4 py-3">
      <div className="min-w-0 flex items-start gap-2">
        <span className="shrink-0 text-xs font-medium text-slate-500">{label}:</span>
        <code className="break-all text-xs text-slate-700 font-mono">{value}</code>
      </div>
      {actionLabel && ActionIcon && onAction && (
        <button
          onClick={onAction}
          disabled={actionPending}
          className="shrink-0 inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-600 shadow-sm hover:border-slate-300 hover:text-slate-900 disabled:opacity-60"
        >
          <ActionIcon className="h-3 w-3" />
          {actionPending ? 'Opening…' : actionLabel}
        </button>
      )}
    </div>
  );
}

export function PreviewBlock({
  icon: Icon,
  label,
  content,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  content: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <Icon className="h-3 w-3 text-slate-400" />
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <div className="rounded-2xl border border-slate-200/70 bg-slate-50/85 p-3 text-sm leading-6 text-slate-700 whitespace-pre-wrap">
        {content}
      </div>
    </div>
  );
}

export function SummaryList({
  title,
  color,
  rows,
}: {
  title: string;
  color: string;
  rows: Array<{ label: string; meta: string }>;
}) {
  return (
    <div>
      <h4 className={`mb-2 text-xs font-semibold uppercase tracking-wide ${color}`}>{title}</h4>
      <div className="space-y-2">
        {rows.map((row, idx) => (
          <div key={`${row.label}-${idx}`} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/70 bg-white px-3 py-2 text-sm shadow-sm shadow-slate-200/40">
            <span className="flex-1 truncate text-slate-700">{row.label}</span>
            <span className="text-xs text-slate-500">{row.meta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-slate-50/80 py-10 text-center text-slate-500">
      <Icon className="mx-auto mb-3 h-12 w-12 opacity-50" />
      <p className="text-sm font-medium">{label}</p>
    </div>
  );
}

export function ControlPlanePromptBlock({
  block,
  copyId,
  copiedId,
  onCopy,
}: {
  block: SessionControlBlock;
  copyId: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);

  if (block.kind === 'task-notification') {
    const copyText = [
      block.status && `Status: ${block.status}`,
      block.summary && `Summary: ${block.summary}`,
      block.note && `Note: ${block.note}`,
      block.taskId && `Task ID: ${block.taskId}`,
      block.toolUseId && `Tool use ID: ${block.toolUseId}`,
      block.outputFile && `Output file: ${block.outputFile}`,
      block.truncated && 'Incomplete: yes',
    ].filter(Boolean).join('\n');
    const status = block.status || 'unknown';
    const statusClass = /^(completed|done|success|succeeded)$/i.test(status)
      ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
      : /^(failed|error|cancelled)$/i.test(status)
        ? 'border-red-200 bg-red-50 text-red-700'
        : 'border-amber-200 bg-amber-50 text-amber-700';

    return (
      <div className="rounded-2xl border border-amber-200/80 bg-amber-50/55">
        <div className="flex flex-wrap items-center gap-2 border-b border-amber-100/90 px-4 py-3">
          <span className="text-xs font-semibold text-amber-800">任务通知</span>
          {block.status && <span className={`rounded-full border px-2 py-0.5 text-[11px] ${statusClass}`}>{block.status}</span>}
          {block.truncated && <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">不完整</span>}
          <button onClick={() => onCopy(copyText, copyId)} className="ml-auto flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
            {copiedId === copyId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copiedId === copyId ? '已复制' : '复制'}
          </button>
        </div>
        <div className="space-y-2 px-4 py-3">
          <div className="text-sm font-medium text-slate-900">{block.summary || block.taskId || '任务状态已更新'}</div>
          {block.note && <div className="text-xs leading-5 text-slate-600">{block.note}</div>}
          {(block.taskId || block.toolUseId || block.outputFile) && (
            <div className="space-y-1 text-[11px] text-slate-500">
              {block.taskId && <div className="font-mono">task: {block.taskId}</div>}
              {block.toolUseId && <div className="font-mono">tool: {block.toolUseId}</div>}
              {block.outputFile && <div className="break-all font-mono">output: {block.outputFile}</div>}
            </div>
          )}
        </div>
      </div>
    );
  }

  const hasOutput = !!block.stdout?.trim();
  const hasError = !!block.stderr?.trim();
  const copyText = [
    block.hasStdout && `stdout:\n${block.stdout || ''}`,
    block.hasStderr && `stderr:\n${block.stderr || ''}`,
    block.exitCode && `exit code: ${block.exitCode}`,
    block.truncated && 'incomplete: yes',
  ].filter(Boolean).join('\n\n');
  const title = block.hasStderr && !block.hasStdout ? 'Bash 错误' : 'Bash 输出';
  const isLong = (block.stdout?.length || 0) + (block.stderr?.length || 0) > 500;

  return (
    <div className="rounded-2xl border border-violet-200/80 bg-violet-50/55">
      <div className="flex flex-wrap items-center gap-2 border-b border-violet-100/90 px-4 py-3">
        <TerminalSquare className="h-3.5 w-3.5 text-violet-700" />
        <span className="text-xs font-semibold text-violet-800">{title}</span>
        {block.exitCode && <span className="rounded-full border border-violet-200 bg-white px-2 py-0.5 font-mono text-[11px] text-violet-700">exit {block.exitCode}</span>}
        {block.truncated && <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[11px] text-orange-700">不完整</span>}
        <div className="ml-auto flex items-center gap-2">
          {isLong && (
            <button onClick={() => setExpanded((current) => !current)} className="flex items-center gap-1 text-xs text-violet-700 hover:text-violet-900">
              {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {expanded ? '收起' : '展开'}
            </button>
          )}
          <button onClick={() => onCopy(copyText, copyId)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
            {copiedId === copyId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
            {copiedId === copyId ? '已复制' : '复制'}
          </button>
        </div>
      </div>
      <div className={`space-y-3 overflow-auto px-4 py-3 ${expanded ? 'max-h-none' : 'max-h-44'}`}>
        {block.hasStdout && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-violet-600">stdout</div>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-700">{hasOutput ? block.stdout : '无输出'}</pre>
          </div>
        )}
        {block.hasStderr && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-red-600">stderr</div>
            <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-slate-700">{hasError ? block.stderr : '无错误输出'}</pre>
          </div>
        )}
        {!block.hasStdout && !block.hasStderr && <div className="text-sm text-slate-500">无输出</div>}
      </div>
    </div>
  );
}

export function JsonOrTextBlock({
  title,
  value,
  copyId,
  copiedId,
  onCopy,
}: {
  title: string;
  value: unknown;
  copyId: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="mt-3 rounded-2xl border border-slate-200/80 bg-white p-3 shadow-sm shadow-slate-200/50">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1 text-xs font-semibold text-sky-700">
          <FileText className="h-3 w-3" />
          {title}
        </span>
        <button onClick={() => onCopy(text, copyId)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
          {copiedId === copyId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copiedId === copyId ? '已复制' : '复制'}
        </button>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50/80">
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs text-slate-700">{text}</pre>
      </div>
    </div>
  );
}

export function StructuredResponseBlock({
  title,
  subtitle,
  color,
  icon: Icon,
  value,
  copyId,
  copiedId,
  onCopy,
}: {
  title: string;
  subtitle?: string;
  color: 'violet' | 'emerald';
  icon: ComponentType<{ className?: string }>;
  value: unknown;
  copyId: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const palette =
    color === 'violet'
      ? {
          label: 'text-violet-700',
          border: 'border-violet-200/80',
          bg: 'bg-violet-50/90',
          text: 'text-violet-900',
        }
      : {
          label: 'text-emerald-700',
          border: 'border-emerald-200/80',
          bg: 'bg-emerald-50/90',
          text: 'text-emerald-900',
        };

  return (
    <div className={`mt-3 rounded-2xl border ${palette.border} ${palette.bg} p-3 shadow-sm shadow-slate-200/40`}>
      <div className="mb-2 flex items-center justify-between">
        <span className={`flex items-center gap-1 text-xs font-semibold ${palette.label}`}>
          <Icon className="h-3 w-3" />
          {title}
        </span>
        <button onClick={() => onCopy(JSON.stringify(value, null, 2), copyId)} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
          {copiedId === copyId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copiedId === copyId ? '已复制' : '复制'}
        </button>
      </div>
      {subtitle && (
        <div className="mb-2 rounded-xl border border-white/60 bg-white/80 px-3 py-2">
          <span className="font-mono text-xs text-slate-600 break-all">{subtitle}</span>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-white/60 bg-white/80">
        <pre className={`max-h-60 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs ${palette.text}`}>{JSON.stringify(value, null, 2)}</pre>
      </div>
    </div>
  );
}
