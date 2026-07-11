import type { PromptThread } from '../types';
import { classifyResponseKind, type DetailLevel } from './callClassification';
import { cleanSessionText, parseSessionText } from './sessionUtils';
import type { ReplayMessageKind } from '../components/trace-detail/shared';

// Mirrors PromptThreadGroup's early-return condition so parents can render an
// empty state when every thread is filtered out.
export function isThreadVisible(
  thread: PromptThread,
  isKindVisible: (kind: ReplayMessageKind) => boolean,
  detailLevel: DetailLevel,
): boolean {
  const promptBlocks = parseSessionText(thread.prompt || '');
  const hasCommandOnlyRecords = !!thread.commandOnlyRecords && thread.commandOnlyRecords.length > 0;
  const showUser = isKindVisible('user') && detailLevel !== 'summary';
  if (showUser && (thread.command?.name || promptBlocks.length > 0 || hasCommandOnlyRecords)) {
    return true;
  }
  return thread.assistantTurns.some((turn) =>
    turn.childRecords.some((call) => isKindVisible(classifyResponseKind(cleanSessionText(call.response || '')))),
  );
}
