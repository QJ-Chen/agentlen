import React from 'react';
import { ChevronDown, ChevronRight, Wrench } from 'lucide-react';
import type { LLMCall, ToolCall } from '../types';
import { getCallRenderState, type DetailLevel } from '../lib/callClassification';
import { cleanSessionText, formatDuration, formatTokenPair } from '../lib/sessionUtils';
import { ToolCallCard } from './ToolCallCard';
import { JsonOrTextBlock, StructuredResponseBlock } from './TraceDetailBlocks';

interface CallRecordRowProps {
  call: LLMCall;
  callKey: string;
  toolScope: ToolCall[];
  allLLMCalls: LLMCall[];
  detailLevel: DetailLevel;
  isExpanded: boolean;
  showTokenUsage: boolean;
  copiedId: string | null;
  onToggle: (key: string) => void;
  onCopy: (text: string, id: string) => void;
}

const CallRecordRowInner: React.FC<CallRecordRowProps> = ({
  call,
  callKey,
  toolScope,
  allLLMCalls,
  detailLevel,
  isExpanded,
  showTokenUsage,
  copiedId,
  onToggle,
  onCopy,
}) => {
  const isCallExpanded = detailLevel !== 'summary' && isExpanded;
  const { relatedTools, responseStyle, formattedToolResponse } = getCallRenderState(call, toolScope, allLLMCalls);

  return (
    <div className={`rounded-2xl border-l-4 transition-all ${isCallExpanded ? 'bg-white border-violet-300 shadow-md shadow-violet-100/40 ring-1 ring-violet-100' : 'bg-slate-50/80 border-slate-200/80 border-l-slate-300'}`}>
      <button onClick={() => onToggle(callKey)} className="w-full px-3 py-2 flex items-center gap-2 text-left">
        <div className={`w-6 h-6 rounded-full flex items-center justify-center ring-1 ring-white ${responseStyle.badge}`}>
          <responseStyle.icon className={`w-3.5 h-3.5 ${responseStyle.accent}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 min-w-0">
            <span className={`text-[11px] px-1.5 py-0.5 rounded-full ${responseStyle.badge}`}>{responseStyle.label}</span>
            <div className={`text-sm truncate ${responseStyle.accent}`}>
              {responseStyle.preview
                ? `${responseStyle.preview.replace(/\n/g, ' ').slice(0, 60)}${responseStyle.preview.length > 60 ? '...' : ''}`
                : '无响应内容'}
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2 flex-wrap">
            {call.model && call.model !== 'unknown' && <span>{call.model}</span>}
            {showTokenUsage && call.totalTokens > 0 && (
              <>
                {call.model && call.model !== 'unknown' && <span>·</span>}
                <span>{formatTokenPair(call.inputTokens, call.outputTokens)}</span>
              </>
            )}
            {call.duration > 0 && <span>·</span>}
            {call.duration > 0 && <span>{formatDuration(call.duration)}</span>}
            {detailLevel === 'verbose' && call.sourceEventIds && call.sourceEventIds[0] && (
              <>
                <span>·</span>
                <span className="font-mono">event {call.sourceEventIds[0]}</span>
              </>
            )}
          </div>
        </div>
        {detailLevel !== 'summary' && (isCallExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />)}
      </button>

      {isCallExpanded && (
        <div className="ml-6 border-l-2 border-violet-100 px-3 pb-3 pt-3 space-y-3 bg-violet-50/35 rounded-bl-2xl">
          {call.response && !formattedToolResponse && (
            <JsonOrTextBlock
              title={responseStyle.label}
              value={
                responseStyle.kind === 'thinking'
                  ? cleanSessionText(call.response).replace(/^\[thinking\]\s*/, '')
                  : cleanSessionText(call.response)
              }
              copyId={`llm-response-${callKey}`}
              copiedId={copiedId}
              onCopy={onCopy}
            />
          )}
          {formattedToolResponse && relatedTools.length > 0 && (
            <div className="space-y-2">
              {relatedTools.map((tool, toolIdx) => (
                <ToolCallCard
                  key={tool.id || `${callKey}-tool-${toolIdx}`}
                  tool={tool}
                  copyId={`llm-tool-${callKey}-${toolIdx}`}
                  copiedId={copiedId}
                  onCopy={onCopy}
                />
              ))}
            </div>
          )}
          {formattedToolResponse && relatedTools.length === 0 && (
            <StructuredResponseBlock
              title="工具调用"
              color="violet"
              icon={Wrench}
              value={formattedToolResponse}
              copyId={`llm-tool-calls-${callKey}`}
              copiedId={copiedId}
              onCopy={onCopy}
            />
          )}
        </div>
      )}
    </div>
  );
};

// Rows only re-render when their own expansion/copy state changes, not on every
// sibling toggle in a large session.
export const CallRecordRow = React.memo(CallRecordRowInner, (prev, next) => {
  if (
    prev.call !== next.call ||
    prev.callKey !== next.callKey ||
    prev.toolScope !== next.toolScope ||
    prev.allLLMCalls !== next.allLLMCalls ||
    prev.detailLevel !== next.detailLevel ||
    prev.isExpanded !== next.isExpanded ||
    prev.showTokenUsage !== next.showTokenUsage ||
    prev.onToggle !== next.onToggle ||
    prev.onCopy !== next.onCopy
  ) {
    return false;
  }
  // copiedId only matters to this row while it is expanded (copy buttons are in
  // the expanded panel); collapsed rows skip re-rendering on copy state churn.
  if (prev.isExpanded && prev.copiedId !== next.copiedId) {
    return false;
  }
  return true;
});
