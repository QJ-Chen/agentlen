import { useState } from 'react';
import { Check, ChevronDown, ChevronRight, Copy, Terminal, Wrench, X } from 'lucide-react';
import type { ToolCall } from '../types';
import { fileBasename, truncateText } from '../lib/sessionUtils';

const PREVIEW_LINES = 12;
const DIFF_SIDE_LINES = 40;
const DIFF_CONTEXT_LINES = 2;

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function inputField(tool: ToolCall, key: string): string | null {
  const input = tool.input;
  if (!input || typeof input !== 'object') return null;
  return asString((input as Record<string, unknown>)[key]);
}

// One-line human summary of the call, shown next to the tool name.
function keyArgSummary(tool: ToolCall): string {
  const filePath = inputField(tool, 'file_path') ?? inputField(tool, 'notebook_path');
  if (filePath) return fileBasename(filePath);
  const command = inputField(tool, 'command');
  if (command) return truncateText(command.replace(/\n/g, ' '), 72);
  const pattern = inputField(tool, 'pattern');
  if (pattern) return truncateText(pattern, 72);
  const description = inputField(tool, 'description') ?? inputField(tool, 'prompt');
  if (description) return truncateText(description.replace(/\n/g, ' '), 72);
  const skill = inputField(tool, 'skill');
  if (skill) return skill;
  return '';
}

function outputAsText(tool: ToolCall): string {
  if (typeof tool.output === 'string') return tool.output;
  if (tool.output == null) return '';
  try {
    return JSON.stringify(tool.output, null, 2);
  } catch {
    return String(tool.output);
  }
}

interface LineDiff {
  contextBefore: string[];
  removed: string[];
  added: string[];
  contextAfter: string[];
}

// Trim shared leading/trailing lines so only the changed middle renders,
// with a couple of context lines on each side.
function computeLineDiff(oldStr: string, newStr: string): LineDiff {
  const a = oldStr.split('\n');
  const b = newStr.split('\n');
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix++;
  }
  return {
    contextBefore: a.slice(Math.max(0, prefix - DIFF_CONTEXT_LINES), prefix),
    removed: a.slice(prefix, a.length - suffix),
    added: b.slice(prefix, b.length - suffix),
    contextAfter: a.slice(a.length - suffix, Math.min(a.length, a.length - suffix + DIFF_CONTEXT_LINES)),
  };
}

function DiffLine({ marker, text, tone }: { marker: string; text: string; tone: 'removed' | 'added' | 'context' }) {
  const toneClass =
    tone === 'removed'
      ? 'bg-red-50 text-red-800'
      : tone === 'added'
        ? 'bg-emerald-50 text-emerald-800'
        : 'text-slate-500';
  return (
    <div className={`flex ${toneClass}`}>
      <span className="w-5 shrink-0 select-none text-center opacity-60">{marker}</span>
      <span className="whitespace-pre-wrap break-all">{text || ' '}</span>
    </div>
  );
}

function EditDiffBody({ tool }: { tool: ToolCall }) {
  const oldString = inputField(tool, 'old_string') ?? '';
  const newString = inputField(tool, 'new_string') ?? '';
  const [showAll, setShowAll] = useState(false);
  const diff = computeLineDiff(oldString, newString);
  const removed = showAll ? diff.removed : diff.removed.slice(0, DIFF_SIDE_LINES);
  const added = showAll ? diff.added : diff.added.slice(0, DIFF_SIDE_LINES);
  const hiddenLines =
    diff.removed.length - removed.length + (diff.added.length - added.length);

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white font-mono text-xs">
      <div className="max-h-80 overflow-auto p-2">
        {diff.contextBefore.map((line, idx) => (
          <DiffLine key={`cb-${idx}`} marker=" " text={line} tone="context" />
        ))}
        {removed.map((line, idx) => (
          <DiffLine key={`r-${idx}`} marker="-" text={line} tone="removed" />
        ))}
        {added.map((line, idx) => (
          <DiffLine key={`a-${idx}`} marker="+" text={line} tone="added" />
        ))}
        {diff.contextAfter.map((line, idx) => (
          <DiffLine key={`ca-${idx}`} marker=" " text={line} tone="context" />
        ))}
      </div>
      {hiddenLines > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full border-t border-slate-100 px-2 py-1 text-left text-[11px] text-slate-500 hover:bg-slate-50"
        >
          展开其余 {hiddenLines} 行
        </button>
      )}
    </div>
  );
}

function ExpandableLines({
  text,
  className,
  lineClassName,
}: {
  text: string;
  className: string;
  lineClassName?: string;
}) {
  const [showAll, setShowAll] = useState(false);
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const visible = showAll ? lines : lines.slice(0, PREVIEW_LINES);
  const hidden = lines.length - visible.length;

  return (
    <div className={`overflow-hidden rounded-xl ${className}`}>
      <pre className={`max-h-80 overflow-auto whitespace-pre-wrap break-all p-2 font-mono text-xs ${lineClassName ?? ''}`}>
        {visible.join('\n')}
      </pre>
      {hidden > 0 && (
        <button
          onClick={() => setShowAll(true)}
          className="w-full border-t border-white/20 px-2 py-1 text-left text-[11px] opacity-70 hover:opacity-100"
        >
          展开其余 {hidden} 行
        </button>
      )}
    </div>
  );
}

