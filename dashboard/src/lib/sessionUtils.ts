export function cleanSessionText(text?: string | null): string {
  if (!text) return '';
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<command-name>.*?<\/command-name>/gi, '')
    .replace(/<command-args>.*?<\/command-args>/gi, '')
    .replace(/<command-message>.*?<\/command-message>/gi, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
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

export function shortProjectPath(path?: string | null): string | null {
  if (!path) return null;
  const separator = path.includes('\\') ? '\\' : '/';
  const segments = path.split(/[/\\]+/).filter(Boolean);
  if (segments.length <= 2) return path;
  return segments.slice(-2).join(separator);
}
