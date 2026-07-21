import React from 'react';
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  FileCode2,
  FileJson,
  FileText,
  FolderTree,
  ListTree,
  ScrollText,
  Sparkles,
  TerminalSquare,
  Wrench,
} from 'lucide-react';
import type { HierarchyNode } from '../types';
import { shortProjectPath } from '../lib/sessionUtils';

interface HierarchyTreeProps {
  root: HierarchyNode | null;
  expanded: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (node: HierarchyNode) => void;
}

const INDENT = 16;

function nodeIcon(node: HierarchyNode): { kind: 'folder' | 'book' | 'json' | 'code' | 'scroll' | 'list' | 'terminal' | 'sparkles' | 'text' | 'wrench' } {
  switch (node.type) {
    case 'global-root':
    case 'claude-global-root':
    case 'codex-global-root':
    case 'projects-root':
    case 'project':
    case 'project-sessions':
      return { kind: 'folder' };
    case 'global-instruction':
    case 'codex-global-instruction':
    case 'project-instructions':
      return { kind: 'book' };
    case 'global-config':
    case 'codex-global-config':
    case 'project-config':
      return { kind: 'json' };
    case 'global-skills':
    case 'codex-global-skills':
    case 'project-skills':
    case 'skill':
      return { kind: 'code' };
    case 'project-memory':
      return { kind: 'scroll' };
    case 'session':
    case 'session-llm':
    case 'session-subagents':
    case 'session-tasks':
    case 'session-vision':
      return { kind: 'list' };
    case 'assistant-turn':
      return { kind: 'terminal' };
    case 'thinking':
      return { kind: 'sparkles' };
    case 'text':
      return { kind: 'text' };
    case 'tool-call':
    case 'tool-result':
      return { kind: 'wrench' };
    default:
      return { kind: 'folder' };
  }
}

function renderNodeIcon(icon: ReturnType<typeof nodeIcon>) {
  const className = 'h-3.5 w-3.5 shrink-0 text-slate-400';
  switch (icon.kind) {
    case 'book':
      return <BookOpen className={className} />;
    case 'json':
      return <FileJson className={className} />;
    case 'code':
      return <FileCode2 className={className} />;
    case 'scroll':
      return <ScrollText className={className} />;
    case 'list':
      return <ListTree className={className} />;
    case 'terminal':
      return <TerminalSquare className={className} />;
    case 'sparkles':
      return <Sparkles className={className} />;
    case 'text':
      return <FileText className={className} />;
    case 'wrench':
      return <Wrench className={className} />;
    default:
      return <FolderTree className={className} />;
  }
}

function typeTone(type: HierarchyNode['type']): string {
  switch (type) {
    case 'global-root':
    case 'projects-root':
      return 'text-slate-900 font-semibold';
    case 'project':
    case 'session':
      return 'text-slate-900';
    case 'thinking':
      return 'text-amber-700';
    case 'tool-call':
    case 'tool-result':
      return 'text-violet-700';
    case 'command':
      return 'text-cyan-700';
    default:
      return 'text-slate-600';
  }
}

function NodeRow({
  node,
  depth,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}: {
  node: HierarchyNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (node: HierarchyNode) => void;
}) {
  const visibleChildren = Array.isArray(node.children) ? node.children : [];
  const hasChildren = node.hasChildren || visibleChildren.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const displayLabel = node.type === 'project' ? (shortProjectPath(node.label) || node.label) : node.label;
  const icon = nodeIcon(node);

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors ${
          isSelected ? 'bg-clay-50 text-clay-800 ring-1 ring-clay-100' : 'hover:bg-slate-50'
        }`}
        style={{ paddingLeft: depth * INDENT + 8 }}
      >
        <button
          type="button"
          onClick={() => hasChildren && onToggle(node.id)}
          className="flex h-5 w-5 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
        >
          {hasChildren ? (
            isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
          ) : (
            <span className="block h-4 w-4" />
          )}
        </button>

        <button
          type="button"
          onClick={() => onSelect(node)}
          onDoubleClick={() => hasChildren && onToggle(node.id)}
          className="min-w-0 flex-1 text-left"
          title={node.label}
        >
          <div className="flex items-center gap-2">
            {renderNodeIcon(icon)}
            <div className={`truncate ${typeTone(node.type)}`}>{displayLabel}</div>
          </div>
          {(node.subtitle || node.count != null) && (
            <div className="truncate text-[11px] text-slate-400">
              {node.subtitle}
              {node.subtitle && node.count != null ? ' · ' : ''}
              {node.count != null ? `${node.count}` : ''}
            </div>
          )}
        </button>
      </div>

      {hasChildren && isExpanded && (
        <div className="space-y-1">
          {visibleChildren.map((child) => (
            <NodeRow
              key={child.id}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedId={selectedId}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export const HierarchyTree: React.FC<HierarchyTreeProps> = ({
  root,
  expanded,
  selectedId,
  onToggle,
  onSelect,
}) => {
  if (!root) {
    return <div className="text-sm text-slate-500">Loading hierarchy…</div>;
  }

  return (
    <div className="space-y-1">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <FolderTree className="h-4 w-4 text-slate-500" />
        Claude hierarchy
      </div>
      <NodeRow
        node={root}
        depth={0}
        expanded={expanded}
        selectedId={selectedId}
        onToggle={onToggle}
        onSelect={onSelect}
      />
    </div>
  );
};

export default HierarchyTree;
