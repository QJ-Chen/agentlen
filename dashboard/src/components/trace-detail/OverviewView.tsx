import { Box, Clock, DollarSign, ExternalLink, FileText, MessageSquare, Wrench } from 'lucide-react';
import type { Trace } from '../../types';
import { formatDuration, formatTimestamp } from '../../lib/sessionUtils';
import { InfoField, MetricCard, PathField } from '../TraceDetailBlocks';
import { SURFACE_CLASS, formatClockTime } from './shared';
import { useLanguage } from '../../lib/language';

const PLATFORM_CONFIG = {
  'claude-code': { name: 'Claude Code', color: 'text-orange-700', bg: 'bg-orange-50 border border-orange-100' },
  codex: { name: 'Codex', color: 'text-emerald-700', bg: 'bg-emerald-50 border border-emerald-100' },
} as const;

export function OverviewView({
  trace,
  promptGroupCount,
  toolCount,
  openingTarget,
  openError,
  onOpenPath,
}: {
  trace: Trace;
  promptGroupCount: number;
  toolCount: number;
  openingTarget: 'project' | 'session_folder' | null;
  openError: string | null;
  onOpenPath: (target: 'project' | 'session_folder') => void;
}) {
  const { t } = useLanguage();
  const platformConfig = PLATFORM_CONFIG[trace.platform] ?? PLATFORM_CONFIG['claude-code'];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <MetricCard icon={Clock} color="text-clay-600" value={formatDuration(trace.duration)} label={t('sessionDuration')} />
        <MetricCard icon={MessageSquare} color="text-cyan-600" value={String(promptGroupCount)} label={t('promptGroups')} />
        <MetricCard icon={Wrench} color="text-violet-600" value={String(toolCount)} label={t('toolCalls')} />
        <MetricCard icon={DollarSign} color="text-emerald-600" value={`$${trace.cost.toFixed(4)}`} label={t('totalCost')} />
      </div>

      {trace.recapText && (
        <div className={SURFACE_CLASS}>
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-500">
            <FileText className="h-4 w-4 text-slate-400" />
            Recap
          </h3>
          <div className="max-h-64 overflow-y-auto overscroll-contain pr-2 text-sm text-slate-700 whitespace-pre-wrap">
            {trace.recapText}
          </div>
        </div>
      )}

      <div className={SURFACE_CLASS}>
        <h3 className="mb-4 flex items-center gap-2 text-sm font-semibold text-slate-500">
          <Box className="h-4 w-4 text-slate-400" />
          {t('sessionInfo')}
        </h3>
        <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <InfoField label="Agent" value={trace.agentName} />
          <div>
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-400">{t('platform')}</span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${platformConfig.bg} ${platformConfig.color}`}>
              {platformConfig.name}
            </span>
          </div>
          <InfoField label={t('startTime')} value={formatClockTime(trace.startTime)} />
          <InfoField label={t('modified')} value={formatTimestamp(trace.lastUpdatedAt || trace.lastRequestTime)} />
          <InfoField label={t('lastActivity')} value={formatClockTime(trace.lastRequestTime)} />
          <InfoField label={t('created')} value={formatTimestamp(trace.createdAt || trace.startTime)} />
          <InfoField label="Session ID" value={trace.sessionId} mono />
        </div>
        {trace.projectPath && <PathField label={t('projectPath')} value={trace.projectPath} actionLabel={t('openProject')} actionIcon={ExternalLink} actionPending={openingTarget === 'project'} onAction={() => onOpenPath('project')} />}
        {trace.sessionFilePath && <PathField label={t('sessionFile')} value={trace.sessionFilePath} actionLabel={t('openFolder')} actionIcon={ExternalLink} actionPending={openingTarget === 'session_folder'} onAction={() => onOpenPath('session_folder')} />}
        {openError && <div className="mt-3 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{openError}</div>}
      </div>
    </div>
  );
}
