export interface SessionTextBlockText {
  kind: 'text';
  text: string;
}

export interface SessionTextBlockTaskNotification {
  kind: 'task-notification';
  taskId?: string;
  toolUseId?: string;
  outputFile?: string;
  status?: string;
  summary?: string;
  note?: string;
  truncated: boolean;
}

export interface SessionTextBlockBashOutput {
  kind: 'bash-output';
  stdout?: string;
  stderr?: string;
  exitCode?: string;
  hasStdout: boolean;
  hasStderr: boolean;
  hasInput: boolean;
  truncated: boolean;
}

export type SessionTextBlock =
  | SessionTextBlockText
  | SessionTextBlockTaskNotification
  | SessionTextBlockBashOutput;

export type SessionControlBlock = Exclude<SessionTextBlock, SessionTextBlockText>;

const OUTER_CONTROL_NAMES = [
  'task-notification',
  'bash-stdout',
  'bash-stderr',
  'bash-input',
  'bash-output',
  'bash-exit-code',
] as const;

const OUTER_CONTROL_PATTERN = OUTER_CONTROL_NAMES.join('|');
const TASK_FIELD_PATTERN = [
  'task-id',
  'task_id',
  'tool-use-id',
  'tool_use_id',
  'output-file',
  'output_file',
  'status',
  'summary',
  'note',
].join('|');

interface ControlOpener {
  name: string;
  index: number;
  end: number;
}

function findNextControlOpener(text: string, start: number): ControlOpener | null {
  const pattern = new RegExp(`<\\s*(${OUTER_CONTROL_PATTERN})\\b[^>]*>`, 'gi');
  pattern.lastIndex = start;
  const match = pattern.exec(text);
  if (!match) return null;
  return {
    name: match[1].toLowerCase(),
    index: match.index,
    end: pattern.lastIndex,
  };
}

function cleanLegacyControlText(text: string): string {
  return text
    .replace(/<local-command-caveat\b[^>]*>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<local-command-caveat\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<local-command-stdout\b[^>]*>[\s\S]*?<\/local-command-stdout>/gi, '')
    .replace(/<local-command-stdout\b[^>]*>[\s\S]*$/gi, '')
    .replace(/<(command-name|command-args|command-message)\b[^>]*>[^<]*(?:<\/\1>|$)/gi, '')
    .replace(/<(task-id|task_id|tool-use-id|tool_use_id|output-file|output_file|status|summary)\b[^>]*>[^<]*(?:<\/\1>|$)/gi, '')
    .replace(/<note\b[^>]*>[\s\S]*?(?:<\/note>|$)/gi, '')
    .replace(new RegExp(`<\\/?\\s*(?:${OUTER_CONTROL_PATTERN})\\b[^>]*>`, 'gi'), '')
    .replace(/<\/?\s*(?:local-command-caveat|local-command-stdout|command-name|command-args|command-message)\b[^>]*>/gi, '');
}

function pushTextBlock(blocks: SessionTextBlock[], text: string): void {
  const cleaned = cleanLegacyControlText(text).trim();
  if (!cleaned) return;
  const previous = blocks[blocks.length - 1];
  if (previous?.kind === 'text') {
    previous.text = `${previous.text}\n${cleaned}`;
  } else {
    blocks.push({ kind: 'text', text: cleaned });
  }
}

