import React from 'react';
import { BookOpen, FileJson, FolderTree, ScrollText } from 'lucide-react';
import type { ProjectMetadata } from '../types';
import { formatTimestamp } from '../lib/sessionUtils';

interface ProjectMetadataPanelProps {
  metadata: ProjectMetadata | null;
  loading?: boolean;
  error?: string | null;
}

function Section({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-slate-200/80 bg-slate-50/80 p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <Icon className="h-4 w-4 text-slate-500" />
        {title}
      </div>
      <div className="space-y-3 text-sm text-slate-600">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</span>
      <div className="min-w-0 text-slate-800 sm:text-right">{value}</div>
    </div>
  );
}

export const ProjectMetadataPanel: React.FC<ProjectMetadataPanelProps> = ({
  metadata,
  loading = false,
  error = null,
}) => {
  if (loading) {
    return (
      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/70">
        <div className="text-sm text-slate-500">Loading project metadata…</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-3xl border border-red-200 bg-white p-5 shadow-sm shadow-slate-200/70">
        <div className="text-sm text-red-600">{error}</div>
      </div>
    );
  }

  if (!metadata) {
    return (
      <div className="rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/70">
        <div className="text-sm text-slate-500">Select a session with project context to view project metadata.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-200/70 xl:max-h-[calc(100vh-3rem)] xl:overflow-y-auto">
      <div>
        <h2 className="text-lg font-semibold text-slate-950">Project Metadata</h2>
        <p className="mt-1 text-sm text-slate-500">Claude project context for the selected session.</p>
      </div>

      <Section icon={BookOpen} title="Instructions">
        {metadata.instructions.exists ? (
          <>
            <Row label="Modified" value={formatTimestamp(metadata.instructions.modified_at)} />
            <Row label="Path" value={<code className="break-all text-xs text-slate-700">{metadata.instructions.path}</code>} />
            {metadata.instructions.preview && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <pre className="max-h-56 overflow-auto whitespace-pre-wrap text-xs leading-6 text-slate-700">{metadata.instructions.preview}</pre>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-slate-500">No CLAUDE.md found for this project.</div>
        )}
      </Section>

      <Section icon={ScrollText} title="Project memory">
        <Row label="Notes" value={String(metadata.memory.note_count)} />
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
      </Section>

      <Section icon={FileJson} title="Local Claude config">
        {metadata.local_config.exists ? (
          <>
            <Row label="Modified" value={formatTimestamp(metadata.local_config.modified_at)} />
            <Row label="Allow rules" value={String(metadata.local_config.allow_rule_count)} />
            {metadata.local_config.allow_rules_preview.length > 0 && (
              <div className="rounded-xl border border-slate-200 bg-white p-3">
                <ul className="max-h-48 space-y-1 overflow-auto text-xs text-slate-700">
                  {metadata.local_config.allow_rules_preview.map((rule) => (
                    <li key={rule} className="break-all">{rule}</li>
                  ))}
                </ul>
              </div>
            )}
          </>
        ) : (
          <div className="text-sm text-slate-500">No local Claude config found.</div>
        )}
      </Section>

      <Section icon={FolderTree} title="Project artifacts">
        <Row label="Sessions" value={String(metadata.session_artifacts.session_count)} />
        <Row label="Subagents" value={String(Math.max(metadata.session_artifacts.subagent_log_count, metadata.session_artifacts.subagent_meta_count))} />
        <Row label="Tool results" value={String(metadata.session_artifacts.tool_result_count)} />
      </Section>
    </div>
  );
};

export default ProjectMetadataPanel;
