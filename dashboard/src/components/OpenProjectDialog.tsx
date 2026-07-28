import { useEffect, useMemo, useRef, useState } from 'react';
import { Folder, FolderOpen, LoaderCircle, Search, X } from 'lucide-react';
import { API_URL } from '../lib/api';
import type { ProjectCatalogItem, ProjectMetadataResponse } from '../lib/sessionApiTypes';
import type { Language } from '../lib/language';

interface OpenProjectDialogProps {
  open: boolean;
  projects: ProjectCatalogItem[];
  language: Language;
  onClose: () => void;
  onOpenProject: (projectPath: string) => void;
}

const dialogCopy = {
  en: {
    title: 'Open Project',
    detected: 'Detected projects',
    filter: 'Filter projects',
    custom: 'Custom project path',
    pathPlaceholder: '/path/to/project',
    inspect: 'Inspect',
    open: 'Open',
    noProjects: 'No detected projects match this search.',
    invalid: 'Enter a directory that exists on this machine.',
    inspectFailed: 'AgentLens could not inspect this path.',
    sessions: 'indexed sessions',
    logs: 'session logs',
    instruction: 'instruction',
    memory: 'memory notes',
    skills: 'skills',
    worktrees: 'worktrees',
  },
  zh: {
    title: '打开项目',
    detected: '检测到的项目',
    filter: '筛选项目',
    custom: '自定义项目路径',
    pathPlaceholder: '/项目/路径',
    inspect: '检测',
    open: '打开',
    noProjects: '没有匹配的已检测项目。',
    invalid: '请输入本机存在的目录。',
    inspectFailed: 'AgentLens 无法检测此路径。',
    sessions: '个已索引会话',
    logs: '个会话日志',
    instruction: '项目指令',
    memory: '条记忆',
    skills: '个技能',
    worktrees: '个工作树',
  },
} as const;

function projectName(projectPath: string): string {
  return projectPath.split(/[\\/]/).filter(Boolean).pop() || projectPath;
}

