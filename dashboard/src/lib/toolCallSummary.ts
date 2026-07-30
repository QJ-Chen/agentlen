import type { ToolCall } from '../types';
import { fileBasename } from './sessionUtils';

const SINGLE_FILE_TOOLS = new Set(['Read', 'Write', 'Edit', 'NotebookEdit']);

function inputString(tool: ToolCall, key: string): string | null {
  const value = tool.input?.[key];
  return typeof value === 'string' ? value : null;
}

export function applyPatchFilePath(tool: ToolCall): string | null {
  if (tool.name !== 'apply_patch') return null;
  const patch = inputString(tool, 'value') ?? inputString(tool, 'patch');
  if (!patch) return null;
  const paths = [...patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)]
    .map((match) => match[1]?.trim())
    .filter((path): path is string => Boolean(path));
  return new Set(paths).size === 1 ? paths[0] : null;
}

function shellWords(command: string): string[] {
  return command.match(/(?:[^\s'"\\]+|\\.|"(?:\\.|[^"])*"|'[^']*')+/g) ?? [];
}

function unquoteShellWord(word: string): string {
  if (
    word.length >= 2
    && ((word.startsWith('"') && word.endsWith('"'))
      || (word.startsWith("'") && word.endsWith("'")))
  ) {
    return word.slice(1, -1);
  }
  return word;
}

export function execCommandName(tool: ToolCall): string | null {
  if (tool.name !== 'exec_command') return null;
  const command = inputString(tool, 'command') ?? inputString(tool, 'cmd');
  if (!command) return null;

  const words = shellWords(command.trim().replace(/^\$\s+/, ''));
  let index = 0;
  while (index < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index])) index++;

  if (words[index] === 'env') {
    index++;
    while (
      index < words.length
      && (words[index].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]))
    ) {
      index++;
    }
  }

  const executable = words[index] ? unquoteShellWord(words[index]) : '';
  return executable ? fileBasename(executable) : null;
}

export function toolCallArgumentSummary(tool: ToolCall): string {
  if (SINGLE_FILE_TOOLS.has(tool.name)) {
    const filePath = inputString(tool, 'file_path') ?? inputString(tool, 'notebook_path');
    if (filePath) return fileBasename(filePath);
  }

  const patchPath = applyPatchFilePath(tool);
  if (patchPath) return fileBasename(patchPath);

  return execCommandName(tool) ?? '';
}

export function toolCallPreview(tool: ToolCall): string {
  const summary = toolCallArgumentSummary(tool);
  if (!summary) return tool.name;
  return tool.name === 'apply_patch'
    ? `${tool.name}：${summary}`
    : `${tool.name}: ${summary}`;
}
