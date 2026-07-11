import { Check, ChevronDown, ChevronRight, Copy, MessageSquare } from 'lucide-react';
import type { LLMCall, PromptThread, ToolCall } from '../../types';
import { classifyResponseKind, type DetailLevel } from '../../lib/callClassification';
import { cleanSessionText, formatTokenPair, parseSessionText } from '../../lib/sessionUtils';
import { CallRecordRow } from '../CallRecordRow';
import { ControlPlanePromptBlock } from '../TraceDetailBlocks';
import type { ReplayMessageKind } from './shared';

const formatCommandLabel = (name: string) => (name.startsWith('/') ? name : `/${name}`);

export interface PromptThreadGroupProps {
  thread: PromptThread;
  index: number;
  toolScope: ToolCall[];
  scopePrefix: string;
  allLLMCalls: LLMCall[];
  detailLevel: DetailLevel;
  expandedLLMs: Set<string>;
  copiedId: string | null;
  sessionId?: string;
  isKindVisible: (kind: ReplayMessageKind) => boolean;
  onToggle: (key: string) => void;
  onToggleMany: (keys: string[], expand: boolean) => void;
  onCopy: (text: string, id: string) => void;
  registerJumpRef?: (id: string, node: HTMLDivElement | null) => void;
}

export function PromptThreadGroup({
  thread,
  index,
  toolScope,
  scopePrefix,
  allLLMCalls,
  detailLevel,
  expandedLLMs,
  copiedId,
  sessionId,
  isKindVisible,
  onToggle,
  onToggleMany,
  onCopy,
  registerJumpRef,
}: PromptThreadGroupProps) {
  const threadKey = `${scopePrefix}-thread-${thread.id}`;
  const isThreadExpanded = expandedLLMs.has(threadKey);
  const promptBlocks = parseSessionText(thread.prompt || '');
  const textBlocks = promptBlocks.filter((block) => block.kind === 'text');
  const cleanedPrompt = textBlocks.map((block) => block.text).join('\n\n').trim();
  const controlBlocks = promptBlocks.filter((block) => block.kind !== 'text');
  const primaryCommand = thread.command?.name
    ? { name: thread.command.name, args: thread.command.args || '' }
    : thread.commandOnlyRecords?.[0];
  const commandLabel = primaryCommand?.name ? formatCommandLabel(primaryCommand.name) : '';
  const commandPreview = primaryCommand?.name
    ? `${commandLabel}${primaryCommand.args ? ` ${primaryCommand.args}` : ''}`
    : '';
  const firstControl = controlBlocks[0];
  const controlPreview = firstControl?.kind === 'task-notification'
    ? firstControl.summary || [firstControl.status, firstControl.taskId].filter(Boolean).join(' · ') || '任务通知'
    : firstControl?.kind === 'bash-output'
      ? firstControl.hasStderr && !firstControl.hasStdout
        ? 'Bash 错误'
        : firstControl.stdout?.trim() || firstControl.stderr?.trim()
          ? 'Bash 输出'
          : 'Bash 输出（无输出）'
      : '';
  const promptPreviewSource = cleanedPrompt || controlPreview || commandPreview;
  const promptPreview = promptPreviewSource
    ? `${promptPreviewSource.replace(/\n/g, ' ').slice(0, 80)}${promptPreviewSource.length > 80 ? '...' : ''}`
    : '无提示词';
  const hasCommandOnlyRecords = !!thread.commandOnlyRecords && thread.commandOnlyRecords.length > 0;
  const showCommandBlock = isKindVisible('user') && detailLevel !== 'summary' && !!thread.command?.name && !hasCommandOnlyRecords;
  const showPromptBlocks = isKindVisible('user') && detailLevel !== 'summary' && promptBlocks.length > 0;
  const showCommandOnlyBlocks = isKindVisible('user') && detailLevel !== 'summary' && hasCommandOnlyRecords;

  const visibleTurns = thread.assistantTurns
    .map((turn) => {
      const visibleChildRecords = turn.childRecords.filter((call) =>
        isKindVisible(classifyResponseKind(cleanSessionText(call.response || ''))),
      );

      return {
        turn,
        visibleChildRecords,
      };
    })
    .filter(({ visibleChildRecords }) => visibleChildRecords.length > 0);

  if (!showCommandBlock && !showPromptBlocks && !showCommandOnlyBlocks && visibleTurns.length === 0) {
    return null;
  }

  const threadInputTokens = visibleTurns.reduce((sum, { turn }) => sum + turn.inputTokens, 0);
  const threadOutputTokens = visibleTurns.reduce((sum, { turn }) => sum + turn.outputTokens, 0);
  const assistantTurnCount = visibleTurns.length;

  const renderChildRecord = ({
    call,
    callIdx,
    parentKey,
    showTokenUsage = true,
  }: {
    call: LLMCall;
    callIdx: number;
    parentKey: string;
    showTokenUsage?: boolean;
  }) => {
    const callKey = `${parentKey}-call-${callIdx}`;
    return (
      <CallRecordRow
        key={callKey}
        call={call}
        callKey={callKey}
        toolScope={toolScope}
        allLLMCalls={allLLMCalls}
        detailLevel={detailLevel}
        isExpanded={expandedLLMs.has(callKey)}
        showTokenUsage={showTokenUsage}
        copiedId={copiedId}
        sessionId={sessionId}
        onToggle={onToggle}
        onCopy={onCopy}
      />
    );
  };

  return (
    <div
      key={threadKey}
      ref={(node) => {
        registerJumpRef?.(thread.promptId || thread.id, node);
      }}
      className={`rounded-2xl border-l-4 transition-all ${
        isThreadExpanded ? 'bg-white border-cyan-300 shadow-md shadow-cyan-100/40 ring-1 ring-cyan-100' : 'bg-slate-50/80 border-slate-200/80 border-l-cyan-200'
      }`}
    >
      <button onClick={() => onToggle(threadKey)} className="w-full px-4 py-3.5 flex items-center gap-3 text-left">
        <div className="w-8 h-8 rounded-full bg-cyan-50 flex items-center justify-center ring-1 ring-cyan-100">
          <span className="text-xs text-cyan-400 font-mono">{index + 1}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-900 truncate">{promptPreview}</div>
          <div className="text-xs text-slate-500 mt-0.5 flex items-center gap-2">
            <span>{assistantTurnCount} 个 assistant turn</span>
            {hasCommandOnlyRecords && (
              <>
                <span>·</span>
                <span>{thread.commandOnlyRecords!.length} 个 command</span>
              </>
            )}
            {(threadInputTokens > 0 || threadOutputTokens > 0) && (
              <>
                <span>·</span>
                <span>
                  {formatTokenPair(threadInputTokens, threadOutputTokens)}
                </span>
              </>
            )}
            {detailLevel === 'verbose' && thread.promptId && (
              <>
                <span>·</span>
                <span className="font-mono">promptId: {thread.promptId}</span>
              </>
            )}
          </div>
        </div>
        {isThreadExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {isThreadExpanded && (
        <div className="border-t border-cyan-100/80 bg-white">
          <div className="space-y-3 p-4">
            {showCommandBlock && thread.command && thread.command.name && (
              <div className="rounded-2xl border border-sky-200/80 bg-sky-50/70">
                <div className="flex items-center gap-2 border-b border-sky-100/80 px-4 py-3">
                  <span className="text-xs font-semibold text-sky-700 rounded-full border border-sky-200 bg-white px-2 py-0.5">Command</span>
                  <span className="text-sm font-medium text-sky-900">{formatCommandLabel(thread.command.name)}</span>
                  {thread.command.args && <span className="text-xs text-slate-600 font-mono break-all">{thread.command.args}</span>}
                </div>
                {thread.command.message && (
                  <div className="px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-24 overflow-auto">
                    {thread.command.message}
                  </div>
                )}
              </div>
            )}
            {showCommandOnlyBlocks && thread.commandOnlyRecords?.map((record, commandIdx) => (
              <div key={`${threadKey}-cmdonly-${commandIdx}`} className="rounded-2xl border border-sky-200/60 bg-sky-50/50">
                <div className="flex items-center gap-2 border-b border-sky-100/80 px-4 py-3">
                  <span className="text-xs font-semibold text-sky-700 rounded-full border border-sky-200 bg-white px-2 py-0.5">Command</span>
                  <span className="text-sm font-medium text-sky-900">{formatCommandLabel(record.name)}</span>
                  {record.args && <span className="text-xs text-slate-600 font-mono break-all">{record.args}</span>}
                  {record.timestamp && (
                    <span className="ml-auto text-[11px] text-slate-500 font-mono">
                      {new Date(record.timestamp).toLocaleString()}
                    </span>
                  )}
                </div>
                {record.message && (
                  <div className="px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-24 overflow-auto">
                    {record.message}
                  </div>
                )}
              </div>
            ))}
            {showPromptBlocks && promptBlocks.map((block, blockIdx) => {
              const blockKey = `${threadKey}-prompt-${blockIdx}`;
              if (block.kind === 'text') {
                return (
                  <div key={blockKey} className="rounded-2xl border border-slate-200/80 bg-slate-50/80">
                    <div className="flex items-center justify-between border-b border-slate-200/80 px-4 py-3">
                      <span className="text-xs font-semibold text-cyan-700 flex items-center gap-1">
                        <MessageSquare className="w-3 h-3" /> 用户提示词
                      </span>
                      <button
                        onClick={() => onCopy(block.text, blockKey)}
                        className="text-xs text-slate-500 hover:text-slate-900 flex items-center gap-1"
                      >
                        {copiedId === blockKey ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        {copiedId === blockKey ? '已复制' : '复制'}
                      </button>
                    </div>
                    <div className="px-4 py-3 text-sm text-slate-700 whitespace-pre-wrap leading-relaxed max-h-24 overflow-auto">{block.text}</div>
                  </div>
                );
              }
              return (
                <ControlPlanePromptBlock
                  key={blockKey}
                  block={block}
                  copyId={blockKey}
                  copiedId={copiedId}
                  onCopy={onCopy}
                />
              );
            })}
          </div>

          <div className="space-y-3 p-4 bg-white ml-4 border-l-2 border-cyan-100/80 rounded-bl-2xl">
            {visibleTurns.map(({ turn, visibleChildRecords }, turnIdx) => {
              const turnKey = `${threadKey}-turn-${turn.messageId || turn.id || turnIdx}`;
              const isSingleChild = visibleChildRecords.length === 1;
              if (isSingleChild) {
                return renderChildRecord({
                  call: visibleChildRecords[0],
                  callIdx: 0,
                  parentKey: turnKey,
                  showTokenUsage: true,
                });
              }

              // Multi-record turns render flat — no collapsible wrapper. A thin
              // header chip + left rail marks which records belong to one response.
              return (
                <div key={turnKey} className="rounded-2xl border-l-2 border-cyan-200/80 bg-cyan-50/20">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-2 pb-1 text-[11px] text-slate-400">
                    <span className="rounded-full border border-cyan-200/80 bg-white px-2 py-0.5 font-mono text-cyan-600">
                      回复 {turnIdx + 1}
                    </span>
                    <span>{visibleChildRecords.length} 条记录</span>
                    {turn.totalTokens > 0 && (
                      <>
                        <span>·</span>
                        <span>{formatTokenPair(turn.inputTokens, turn.outputTokens)}</span>
                      </>
                    )}
                    {detailLevel === 'verbose' && turn.messageId && (
                      <span className="font-mono">message.id: {turn.messageId}</span>
                    )}
                    {detailLevel !== 'summary' && (() => {
                      const childKeys = visibleChildRecords.map((_call, callIdx) => `${turnKey}-call-${callIdx}`);
                      const allExpanded = childKeys.every((key) => expandedLLMs.has(key));
                      return (
                        <button
                          type="button"
                          onClick={() => onToggleMany(childKeys, !allExpanded)}
                          className="ml-auto rounded-lg border border-cyan-200 bg-white px-2 py-0.5 text-[11px] text-cyan-700 hover:border-cyan-300 hover:bg-cyan-50 shadow-sm"
                        >
                          {allExpanded ? '折叠详情' : '展开详情'}
                        </button>
                      );
                    })()}
                  </div>
                  <div className="space-y-2 px-2 pb-2">
                    {visibleChildRecords.map((call, callIdx) =>
                      renderChildRecord({
                        call,
                        callIdx,
                        parentKey: turnKey,
                        showTokenUsage: false,
                      }),
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
