import { Activity, DollarSign, Zap, Clock } from 'lucide-react';

interface HeaderProps {
  totalCost: number;
  totalTokens: number;
  activeAgents: number;
  runningTraces: number;
}

export function Header({ totalCost, totalTokens, activeAgents, runningTraces }: HeaderProps) {
  return (
    <header className="bg-slate-800 border-b border-slate-700 px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
            <Activity className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">AgentLens</h1>
            <p className="text-xs text-slate-400">Agent Execution Monitor</p>
          </div>
        </div>
        
        <div className="flex items-center gap-6">
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50">
            <Zap className="w-4 h-4 text-green-400" />
            <span className="text-sm text-slate-300">Active:</span>
            <span className="text-sm font-semibold text-green-400">{activeAgents}</span>
          </div>
          
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50">
            <Clock className="w-4 h-4 text-blue-400" />
            <span className="text-sm text-slate-300">Running:</span>
            <span className="text-sm font-semibold text-blue-400">{runningTraces}</span>
          </div>
          
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50">
            <DollarSign className="w-4 h-4 text-amber-400" />
            <span className="text-sm text-slate-300">Total Cost:</span>
            <span className="text-sm font-semibold text-amber-400">${totalCost.toFixed(2)}</span>
          </div>
          
          <div className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/50">
            <Activity className="w-4 h-4 text-purple-400" />
            <span className="text-sm text-slate-300">Tokens:</span>
            <span className="text-sm font-semibold text-purple-400">{(totalTokens / 1000000).toFixed(2)}M</span>
          </div>
        </div>
      </div>
    </header>
  );
}
