import type { ToolCall } from '../types';
import { fileBasename, truncateText } from './sessionUtils';

function inputString(tool: ToolCall, key: string): string | null {
  const value = tool.input?.[key];
  return typeof value === 'string' ? value : null;
}

export function applyPatchFilePath(tool: ToolCall): string | null {
  if (tool.name !== 'apply_patch') return null;
  const patch = inputString(tool, 'value') ?? inputString(tool, 'patch');
  if (!patch) return null;
  const match = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m);
  return match?.[1]?.trim() || null;
}

export function toolCallArgumentSummary(tool: ToolCall): string {
  const filePath = inputString(tool, 'file_path') ?? inputString(tool, 'notebook_path');
  if (filePath) return fileBasename(filePath);

  const patchPath = applyPatchFilePath(tool);
  if (patchPath) return fileBasename(patchPath);

  const command = inputString(tool, 'command') ?? inputString(tool, 'cmd');
  if (command) return truncateText(command.replace(/\n/g, ' '), 72);

  const pattern = inputString(tool, 'pattern');
  if (pattern) return truncateText(pattern, 72);

  const description = inputString(tool, 'description') ?? inputString(tool, 'prompt');
  if (description) return truncateText(description.replace(/\n/g, ' '), 72);

  return inputString(tool, 'skill') ?? '';
}

export function toolCallPreview(tool: ToolCall): string {
  const summary = toolCallArgumentSummary(tool);
  if (!summary) return tool.name;
  return tool.name === 'apply_patch'
    ? `${tool.name}：${summary}`
    : `${tool.name}: ${summary}`;
}
