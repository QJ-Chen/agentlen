import { useState } from 'react';
import { ChevronDown, ChevronRight, Code } from 'lucide-react';
import { API_URL } from '../lib/api';
import { fileBasename } from '../lib/sessionUtils';

interface SourceEvent {
  uuid: string;
  source_file: string;
  record: Record<string, unknown>;
}

interface SourceEventsResponse {
  events: SourceEvent[];
  missing: string[];
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'loaded'; events: SourceEvent[]; missing: string[] };

// Collapsed provenance block: expands to the exact raw JSONL records behind a
// call, fetched lazily on first open.
export function SourceEventsBlock({ sessionId, eventIds }: { sessionId: string; eventIds: string[] }) {
  const [isOpen, setIsOpen] = useState(false);
  const [fetchState, setFetchState] = useState<FetchState>({ status: 'idle' });

  if (eventIds.length === 0 || !sessionId) return null;

  const toggle = async () => {
    const next = !isOpen;
    setIsOpen(next);
    if (!next || fetchState.status === 'loaded' || fetchState.status === 'loading') {
      return;
    }
    setFetchState({ status: 'loading' });
    try {
      const params = new URLSearchParams({ ids: eventIds.join(',') });
      const response = await fetch(
        `${API_URL}/api/v1/sessions/${encodeURIComponent(sessionId)}/events?${params.toString()}`,
      );
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { detail?: string } | null;
        throw new Error(payload?.detail || `HTTP ${response.status}`);
      }
      const payload = (await response.json()) as SourceEventsResponse;
      setFetchState({ status: 'loaded', events: payload.events, missing: payload.missing });
    } catch (error) {
      setFetchState({ status: 'error', message: error instanceof Error ? error.message : 'Failed to load events' });
    }
  };

  return (
    <div>
      <button
        onClick={() => void toggle()}
        className="flex items-center gap-1 text-[11px] text-slate-500 hover:text-slate-900"
      >
        {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Code className="h-3 w-3" />
        原始记录 ({eventIds.length} {eventIds.length === 1 ? 'event' : 'events'})
      </button>

      {isOpen && (
        <div className="mt-2 space-y-2">
          {fetchState.status === 'loading' && (
            <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-slate-500">加载中…</div>
          )}
          {fetchState.status === 'error' && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{fetchState.message}</div>
          )}
          {fetchState.status === 'loaded' && (
            <>
              {fetchState.events.map((event) => (
                <div key={event.uuid} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <div className="flex items-center gap-2 border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-500">
                    <span className="font-mono">{event.uuid}</span>
                    <span>·</span>
                    <span className="truncate font-mono" title={event.source_file}>{fileBasename(event.source_file)}</span>
                  </div>
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all p-3 font-mono text-xs text-slate-700">
                    {JSON.stringify(event.record, null, 2)}
                  </pre>
                </div>
              ))}
              {fetchState.missing.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
                  未在日志中找到: {fetchState.missing.join(', ')}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
