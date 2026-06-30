import React, { useMemo, useState } from 'react';
import { BookOpen, ChevronDown, ChevronRight, FileJson, FolderTree, ScrollText } from 'lucide-react';
import type { ProjectMetadata, Trace } from '../types';
import { formatTimestamp } from '../lib/sessionUtils';
import { EnhancedTraceDetail } from './EnhancedTraceDetail';

interface ProjectDetailPaneProps {
  projectMetadata: ProjectMetadata | null;
  projectMetadataLoading?: boolean;
  projectMetadataError?: string | null;
  projectSessions: Trace[];
  selectedTraceId?: string | null;
  onSelectTrace: (traceId: string) => void;
}

function ExpandableSection({
  icon: Icon,
  title,
  subtitle,
  expanded,
  onToggle,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-slate-50/80">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm shadow-slate-200/50">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-slate-800">{title}</div>
          {subtitle && <div className="text-xs text-slate-400">{subtitle}</div>}
        </div>
        <div className="text-slate-400">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>
      {expanded && <div className="border-t border-slate-200/80 px-4 pb-4 pt-3">{children}</div>}
    </section>
  );
}

function ProjectMetadataBody({ metadata }: { metadata: ProjectMetadata }) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    instructions: true,
    memory: true,
    config: false,
  });

  const toggleSection = (key: string) => {
    setExpandedSections((current) => ({ ...current, [key]: !current[key] }));
  };

  return (
    <div className="space-y-4">
      <ExpandableSection
        icon={BookOpen}
        title="Instruction"
        subtitle={metadata.instructions.exists ? formatTimestamp(metadata.instructions.modified_at) : 'No CLAUDE.md'}
        expanded={!!expandedSections.instructions}
        onToggle={() => toggleSection('instructions')}
      >
        {metadata.instructions.exists ? (
          <div className="space-y-3 text-sm text-slate-600">
            <div className="break-all font-mono text-xs text-slate-500">{metadata.instructions.path}</div>
            {metadata.instructions.preview && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{metadata.instructions.preview}</pre>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No CLAUDE.md found for this project.</div>
        )}
      </ExpandableSection>

      <ExpandableSection
        icon={ScrollText}
        title="Memory"
        subtitle={`${metadata.memory.note_count} notes`}
        expanded={!!expandedSections.memory}
        onToggle={() => toggleSection('memory')}
      >
        {metadata.memory.notes.length > 0 ? (
          <div className="space-y-2">
            {metadata.memory.notes.map((note) => (
              <div key={note.path} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="text-sm font-medium text-slate-900">{note.name}</div>
                {note.description && <div className="mt-1 text-xs text-slate-500">{note.description}</div>}
                <div className="mt-2 text-[11px] text-slate-400">Modified {formatTimestamp(note.modified_at)}</div>
                {note.preview && <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-700">{note.preview}</pre>}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No project memory notes found.</div>
        )}
      </ExpandableSection>

      <ExpandableSection
        icon={FileJson}
        title="Config"
        subtitle={metadata.local_config.exists ? `${metadata.local_config.allow_rule_count} allow rules` : 'No local Claude config'}
        expanded={!!expandedSections.config}
        onToggle={() => toggleSection('config')}
      >
        {metadata.local_config.exists ? (
          <div className="space-y-3 text-sm text-slate-600">
            <div>Modified {formatTimestamp(metadata.local_config.modified_at)}</div>
            {metadata.local_config.allow_rules_preview.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <ul className="max-h-48 space-y-1 overflow-auto text-xs text-slate-700">
                  {metadata.local_config.allow_rules_preview.map((rule) => (
                    <li key={rule} className="break-all">{rule}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="text-sm text-slate-500">No local Claude config found.</div>
        )}
      </ExpandableSection>
    </div>
  );
}

function SessionExpandable({
  trace,
  isExpanded,
  onToggle,
}: {
  trace: Trace;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 px-4 py-3 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-slate-900">{trace.sessionId}</div>
          <div className="text-xs text-slate-400">
            {trace.agentName} · {trace.llmCalls.length} LLM · Modified {formatTimestamp(trace.lastUpdatedAt || trace.lastRequestTime)}
          </div>
        </div>
        <div className="text-slate-400">
          {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </div>
      </button>
      {isExpanded && (
        <div className="border-t border-slate-200/80 p-4">
          <EnhancedTraceDetail trace={trace} />
        </div>
      )}
    </div>
  );
}

function SessionsSection({
  traces,
  selectedTraceId,
  onSelectTrace,
}: {
  traces: Trace[];
  selectedTraceId?: string | null;
  onSelectTrace: (traceId: string) => void;
}) {
  return (
    <div className="space-y-3">
      {traces.map((trace) => (
        <SessionExpandable
          key={trace.id}
          trace={trace}
          isExpanded={selectedTraceId === trace.id}
          onToggle={() => onSelectTrace(selectedTraceId === trace.id ? '' : trace.id)}
        />
      ))}
    </div>
  );
}

export const ProjectDetailPane: React.FC<ProjectDetailPaneProps> = ({
  projectMetadata,
  projectMetadataLoading = false,
  projectMetadataError = null,
  projectSessions,
  selectedTraceId,
  onSelectTrace,
}) => {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    metadata: true,
    sessions: true,
  });

  const toggleSection = (key: string) => {
    setExpandedSections((current) => ({ ...current, [key]: !current[key] }));
  };

  const sessionsLabel = useMemo(() => `${projectSessions.length} sessions`, [projectSessions.length]);

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/70 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Project</h2>
        <p className="mt-1 text-sm text-slate-500">Expand sections to inspect project context and session details.</p>
      </div>

      <ExpandableSection
        icon={FolderTree}
        title="Project metadata"
        expanded={!!expandedSections.metadata}
        onToggle={() => toggleSection('metadata')}
      >
        {projectMetadataLoading ? (
          <div className="text-sm text-slate-500">Loading project metadata…</div>
        ) : projectMetadataError ? (
          <div className="text-sm text-red-600">{projectMetadataError}</div>
        ) : projectMetadata ? (
          <ProjectMetadataBody metadata={projectMetadata} />
        ) : (
          <div className="text-sm text-slate-500">No project metadata available.</div>
        )}
      </ExpandableSection>

      <ExpandableSection
        icon={FolderTree}
        title="Sessions"
        subtitle={sessionsLabel}
        expanded={!!expandedSections.sessions}
        onToggle={() => toggleSection('sessions')}
      >
        <SessionsSection traces={projectSessions} selectedTraceId={selectedTraceId} onSelectTrace={onSelectTrace} />
      </ExpandableSection>
    </div>
  );
};

export default ProjectDetailPane;
