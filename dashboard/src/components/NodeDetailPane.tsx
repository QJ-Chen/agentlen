import React from 'react';
import type { HierarchyNode, ProjectMetadata, Trace } from '../types';
import ProjectDetailPane from './ProjectDetailPane';

interface NodeDetailPaneProps {
  node: HierarchyNode | null;
  selectedTrace: Trace | null;
  projectMetadata: ProjectMetadata | null;
  projectMetadataLoading?: boolean;
  projectMetadataError?: string | null;
  projectSessions: Trace[];
  selectedTraceId?: string | null;
  onSelectTrace: (traceId: string) => void;
}

export const NodeDetailPane: React.FC<NodeDetailPaneProps> = ({
  node,
  projectMetadata,
  projectMetadataLoading = false,
  projectMetadataError = null,
  projectSessions,
  selectedTraceId,
  onSelectTrace,
}) => {
  if (!node) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm shadow-slate-200/60">
        <div className="text-sm text-slate-500">Select a node to inspect its details.</div>
      </div>
    );
  }

  if (
    node.type === 'project'
    || node.type === 'global-root'
    || node.type === 'project-sessions'
    || node.type === 'project-instructions'
    || node.type === 'project-memory'
    || node.type === 'project-config'
    || node.type === 'session'
    || node.type === 'session-overview'
    || node.type === 'session-llm'
    || node.type === 'session-subagents'
    || node.type === 'session-tasks'
  ) {
    return (
      <ProjectDetailPane
        projectMetadata={projectMetadata}
        projectMetadataLoading={projectMetadataLoading}
        projectMetadataError={projectMetadataError}
        projectSessions={projectSessions}
        selectedTraceId={selectedTraceId}
        onSelectTrace={onSelectTrace}
      />
    );
  }

  return (
    <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm shadow-slate-200/60">
      <div className="text-sm text-slate-500">No detail available for this node yet.</div>
    </div>
  );
};

export default NodeDetailPane;
