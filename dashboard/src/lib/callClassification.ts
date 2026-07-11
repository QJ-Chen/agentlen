import type { ComponentType } from 'react';
import { Clock, MessageSquare, Sparkles, Wrench } from 'lucide-react';
import type { LLMCall, ToolCall } from '../types';
import { cleanSessionText, fileBasename } from './sessionUtils';

export type DetailLevel = 'summary' | 'standard' | 'verbose';
export type ResponseKind = 'empty' | 'thinking' | 'tool' | 'text';

export interface CallResponseStyle {
  kind: ResponseKind;
  label: string;
  icon: ComponentType<{ className?: string }>;
  accent: string;
  badge: string;
  preview: string;
}

// Kind is derivable from the response text alone; visibility filtering uses this
// without paying for the related-tool scans in getCallRenderState.
export function classifyResponseKind(response: string): ResponseKind {
  if (!response) return 'empty';
  if (response.startsWith('[thinking]')) return 'thinking';
  if (/^\[[^\]]+\]/.test(response)) return 'tool';
  return 'text';
}

export function getRelatedToolCalls(call: LLMCall, toolScope: ToolCall[], allLLMCalls: LLMCall[]): ToolCall[] {
  if (!toolScope || !call.startTime) return [];
  const byRecordId = toolScope.filter((tool) => tool.assistantRecordId && tool.assistantRecordId === call.id);
  if (byRecordId.length > 0) {
    return byRecordId;
  }
  const byMessageId = toolScope.filter((tool) => tool.assistantMessageId && tool.assistantMessageId === call.messageId);
  if (byMessageId.length > 0) {
    return byMessageId;
  }
  const callIndex = allLLMCalls.findIndex((candidate) => candidate.id === call.id);
  const nextCall = allLLMCalls[callIndex + 1];

  return toolScope.filter((tool) => {
    if (!tool.startTime) return false;
    const afterThisCall = tool.startTime >= call.startTime;
    const beforeNextCall = !nextCall || tool.startTime < nextCall.startTime;
    return afterThisCall && beforeNextCall;
  });
}

export function classifyCallResponse(call: LLMCall, relatedTools: ToolCall[]): CallResponseStyle {
  const response = cleanSessionText(call.response || '');
  const kind = classifyResponseKind(response);
  if (kind === 'empty') {
    return {
      kind: 'empty',
      label: '无响应',
      icon: Clock,
      accent: 'text-slate-400',
      badge: 'bg-slate-500/15 text-slate-300',
      preview: '无响应内容',
    };
  }
  if (kind === 'thinking') {
    return {
      kind: 'thinking',
      label: '思考',
      icon: Sparkles,
      accent: 'text-amber-300',
      badge: 'bg-amber-500/15 text-amber-300',
      preview: response.replace(/^\[thinking\]\s*/, ''),
    };
  }
  if (kind === 'tool') {
    const toolResponseMatch = response.match(/^\[([^\]]+)\]\s*/);
    return {
      kind: 'tool',
      label: '工具调用',
      icon: Wrench,
      accent: 'text-violet-300',
      badge: 'bg-violet-500/15 text-violet-300',
      // "ToolName: basename" for file-operating tools (Read, Edit, Write, etc.)
      preview:
        relatedTools.length > 0
          ? relatedTools
              .map((tool) => {
                const filePath = tool.input?.file_path;
                return typeof filePath === 'string' && filePath
                  ? `${tool.name}: ${fileBasename(filePath)}`
                  : tool.name;
              })
              .join(' · ')
          : toolResponseMatch?.[1] ?? response,
    };
  }
  return {
    kind: 'text',
    label: '文本响应',
    icon: MessageSquare,
    accent: 'text-cyan-300',
    badge: 'bg-cyan-500/15 text-cyan-300',
    preview: response,
  };
}

export interface CallRenderState {
  relatedTools: ToolCall[];
  responseStyle: CallResponseStyle;
  formattedToolResponse: Array<{ name: string; input?: Record<string, unknown> }> | null;
  toolResultAppendix: Array<{ name: string; result?: unknown; error?: string }> | null;
}

export function getCallRenderState(call: LLMCall, toolScope: ToolCall[], allLLMCalls: LLMCall[]): CallRenderState {
  const relatedTools = getRelatedToolCalls(call, toolScope, allLLMCalls);
  const responseStyle = classifyCallResponse(call, relatedTools);
  const formattedToolResponse =
    responseStyle.kind === 'tool'
      ? relatedTools.map((tool) => ({
          name: tool.name,
          input: tool.input,
        }))
      : null;
  const toolResultAppendix =
    formattedToolResponse && relatedTools.some((tool) => tool.output != null || tool.error)
      ? relatedTools.map((tool) => ({
          name: tool.name,
          result: tool.output,
          error: tool.error,
        }))
      : null;

  return {
    relatedTools,
    responseStyle,
    formattedToolResponse,
    toolResultAppendix,
  };
}
