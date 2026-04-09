import { Play, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import type { RealtimeExecution } from '../types';

interface Props {
  executions: RealtimeExecution[];
}

const platformColors: Record<string, string> = {
  openclaw: 'bg-blue-500',
  'claude-code': 'bg-orange-500',
  'kimi-code': 'bg-green-500',
  cursor: 'bg-purple-500',
};

export function RealtimeExecutionList({ executions }: Props) {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white flex items-center gap-2">
          <Play className="w-5 h-5 text-green-400" />
          Real-time Executions
        </h2>
        <span className="px-2 py-1 rounded-full bg-green-500/20 text-green-400 text-xs font-medium">
          {executions.filter(e => e.status === 'running').length} Running
        </span>
      </div>
      
      <div className="space-y-3">
        {executions.map((exec) => (
          <div
            key={exec.id}
            className="p-4 rounded-lg bg-slate-700/30 border border-slate-600/50 hover:border-slate-500 transition-colors"
          >
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${platformColors[exec.platform] || 'bg-slate-500'} ${exec.status === 'running' ? 'animate-pulse' : ''}`} />
                <span className="font-medium text-white">{exec.agentName}</span>
                <span className="px-2 py-0.5 rounded text-xs bg-slate-600 text-slate-300 capitalize">
                  {exec.platform}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {exec.status === 'running' && (
                  <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />
                )}
                {exec.status === 'completed' && (
                  <CheckCircle className="w-4 h-4 text-green-400" />
                )}
                {exec.status === 'failed' && (
                  <XCircle className="w-4 h-4 text-red-400" />
                )}
                <span className={`text-xs font-medium ${
                  exec.status === 'running' ? 'text-blue-400' :
                  exec.status === 'completed' ? 'text-green-400' : 'text-red-400'
                }`}>
                  {exec.status}
                </span>
              </div>
            </div>
            
            <div className="mb-2">
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-slate-400">
                  {exec.currentTool ? (
                    <>Current: <span className="text-slate-300">{exec.currentTool}</span></>
                  ) : (
                    <span className="text-slate-500">Initializing...</span>
                  )}
                </span>
                <span className="text-slate-400">{exec.progress}%</span>
              </div>
              <div className="h-2 bg-slate-600 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full transition-all duration-500"
                  style={{ width: `${exec.progress}%` }}
                />
              </div>
            </div>
            
            <div className="flex items-center justify-between text-xs text-slate-500">
              <span>Started {formatDuration(exec.startTime)}</span>
              {exec.estimatedEndTime && (
                <span>ETA: {formatDuration(exec.estimatedEndTime - Date.now())}</span>
              )}
            </div>
          </div>
        ))}
        
        {executions.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            No active executions
          </div>
        )}
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms < 0) return 'completed';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}
