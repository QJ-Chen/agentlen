export type ReplayMessageKind = 'user' | 'thinking' | 'tool' | 'text' | 'empty' | 'subagent';

export const REPLAY_KIND_LABELS: Record<ReplayMessageKind, string> = {
  user: '用户',
  thinking: '思考',
  tool: '工具',
  text: '文本',
  empty: '空响应',
  subagent: 'Subagent',
};

export const DEFAULT_VISIBLE_KINDS: Record<ReplayMessageKind, boolean> = {
  user: true,
  thinking: true,
  tool: true,
  text: true,
  empty: true,
  subagent: true,
};

export const SURFACE_CLASS = 'rounded-3xl border border-slate-200/80 bg-white shadow-sm shadow-slate-200/60';

export function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
  });
}
