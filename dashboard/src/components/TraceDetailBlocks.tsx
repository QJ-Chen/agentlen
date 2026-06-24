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
    <div className="bg-slate-800/50 rounded-lg p-4 text-center border border-slate-700/50">
      <Icon className={`w-6 h-6 mx-auto mb-2 ${color}`} />
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

export function InfoField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-500 block text-xs mb-1">{label}</span>
      <span className={mono ? 'font-mono text-xs' : 'font-medium'}>{value}</span>
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
    <div className="mt-3 flex items-start justify-between gap-3">
      <div className="min-w-0 flex items-start gap-2">
        <span className="text-xs text-gray-500 shrink-0">{label}:</span>
        <code className="text-xs text-gray-300 font-mono break-all">{value}</code>
      </div>
      {actionLabel && ActionIcon && onAction && (
        <button
          onClick={onAction}
          disabled={actionPending}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-900/70 px-2 py-1 text-[11px] text-slate-300 hover:border-slate-600 hover:text-white disabled:opacity-60"
        >
          <ActionIcon className="w-3 h-3" />
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
      <div className="flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3 text-gray-500" />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-sm text-gray-200 bg-slate-900/50 rounded p-2 border border-slate-700/50 whitespace-pre-wrap">{content}</div>
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
      <h4 className={`text-xs font-medium mb-2 ${color}`}>{title}</h4>
      <div className="space-y-1">
        {rows.map((row, idx) => (
          <div key={`${row.label}-${idx}`} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate flex-1">{row.label}</span>
            <span className="text-xs text-gray-500">{row.meta}</span>
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
    <div className="text-center py-8 text-gray-500">
      <Icon className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>{label}</p>
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
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-blue-400 flex items-center gap-1">
          <FileText className="w-3 h-3" />
          {title}
        </span>
        <button onClick={() => onCopy(text, copyId)} className="text-xs text-gray-500 hover:text-white flex items-center gap-1">
          {copiedId === copyId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copiedId === copyId ? '已复制' : '复制'}
        </button>
      </div>
      <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
        <pre className="p-3 text-xs text-blue-300 overflow-auto max-h-60 whitespace-pre-wrap font-mono">{text}</pre>
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
          label: 'text-violet-300',
          border: 'border-violet-500/30',
          bg: 'bg-violet-500/10',
          text: 'text-violet-100',
        }
      : {
          label: 'text-emerald-300',
          border: 'border-emerald-500/30',
          bg: 'bg-emerald-500/10',
          text: 'text-emerald-100',
        };

  return (
    <div className={`mt-3 rounded-lg border ${palette.border} ${palette.bg} p-3`}>
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-medium flex items-center gap-1 ${palette.label}`}>
          <Icon className="w-3 h-3" />
          {title}
        </span>
        <button onClick={() => onCopy(JSON.stringify(value, null, 2), copyId)} className="text-xs text-gray-500 hover:text-white flex items-center gap-1">
          {copiedId === copyId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copiedId === copyId ? '已复制' : '复制'}
        </button>
      </div>
      <div className="bg-slate-950/70 rounded border border-slate-800 overflow-hidden">
        <pre className={`p-3 text-xs overflow-auto max-h-60 whitespace-pre-wrap font-mono ${palette.text}`}>{JSON.stringify(value, null, 2)}</pre>
      </div>
    </div>
  );
}
