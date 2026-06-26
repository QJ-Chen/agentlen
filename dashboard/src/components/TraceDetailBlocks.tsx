import type { ComponentType } from 'react';
import { Check, Copy, FileText } from 'lucide-react';

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
  color,
  icon: Icon,
  value,
  copyId,
  copiedId,
  onCopy,
}: {
  title: string;
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
      <div className="overflow-hidden rounded-xl border border-white/60 bg-white/80">
        <pre className={`max-h-60 overflow-auto whitespace-pre-wrap p-3 font-mono text-xs ${palette.text}`}>{JSON.stringify(value, null, 2)}</pre>
      </div>
    </div>
  );
}