function normalizeFieldValue(value: string): string | undefined {
  const cleaned = value
    .replace(new RegExp(`<\\/?\\s*(?:${TASK_FIELD_PATTERN})\\b[^>]*>`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned || undefined;
}

function extractTaskField(payload: string, aliases: string[]): string | undefined {
  let selected: RegExpExecArray | null = null;
  let selectedName = '';

  for (const alias of aliases) {
    const opener = new RegExp(`<\\s*(${alias})\\b[^>]*>`, 'i').exec(payload);
    if (opener && (!selected || opener.index < selected.index)) {
      selected = opener;
      selectedName = opener[1];
    }
  }

  if (!selected) return undefined;
  const valueStart = selected.index + selected[0].length;
  const close = new RegExp(`<\\/\\s*${selectedName}\\s*>`, 'i').exec(payload.slice(valueStart));
  const nextField = new RegExp(`<\\s*(?:${TASK_FIELD_PATTERN})\\b[^>]*>`, 'i').exec(payload.slice(valueStart));
  const closeIndex = close ? valueStart + close.index : payload.length;
  const nextFieldIndex = nextField ? valueStart + nextField.index : payload.length;
  return normalizeFieldValue(payload.slice(valueStart, Math.min(closeIndex, nextFieldIndex)));
}

function parseTaskNotification(payload: string, truncated: boolean): SessionTextBlockTaskNotification {
  return {
    kind: 'task-notification',
    taskId: extractTaskField(payload, ['task-id', 'task_id']),
    toolUseId: extractTaskField(payload, ['tool-use-id', 'tool_use_id']),
    outputFile: extractTaskField(payload, ['output-file', 'output_file']),
    status: extractTaskField(payload, ['status']),
    summary: extractTaskField(payload, ['summary']),
    note: extractTaskField(payload, ['note']),
    truncated,
  };
}

function appendBashControl(
  blocks: SessionTextBlock[],
  name: string,
  payload: string,
  truncated: boolean,
): void {
  const previous = blocks[blocks.length - 1];
  const block: SessionTextBlockBashOutput = previous?.kind === 'bash-output'
    ? previous
    : {
        kind: 'bash-output',
        hasStdout: false,
        hasStderr: false,
        hasInput: false,
        truncated: false,
      };

  if (previous !== block) blocks.push(block);
  block.truncated ||= truncated;

  if (name === 'bash-input') {
    block.hasInput = true;
  } else if (name === 'bash-stderr') {
    block.hasStderr = true;
    block.stderr = payload;
  } else if (name === 'bash-exit-code') {
    block.exitCode = payload.trim() || undefined;
  } else {
    block.hasStdout = true;
    block.stdout = payload;
  }
}

export function parseSessionText(text?: string | null): SessionTextBlock[] {
  if (!text) return [];

  const blocks: SessionTextBlock[] = [];
  let cursor = 0;

  while (cursor < text.length) {
    const opener = findNextControlOpener(text, cursor);
    if (!opener) {
      pushTextBlock(blocks, text.slice(cursor));
      break;
    }

    pushTextBlock(blocks, text.slice(cursor, opener.index));

    const closePattern = new RegExp(`<\\/\\s*${opener.name}\\s*>`, 'gi');
    closePattern.lastIndex = opener.end;
    const close = closePattern.exec(text);
    const nextOpener = close ? null : findNextControlOpener(text, opener.end);
    const payloadEnd = close ? close.index : nextOpener?.index ?? text.length;
    const blockEnd = close ? closePattern.lastIndex : payloadEnd;
    const payload = text.slice(opener.end, payloadEnd);
    const truncated = !close;

    if (opener.name === 'task-notification') {
      blocks.push(parseTaskNotification(payload, truncated));
    } else {
      appendBashControl(blocks, opener.name, payload, truncated);
    }

    cursor = Math.max(blockEnd, opener.end);
  }

  return blocks;
}

export function cleanSessionText(text?: string | null): string {
  return parseSessionText(text)
    .filter((block): block is SessionTextBlockText => block.kind === 'text')
    .map((block) => block.text)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

export function clampNonNegative(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

export function formatDuration(ms?: number): string {
  if (!ms) return '-';
  const safeMs = clampNonNegative(ms);
  if (safeMs < 1000) return `${Math.round(safeMs)}ms`;
  if (safeMs < 60_000) return `${(safeMs / 1000).toFixed(1)}s`;
  const minutes = Math.floor(safeMs / 60_000);
  const seconds = Math.round((safeMs % 60_000) / 1000);
  return `${minutes}m ${seconds}s`;
}

export function formatCompactDuration(ms?: number): string {
  if (!ms) return '-';
  const safeMs = clampNonNegative(ms);
  const totalMinutes = Math.round(safeMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours < 24) return `${hours}h ${minutes}m`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `${days}d ${remainingHours}h`;
}

export function formatTokens(tokens: number): string {
  const safeTokens = clampNonNegative(tokens);
  if (safeTokens < 1000) return `${safeTokens}`;
  if (safeTokens < 1_000_000) return `${(safeTokens / 1000).toFixed(1)}K`;
  return `${(safeTokens / 1_000_000).toFixed(2)}M`;
}

export function formatInteger(value: number): string {
  return clampNonNegative(value).toLocaleString();
}

export function formatTimestamp(timestamp?: number | string): string {
  if (timestamp === undefined || timestamp === null || timestamp === '') return '-';
  const raw = typeof timestamp === 'string' ? Number(timestamp) : timestamp;
  if (!Number.isFinite(raw) || raw <= 0) return '-';
  const normalized = raw < 10_000_000_000 ? raw * 1000 : raw;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime())
    ? '-'
    : date.toLocaleString([], {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
}

export function formatTokenPair(inputTokens: number, outputTokens: number): string {
  return `${formatInteger(inputTokens)} → ${formatInteger(outputTokens)} tokens`;
}

export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const delta = clampNonNegative(now - timestamp);
  if (delta < 60_000) return 'just now';
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)}m ago`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)}h ago`;
  return `${Math.floor(delta / 86_400_000)}d ago`;
}

export function toStartOfLocalDayISOString(dateInput?: string | null): string | null {
  if (!dateInput) return null;
  const date = new Date(`${dateInput}T00:00:00.000`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function toEndOfLocalDayISOString(dateInput?: string | null): string | null {
  if (!dateInput) return null;
  const date = new Date(`${dateInput}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function shortProjectPath(path?: string | null): string | null {
  if (!path) return null;
  const separator = path.includes('\\') ? '\\' : '/';
  const segments = path.split(/[/\\]+/).filter(Boolean);
  if (segments.length <= 2) return path;
  return segments.slice(-2).join(separator);
}