function BashBody({ tool }: { tool: ToolCall }) {
  const command = inputField(tool, 'command') ?? '';
  const output = tool.error || outputAsText(tool);
  const text = `$ ${command}${output ? `\n${output}` : '\n(无输出)'}`;
  return (
    <ExpandableLines
      text={text}
      className="border border-slate-700 bg-slate-900"
      lineClassName={tool.status === 'error' ? 'text-red-300' : 'text-slate-100'}
    />
  );
}

function WriteBody({ tool }: { tool: ToolCall }) {
  const content = inputField(tool, 'content') ?? '';
  return <ExpandableLines text={content} className="border border-slate-200 bg-white text-slate-700" />;
}

function DefaultBody({ tool }: { tool: ToolCall }) {
  if (!tool.input || Object.keys(tool.input).length === 0) return null;
  return (
    <ExpandableLines
      text={JSON.stringify(tool.input, null, 2)}
      className="border border-slate-200 bg-white text-slate-700"
    />
  );
}

function OutputBlock({ tool }: { tool: ToolCall }) {
  const text = tool.error || outputAsText(tool);
  if (!text) return null;
  const isError = tool.status === 'error';
  return (
    <div>
      <div className={`mb-1 text-[11px] font-semibold ${isError ? 'text-red-600' : 'text-slate-400'}`}>
        {isError ? '错误' : '输出'}
      </div>
      <ExpandableLines
        text={text}
        className={isError ? 'border border-red-200 bg-red-50 text-red-800' : 'border border-slate-200 bg-slate-50 text-slate-600'}
      />
    </div>
  );
}

export function ToolCallCard({
  tool,
  copyId,
  copiedId,
  onCopy,
}: {
  tool: ToolCall;
  copyId: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const [showFullInput, setShowFullInput] = useState(false);
  const isError = tool.status === 'error';
  const summary = keyArgSummary(tool);
  const filePath = inputField(tool, 'file_path') ?? inputField(tool, 'notebook_path');
  // Edit/Write/Bash bodies already visualize the interesting part of the
  // input; everything else falls back to the JSON input preview.
  const body =
    tool.name === 'Edit' && inputField(tool, 'old_string') != null ? (
      <EditDiffBody tool={tool} />
    ) : tool.name === 'Bash' && inputField(tool, 'command') ? (
      <BashBody tool={tool} />
    ) : tool.name === 'Write' && inputField(tool, 'content') != null ? (
      <WriteBody tool={tool} />
    ) : (
      <DefaultBody tool={tool} />
    );
  const showSeparateOutput = tool.name !== 'Bash';

  return (
    <div className={`rounded-2xl border p-3 shadow-sm shadow-slate-200/40 ${isError ? 'border-red-200 bg-red-50/60' : 'border-violet-200/80 bg-violet-50/60'}`}>
      <div className="mb-2 flex items-center gap-2">
        {tool.name === 'Bash' ? (
          <Terminal className={`h-3.5 w-3.5 shrink-0 ${isError ? 'text-red-500' : 'text-violet-500'}`} />
        ) : (
          <Wrench className={`h-3.5 w-3.5 shrink-0 ${isError ? 'text-red-500' : 'text-violet-500'}`} />
        )}
        <span className={`text-xs font-semibold ${isError ? 'text-red-700' : 'text-violet-700'}`}>{tool.name}</span>
        {summary && <span className="min-w-0 truncate font-mono text-xs text-slate-600">{summary}</span>}
        <span
          className={`ml-auto flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${isError ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'}`}
        >
          {isError ? <X className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
          {isError ? '错误' : '成功'}
        </span>
        <button
          onClick={() => onCopy(JSON.stringify({ name: tool.name, input: tool.input, output: tool.output, error: tool.error }, null, 2), copyId)}
          className="flex shrink-0 items-center gap-1 text-xs text-slate-500 hover:text-slate-900"
        >
          {copiedId === copyId ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          {copiedId === copyId ? '已复制' : '复制'}
        </button>
      </div>

      {filePath && (
        <div className="mb-2 break-all font-mono text-[11px] text-slate-500">{filePath}</div>
      )}

      <div className="space-y-2">
        {body}
        {showSeparateOutput && <OutputBlock tool={tool} />}
        <button
          onClick={() => setShowFullInput((current) => !current)}
          className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900"
        >
          {showFullInput ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          完整输入
        </button>
        {showFullInput && (
          <ExpandableLines
            text={JSON.stringify(tool.input ?? {}, null, 2)}
            className="border border-slate-200 bg-white text-slate-700"
          />
        )}
      </div>
    </div>
  );
}
