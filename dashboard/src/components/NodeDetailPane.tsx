import React from 'react';
import {
  FileCode2,
  ScrollText,
} from 'lucide-react';
import type { HierarchyNode, ProjectMetadata, Trace } from '../types';
import { EnhancedTraceDetail, type TabType } from './EnhancedTraceDetail';
import { EmptyState, InfoField, PathField } from './TraceDetailBlocks';

interface NodeDetailPaneProps {
  node: HierarchyNode | null;
  selectedTrace: Trace | null;
  projectMetadata: ProjectMetadata | null;
  projectMetadataLoading?: boolean;
  projectMetadataError?: string | null;
}

function Surface({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/70 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
      <div className="mb-4">
        <h2 className="text-lg font-semibold text-slate-950">{title}</h2>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </div>
  );
}

function FileDetailPane({
  title,
  subtitle,
  path,
  content,
}: {
  title: string;
  subtitle?: string;
  path?: string;
  content?: string;
}) {
  return (
    <Surface title={title} subtitle={subtitle}>
      {path && <PathField label="Path" value={path} />}
      <div className="rounded-2xl border border-slate-200 bg-slate-50/85 p-3">
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">
          {content || 'No content available.'}
        </pre>
      </div>
    </Surface>
  );
}

function SkillsDetailPane({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: Array<{ label: string; description?: string; path?: string; content?: string }>;
}) {
  return (
    <Surface title={title} subtitle={subtitle}>
      {items.length === 0 ? (
        <EmptyState icon={FileCode2} label="No skills found." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={`${item.label}-${item.path || ''}`} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="flex items-center gap-2 text-slate-900">
                <FileCode2 className="h-4 w-4 text-slate-500" />
                <div className="text-sm font-semibold">{item.label}</div>
              </div>
              {item.description && <div className="mt-1 text-xs text-slate-500">{item.description}</div>}
              {item.path && <div className="mt-2 break-all font-mono text-[11px] text-slate-500">{item.path}</div>}
              {item.content && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{item.content}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

function MemoryDetailPane({
  title,
  subtitle,
  items,
}: {
  title: string;
  subtitle?: string;
  items: Array<{ label: string; description?: string; path?: string; content?: string }>;
}) {
  return (
    <Surface title={title} subtitle={subtitle}>
      {items.length === 0 ? (
        <EmptyState icon={ScrollText} label="No memory notes found." />
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <div key={`${item.label}-${item.path || ''}`} className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <div className="text-sm font-semibold text-slate-900">{item.label}</div>
              {item.description && <div className="mt-1 text-xs text-slate-500">{item.description}</div>}
              {item.path && <div className="mt-2 break-all font-mono text-[11px] text-slate-500">{item.path}</div>}
              {item.content && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white p-3">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{item.content}</pre>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Surface>
  );
}

function StructuredDetailPane({
  title,
  subtitle,
  content,
  input,
  output,
  error,
  path,
}: {
  title: string;
  subtitle?: string;
  content?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  path?: string;
}) {
  return (
    <Surface title={title} subtitle={subtitle}>
      {path && <PathField label="Path" value={path} />}
      {content && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{content}</pre>
        </div>
      )}
      {input !== undefined && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Input</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{typeof input === 'string' ? input : JSON.stringify(input, null, 2)}</pre>
        </div>
      )}
      {output !== undefined && (
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Output</div>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{typeof output === 'string' ? output : JSON.stringify(output, null, 2)}</pre>
        </div>
      )}
      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50/80 p-4 text-sm text-red-700">
          {error}
        </div>
      )}
    </Surface>
  );
}

function sessionTabForNode(nodeType: HierarchyNode['type']): TabType {
  switch (nodeType) {
    case 'session-llm':
      return 'llm';
    case 'session-subagents':
    case 'subagents':
    case 'subagent':
      return 'subagents';
    case 'session-tasks':
      return 'taskStatus';
    default:
      return 'overview';
  }
}

function PendingProjectPane({
  projectMetadata,
  projectMetadataLoading,
  projectMetadataError,
}: {
  projectMetadata: ProjectMetadata | null;
  projectMetadataLoading: boolean;
  projectMetadataError: string | null;
}) {
  if (projectMetadataLoading) {
    return <Surface title="Project" subtitle="Loading project metadata…"><div className="text-sm text-slate-500">Loading project metadata…</div></Surface>;
  }
  if (projectMetadataError) {
    return <Surface title="Project" subtitle="Project metadata"><div className="text-sm text-red-600">{projectMetadataError}</div></Surface>;
  }
  if (!projectMetadata) {
    return <Surface title="Project" subtitle="Project metadata"><div className="text-sm text-slate-500">No project metadata available.</div></Surface>;
  }
  return (
    <Surface title={projectMetadata.identity.project_path} subtitle="Project summary">
      <InfoField label="Instruction" value={projectMetadata.instructions.exists ? 'present' : 'missing'} />
      <InfoField label="Memory notes" value={String(projectMetadata.memory.note_count)} />
      <InfoField label="Skills" value={String(projectMetadata.skills.count)} />
      <InfoField label="Sessions" value={String(projectMetadata.session_artifacts.session_count)} />
    </Surface>
  );
}

export const NodeDetailPane: React.FC<NodeDetailPaneProps> = ({
  node,
  selectedTrace,
  projectMetadata,
  projectMetadataLoading = false,
  projectMetadataError = null,
}) => {
  if (!node) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-10 text-center shadow-sm shadow-slate-200/60">
        <div className="text-sm text-slate-500">Select a node to inspect its details.</div>
      </div>
    );
  }

  if (node.type === 'global-root' || node.type === 'projects-root' || node.type === 'project' || node.type === 'project-sessions') {
    return (
      <PendingProjectPane
        projectMetadata={projectMetadata}
        projectMetadataLoading={projectMetadataLoading}
        projectMetadataError={projectMetadataError}
      />
    );
  }

  if (node.type === 'global-instruction') {
    return (
      <FileDetailPane
        title="Global instruction"
        subtitle="Global ~/.claude/CLAUDE.md"
        path={node.detail?.path}
        content={node.detail?.content}
      />
    );
  }

  if (node.type === 'global-skills') {
    return (
      <SkillsDetailPane
        title="Global skills"
        subtitle="Installed global Claude skills"
        items={node.detail?.items || []}
      />
    );
  }

  if (node.type === 'global-config') {
    return (
      <FileDetailPane
        title="Global config"
        subtitle="Global ~/.claude/settings.json"
        path={node.detail?.path}
        content={node.detail?.content}
      />
    );
  }

  if (node.type === 'project-instructions') {
    if (projectMetadataLoading) {
      return <Surface title="Project instruction" subtitle="Loading…"><div className="text-sm text-slate-500">Loading project metadata…</div></Surface>;
    }
    if (projectMetadataError) {
      return <Surface title="Project instruction" subtitle="Project metadata"><div className="text-sm text-red-600">{projectMetadataError}</div></Surface>;
    }
    return (
      <FileDetailPane
        title="Project instruction"
        subtitle="Project CLAUDE.md"
        path={projectMetadata?.instructions.path}
        content={projectMetadata?.instructions.preview}
      />
    );
  }

  if (node.type === 'project-memory') {
    if (projectMetadataLoading) {
      return <Surface title="Project memory" subtitle="Loading…"><div className="text-sm text-slate-500">Loading project metadata…</div></Surface>;
    }
    if (projectMetadataError) {
      return <Surface title="Project memory" subtitle="Project metadata"><div className="text-sm text-red-600">{projectMetadataError}</div></Surface>;
    }
    return (
      <MemoryDetailPane
        title="Project memory"
        subtitle="Project memory notes"
        items={(projectMetadata?.memory.notes || []).map((note) => ({
          label: note.name,
          description: note.description,
          path: note.path,
          content: note.content || note.preview,
        }))}
      />
    );
  }

  if (node.type === 'project-config') {
    if (projectMetadataLoading) {
      return <Surface title="Project config" subtitle="Loading…"><div className="text-sm text-slate-500">Loading project metadata…</div></Surface>;
    }
    if (projectMetadataError) {
      return <Surface title="Project config" subtitle="Project metadata"><div className="text-sm text-red-600">{projectMetadataError}</div></Surface>;
    }
    return (
      <FileDetailPane
        title="Project config"
        subtitle="Project settings.local.json"
        path={projectMetadata?.local_config.path}
        content={projectMetadata?.local_config.content}
      />
    );
  }

  if (node.type === 'project-skills') {
    if (projectMetadataLoading) {
      return <Surface title="Project skills" subtitle="Loading…"><div className="text-sm text-slate-500">Loading project metadata…</div></Surface>;
    }
    if (projectMetadataError) {
      return <Surface title="Project skills" subtitle="Project metadata"><div className="text-sm text-red-600">{projectMetadataError}</div></Surface>;
    }
    return (
      <SkillsDetailPane
        title="Project skills"
        subtitle="Project-local Claude skills"
        items={(projectMetadata?.skills.items || []).map((skill) => ({
          label: skill.name,
          description: skill.description,
          path: skill.path,
          content: skill.content,
        }))}
      />
    );
  }

  if (node.detail?.kind === 'file') {
    return (
      <FileDetailPane
        title={node.detail.title || node.label}
        subtitle={node.detail.description}
        path={node.detail.path}
        content={node.detail.content}
      />
    );
  }

  if (node.detail?.kind === 'skills') {
    return (
      <SkillsDetailPane
        title={node.detail.title || node.label}
        subtitle={node.detail.description}
        items={node.detail.items || []}
      />
    );
  }

  if (node.detail?.kind === 'memory') {
    return (
      <MemoryDetailPane
        title={node.detail.title || node.label}
        subtitle={node.detail.description}
        items={node.detail.items || []}
      />
    );
  }

  if ((node.type === 'session'
    || node.type === 'session-llm'
    || node.type === 'session-subagents'
    || node.type === 'session-tasks'
    || node.type === 'assistant-turn'
    || node.type === 'subagents'
    || node.type === 'subagent') && selectedTrace) {
    return <EnhancedTraceDetail trace={selectedTrace} initialTab={sessionTabForNode(node.type)} hideTabs />;
  }

  if (node.type === 'thinking' || node.type === 'text' || node.type === 'command') {
    return (
      <StructuredDetailPane
        title={node.detail?.title || node.label}
        subtitle={node.detail?.description}
        content={node.detail?.content}
      />
    );
  }

  if (node.type === 'subagent') {
    return selectedTrace
      ? <EnhancedTraceDetail trace={selectedTrace} />
      : (
        <StructuredDetailPane
          title={node.detail?.title || node.label}
          subtitle={node.detail?.description || 'Subagent overview'}
          content={node.detail?.content}
        />
      );
  }

  if (node.type === 'tool-call' || node.type === 'tool-result') {
    return (
      <StructuredDetailPane
        title={node.detail?.title || node.label}
        subtitle={node.detail?.description || node.subtitle}
        input={node.detail?.input}
        output={node.detail?.output}
        error={node.detail?.error}
      />
    );
  }

  if (selectedTrace && node.sessionId && node.sessionId === selectedTrace.sessionId) {
    return <EnhancedTraceDetail trace={selectedTrace} />;
  }

  return (
    <Surface title={node.label} subtitle={node.subtitle || 'Node detail'}>
      {node.detail?.content && (
        <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{node.detail.content}</pre>
        </div>
      )}
      {!node.detail?.content && <div className="text-sm text-slate-500">No detail available for this node yet.</div>}
    </Surface>
  );
};

export default NodeDetailPane;
