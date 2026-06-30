import React from 'react';
import { ChevronDown, ChevronRight, FolderTree } from 'lucide-react';
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

function typeTone(type: HierarchyNode['type']): string {
  switch (type) {
    case 'global-root':
      return 'text-slate-900 font-semibold';
    case 'project':
      return 'text-slate-900';
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
  maxDepth = 2,
}: {
  node: HierarchyNode;
  depth: number;
  expanded: Set<string>;
  selectedId: string | null;
  onToggle: (id: string) => void;
  onSelect: (node: HierarchyNode) => void;
  maxDepth?: number;
}) {
  const visibleChildren = depth >= maxDepth ? [] : (Array.isArray(node.children) ? node.children : []);
  const hasChildren = visibleChildren.length > 0;
  const isExpanded = expanded.has(node.id);
  const isSelected = selectedId === node.id;
  const displayLabel = node.type === 'project' ? (shortProjectPath(node.label) || node.label) : node.label;

  return (
    <div>
      <div
        className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm transition-colors ${
          isSelected ? 'bg-blue-50 text-blue-900' : 'hover:bg-slate-50'
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

        <button type="button" onClick={() => onSelect(node)} className="min-w-0 flex-1 text-left" title={node.label}>
          <div className={`truncate ${typeTone(node.type)}`}>{displayLabel}</div>
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
              maxDepth={maxDepth}
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