export function OpenProjectDialog({
  open,
  projects,
  language,
  onClose,
  onOpenProject,
}: OpenProjectDialogProps) {
  const copy = dialogCopy[language];
  const inputRef = useRef<HTMLInputElement>(null);
  const [filter, setFilter] = useState('');
  const [customPath, setCustomPath] = useState('');
  const [inspection, setInspection] = useState<ProjectMetadataResponse | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [inspectionError, setInspectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const focusHandle = window.requestAnimationFrame(() => inputRef.current?.focus());
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      window.cancelAnimationFrame(focusHandle);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [onClose, open]);

  useEffect(() => {
    if (!open) {
      setFilter('');
      setCustomPath('');
      setInspection(null);
      setInspectionError(null);
    }
  }, [open]);

  const filteredProjects = useMemo(() => {
    const query = filter.trim().toLowerCase();
    if (!query) return projects;
    return projects.filter((project) => (
      project.name.toLowerCase().includes(query) || project.path.toLowerCase().includes(query)
    ));
  }, [filter, projects]);

  const inspectPath = async () => {
    const path = customPath.trim();
    if (!path) return;
    setInspecting(true);
    setInspection(null);
    setInspectionError(null);
    try {
      const params = new URLSearchParams({ project_path: path });
      const response = await fetch(`${API_URL}/api/v1/projects/by-path?${params.toString()}`);
      if (!response.ok) throw new Error(copy.inspectFailed);
      const payload = (await response.json()) as ProjectMetadataResponse;
      setInspection(payload);
      if (!payload.identity.exists || !payload.identity.is_directory) {
        setInspectionError(copy.invalid);
      }
    } catch (error) {
      setInspectionError(error instanceof Error ? error.message : copy.inspectFailed);
    } finally {
      setInspecting(false);
    }
  };

  if (!open) return null;

  const canOpenInspection = Boolean(inspection?.identity.exists && inspection.identity.is_directory);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center bg-ink-900/45 p-4 pt-[8vh] backdrop-blur-sm"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-project-title"
        className="flex max-h-[84vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-ink-200 bg-white shadow-2xl shadow-ink-900/25"
      >
        <div className="flex items-center justify-between border-b border-ink-100 px-5 py-4">
          <div className="flex items-center gap-3">
            <FolderOpen className="h-5 w-5 text-clay-600" />
            <h2 id="open-project-title" className="text-base font-semibold text-ink-900">{copy.title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-ink-700 hover:bg-ink-50">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto">
          <section className="border-b border-ink-100 px-5 py-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold uppercase text-ink-700/70">{copy.detected}</h3>
              <div className="relative w-full max-w-xs">
                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-ink-700/40" />
                <input
                  ref={inputRef}
                  value={filter}
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder={copy.filter}
                  className="w-full rounded-lg border border-ink-100 bg-ink-50 py-2 pl-9 pr-3 text-sm outline-none focus:border-clay-500 focus:bg-white"
                />
              </div>
            </div>
            <div className="max-h-64 space-y-1 overflow-y-auto">
              {filteredProjects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => onOpenProject(project.path)}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-ink-50"
                >
                  <Folder className="h-4 w-4 shrink-0 text-clay-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink-900">{project.name || projectName(project.path)}</span>
                    <span className="block truncate font-mono text-[11px] text-ink-700/55">{project.path}</span>
                  </span>
                  <span className="shrink-0 font-mono text-xs text-ink-700/55">{project.session_count}</span>
                </button>
              ))}
              {filteredProjects.length === 0 && (
                <p className="px-3 py-5 text-center text-sm text-ink-700/55">{copy.noProjects}</p>
              )}
            </div>
          </section>

          <section className="px-5 py-4">
            <h3 className="mb-3 text-xs font-semibold uppercase text-ink-700/70">{copy.custom}</h3>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                value={customPath}
                onChange={(event) => {
                  setCustomPath(event.target.value);
                  setInspection(null);
                  setInspectionError(null);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void inspectPath();
                }}
                placeholder={copy.pathPlaceholder}
                className="min-w-0 flex-1 rounded-lg border border-ink-100 bg-ink-50 px-3 py-2 font-mono text-sm outline-none focus:border-clay-500 focus:bg-white"
              />
              <button
                type="button"
                onClick={() => void inspectPath()}
                disabled={!customPath.trim() || inspecting}
                className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink-900 px-4 py-2 text-sm font-medium text-white hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-45"
              >
                {inspecting && <LoaderCircle className="h-4 w-4 animate-spin" />}
                {copy.inspect}
              </button>
            </div>

            {inspection && (
              <div className="mt-3 flex flex-col gap-3 border-t border-ink-100 pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate font-mono text-xs text-ink-900">{inspection.identity.project_path}</p>
                  <p className="mt-1 text-xs text-ink-700/60">
                    {inspection.indexed_session_count} {copy.sessions}
                    {' · '}{inspection.session_artifacts.session_count} {copy.logs}
                    {' · '}{inspection.instructions.exists ? `1 ${copy.instruction}` : `0 ${copy.instruction}`}
                    {' · '}{inspection.memory.note_count} {copy.memory}
                    {' · '}{inspection.skills.count} {copy.skills}
                    {' · '}{inspection.worktrees.count} {copy.worktrees}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={!canOpenInspection}
                  onClick={() => inspection && onOpenProject(inspection.identity.project_path)}
                  className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-clay-600 px-4 py-2 text-sm font-medium text-white hover:bg-clay-700 disabled:cursor-not-allowed disabled:opacity-45"
                >
                  <FolderOpen className="h-4 w-4" />
                  {copy.open}
                </button>
              </div>
            )}
            {inspectionError && <p className="mt-3 text-sm text-red-600">{inspectionError}</p>}
          </section>
        </div>
      </div>
    </div>
  );
}
