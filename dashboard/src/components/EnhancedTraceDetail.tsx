import React, { useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import {
  Activity,
  AlertCircle,
  Bot,
  Box,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  Code,
  Copy,
  DollarSign,
  FileText,
  Hash,
  Layers,
  MessageSquare,
  Sparkles,
  Terminal,
  User,
  Wrench,
} from 'lucide-react';
import type { LLMCall, ToolCall, Trace } from '../types';
import { cleanSessionText, formatDuration, truncateText } from '../lib/sessionUtils';

interface EnhancedTraceDetailProps {
  trace: Trace;
}

type TabType = 'overview' | 'timeline' | 'tools' | 'llm' | 'raw';
type TraceWithRaw = Trace & { raw?: Record<string, unknown> };

const PLATFORM_CONFIG = {
  'claude-code': { name: 'Claude Code', color: 'text-orange-400', bg: 'bg-orange-500/20' },
} as const;

export const EnhancedTraceDetail: React.FC<EnhancedTraceDetailProps> = ({ trace }) => {
  const typedTrace = trace as TraceWithRaw;
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set([0]));
  const [expandedLLMs, setExpandedLLMs] = useState<Set<string>>(new Set(['group-0']));
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatTime = (timestamp: number) =>
    new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const allTools = useMemo(() => trace.tools || [], [trace.tools]);
  const allLLMCalls = useMemo(() => trace.llmCalls || [], [trace.llmCalls]);

  const groupedLLMCalls = useMemo(() => {
    const groups: { prompt: string; calls: LLMCall[] }[] = [];
    let currentGroup: { prompt: string; calls: LLMCall[] } | null = null;

    for (const call of allLLMCalls) {
      if (!currentGroup || currentGroup.prompt !== call.prompt) {
        currentGroup = { prompt: call.prompt || '', calls: [] };
        groups.push(currentGroup);
      }
      currentGroup.calls.push(call);
    }

    return groups;
  }, [allLLMCalls]);

  const getRelatedToolCalls = (call: LLMCall): ToolCall[] => {
    if (!trace.tools || !call.startTime) return [];
    const callIndex = allLLMCalls.findIndex((candidate) => candidate.id === call.id);
    const nextCall = allLLMCalls[callIndex + 1];

    return trace.tools.filter((tool) => {
      if (!tool.startTime) return false;
      const afterThisCall = tool.startTime >= call.startTime;
      const beforeNextCall = !nextCall || tool.startTime < nextCall.startTime;
      return afterThisCall && beforeNextCall;
    });
  };

  const toggleTool = (idx: number) => {
    const newSet = new Set(expandedTools);
    if (newSet.has(idx)) newSet.delete(idx);
    else newSet.add(idx);
    setExpandedTools(newSet);
  };

  const toggleLLM = (key: string) => {
    const newSet = new Set(expandedLLMs);
    if (newSet.has(key)) newSet.delete(key);
    else newSet.add(key);
    setExpandedLLMs(newSet);
  };

  const tabs = [
    { id: 'overview', label: '概览', icon: Activity },
    { id: 'timeline', label: '时序', icon: Clock },
    { id: 'tools', label: `工具 (${allTools.length})`, icon: Wrench },
    { id: 'llm', label: `LLM (${groupedLLMCalls.length}组)`, icon: MessageSquare },
    { id: 'raw', label: '原始', icon: Code },
  ] as const;

  const renderOverview = () => {
    const rawTrace = typedTrace.raw || {};
    const rawPrompt = typeof rawTrace.prompt === 'string' ? rawTrace.prompt : '';
    const rawResponse = typeof rawTrace.response === 'string' ? rawTrace.response : '';
    const cleanedPrompt = cleanSessionText(rawPrompt || trace.prompt || '');
    const cleanedResponse = cleanSessionText(rawResponse || trace.response || '');
    const platformConfig = PLATFORM_CONFIG[trace.platform];
    const rawModels = typedTrace.metadata?.models;
    const models = Array.isArray(rawModels) ? rawModels.filter((item): item is string => typeof item === 'string') : [];

    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <MetricCard icon={Clock} color="text-blue-400" value={formatDuration(trace.duration)} label="会话时长" />
          <MetricCard icon={Wrench} color="text-violet-400" value={String(allTools.length)} label="工具调用" />
          <MetricCard icon={Hash} color="text-cyan-400" value={trace.totalTokens.toLocaleString()} label="总 Tokens" />
          <MetricCard icon={DollarSign} color="text-emerald-400" value={`$${trace.cost.toFixed(4)}`} label="总成本" />
        </div>

        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <Box className="w-4 h-4" />
            Session 信息
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <InfoField label="Agent" value={trace.agentName} />
            <div>
              <span className="text-gray-500 block text-xs mb-1">平台</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${platformConfig.bg} ${platformConfig.color}`}>
                {platformConfig.name}
              </span>
            </div>
            <InfoField label="状态" value={statusLabel(trace.status)} />
            <InfoField label="开始时间" value={formatTime(trace.startTime)} />
            <InfoField label="模型" value={trace.model || models.join(', ') || 'unknown'} />
            <InfoField label="Session ID" value={trace.sessionId} mono />
          </div>
          {trace.projectPath && <PathField label="项目路径" value={trace.projectPath} />}
          {trace.sessionFilePath && <PathField label="Session 文件" value={trace.sessionFilePath} />}
        </div>

        {(cleanedPrompt || cleanedResponse) && (
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Session 预览
            </h3>
            <div className="space-y-3">
              {cleanedPrompt && <PreviewBlock icon={User} label="用户输入" content={truncateText(cleanedPrompt, 600)} />}
              {cleanedResponse && <PreviewBlock icon={Bot} label="助手输出" content={truncateText(cleanedResponse, 600)} />}
            </div>
          </div>
        )}

        {(allTools.length > 0 || allLLMCalls.length > 0) && (
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4" />
              会话摘要
            </h3>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <SummaryList
                title={`LLM 调用 (${allLLMCalls.length})`}
                color="text-cyan-400"
                rows={allLLMCalls.slice(0, 5).map((call) => ({
                  label: call.model,
                  meta: `${call.inputTokens.toLocaleString()} → ${call.outputTokens.toLocaleString()} tokens`,
                }))}
              />
              <SummaryList
                title={`工具调用 (${allTools.length})`}
                color="text-violet-400"
                rows={allTools.slice(0, 5).map((tool) => ({
                  label: tool.name,
                  meta: formatDuration(tool.duration),
                }))}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderTimeline = () => {
    const events = [
      { type: 'start', name: '开始', time: trace.startTime, duration: 0 },
      ...allTools.map((tool) => ({ type: 'tool', name: tool.name, time: tool.startTime, duration: tool.duration })),
      ...allLLMCalls.map((call) => ({ type: 'llm', name: call.model, time: call.startTime, duration: call.duration })),
      ...(trace.endTime ? [{ type: 'end', name: trace.status === 'completed' ? '完成' : '结束', time: trace.endTime, duration: 0 }] : []),
    ].sort((a, b) => a.time - b.time);

    const totalDuration = trace.duration || 1;

    return (
      <div className="space-y-4">
        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <div className="relative">
            <div className="h-8 bg-slate-900 rounded-full overflow-hidden mb-4">
              {events
                .filter((event) => event.type !== 'start' && event.type !== 'end')
                .map((event, idx) => {
                  const left = ((event.time - trace.startTime) / totalDuration) * 100;
                  const width = Math.max((event.duration / totalDuration) * 100, 0.5);
                  return (
                    <div
                      key={idx}
                      className={`absolute top-1 bottom-1 rounded ${event.type === 'tool' ? 'bg-violet-500/60' : 'bg-cyan-500/60'}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      title={`${event.name} (${formatDuration(event.duration)})`}
                    />
                  );
                })}
            </div>

            <div className="space-y-2">
              {events.map((event, idx) => (
                <div key={idx} className="flex items-center gap-3 text-sm">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      event.type === 'start'
                        ? 'bg-blue-500'
                        : event.type === 'end'
                          ? trace.status === 'completed'
                            ? 'bg-emerald-500'
                            : 'bg-red-500'
                          : event.type === 'tool'
                            ? 'bg-violet-500'
                            : 'bg-cyan-500'
                    }`}
                  />
                  <span className="text-gray-400 w-24">{formatTime(event.time)}</span>
                  <span className="flex-1">{event.name}</span>
                  {event.duration > 0 && <span className="text-gray-500">{formatDuration(event.duration)}</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getToolSummary = (tool: ToolCall): string => {
    const input = tool.input || {};
    switch (tool.name) {
      case 'Agent':
        return typeof input.description === 'string' ? input.description : typeof input.prompt === 'string' ? input.prompt : '';
      case 'Bash':
        return typeof input.command === 'string' ? input.command : '';
      case 'Write':
      case 'Edit':
      case 'Read':
        return typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : '';
      default: {
        const keys = Object.keys(input);
        if (!keys.length) return '';
        const firstKey = keys[0];
        const value = input[firstKey];
        if (typeof value === 'string' && value.length < 80) return `${firstKey}: ${value}`;
        return firstKey;
      }
    }
  };

  const renderTools = () => (
    <div className="space-y-2">
      {allTools.length === 0 ? (
        <EmptyState icon={Wrench} label="无工具调用记录" />
      ) : (
        allTools.map((tool, idx) => {
          const isExpanded = expandedTools.has(idx);
          const summary = getToolSummary(tool);
          const displaySummary = summary.length > 60 ? `${summary.slice(0, 60)}...` : summary;

          return (
            <div
              key={idx}
              className={`rounded-lg border transition-all ${
                isExpanded ? 'bg-slate-800/50 border-slate-600' : 'bg-slate-800/30 border-slate-700/50'
              }`}
            >
              <button onClick={() => toggleTool(idx)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center ${
                    tool.status === 'success'
                      ? 'bg-emerald-500/20'
                      : tool.status === 'error'
                        ? 'bg-red-500/20'
                        : 'bg-yellow-500/20'
                  }`}
                >
                  <Wrench
                    className={`w-4 h-4 ${
                      tool.status === 'success'
                        ? 'text-emerald-400'
                        : tool.status === 'error'
                          ? 'text-red-400'
                          : 'text-yellow-400'
                    }`}
                  />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{tool.name}</span>
                    {displaySummary && (
                      <span className="text-xs text-gray-500 truncate flex-1" title={summary}>
                        {displaySummary}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-gray-400 mt-0.5">
                    <span>{tool.status}</span>
                    <span>·</span>
                    <span>{formatDuration(tool.duration)}</span>
                    <span>·</span>
                    <span>{formatTime(tool.startTime)}</span>
                  </div>
                </div>
                {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-700/50 space-y-4">
                  {tool.input && Object.keys(tool.input).length > 0 && (
                    <JsonBlock title="输入参数" value={tool.input} copyId={`tool-input-${idx}`} copiedId={copiedId} onCopy={copyToClipboard} />
                  )}
                  {tool.output != null && (
                    <JsonOrTextBlock title="输出结果" value={tool.output} copyId={`tool-output-${idx}`} copiedId={copiedId} onCopy={copyToClipboard} />
                  )}
                  {tool.error && (
                    <div className="bg-red-950/30 border border-red-900/30 rounded p-3">
                      <div className="flex items-center gap-1 mb-2 text-red-400 text-xs font-medium">
                        <AlertCircle className="w-3 h-3" /> 错误信息
                      </div>
                      <pre className="text-xs text-red-300 whitespace-pre-wrap">{tool.error}</pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const renderLLM = () => (
    <div className="space-y-4">
      {allLLMCalls.length === 0 ? (
        <EmptyState icon={MessageSquare} label="无 LLM 调用记录" />
      ) : (
        groupedLLMCalls.map((group, groupIdx) => {
          const groupKey = `group-${groupIdx}`;
          const isGroupExpanded = expandedLLMs.has(groupKey);
          const cleanedPrompt = cleanSessionText(group.prompt || '');
          const promptPreview = cleanedPrompt
            ? `${cleanedPrompt.replace(/\n/g, ' ').slice(0, 80)}${cleanedPrompt.length > 80 ? '...' : ''}`
            : '无提示词';

          return (
            <div
              key={groupKey}
              className={`rounded-lg border transition-all ${
                isGroupExpanded ? 'bg-slate-800/50 border-slate-600' : 'bg-slate-800/30 border-slate-700/50'
              }`}
            >
              <button onClick={() => toggleLLM(groupKey)} className="w-full px-4 py-3 flex items-center gap-3 text-left">
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <span className="text-xs text-cyan-400 font-mono">{groupIdx + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 truncate">{promptPreview}</div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                    <span>{group.calls.length} 次调用</span>
                    <span>·</span>
                    <span>
                      {group.calls.reduce((sum, call) => sum + call.inputTokens, 0).toLocaleString()} →{' '}
                      {group.calls.reduce((sum, call) => sum + call.outputTokens, 0).toLocaleString()} tokens
                    </span>
                  </div>
                </div>
                {isGroupExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>

              {isGroupExpanded && (
                <div className="border-t border-slate-700/50">
                  {group.prompt && (
                    <div className="px-4 py-3 bg-slate-900/30 border-b border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-cyan-400 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" /> 用户提示词
                        </span>
                        <button
                          onClick={() => copyToClipboard(group.prompt, `group-prompt-${groupIdx}`)}
                          className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
                        >
                          {copiedId === `group-prompt-${groupIdx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === `group-prompt-${groupIdx}` ? '已复制' : '复制'}
                        </button>
                      </div>
                      <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-32 overflow-auto">{cleanedPrompt}</div>
                    </div>
                  )}

                  <div className="space-y-2 p-4">
                    {group.calls.map((call, callIdx) => {
                      const callKey = `call-${groupIdx}-${callIdx}`;
                      const isCallExpanded = expandedLLMs.has(callKey);
                      const relatedTools = getRelatedToolCalls(call);
                      return (
                        <div key={callKey} className={`rounded border ${isCallExpanded ? 'bg-slate-800/70 border-slate-600' : 'bg-slate-800/40 border-slate-700/50'}`}>
                          <button onClick={() => toggleLLM(callKey)} className="w-full px-3 py-2 flex items-center gap-2 text-left">
                            <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                              <span className="text-xs text-blue-400 font-mono">{callIdx + 1}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-300 truncate">
                                {call.response
                                  ? `${cleanSessionText(call.response).replace(/\n/g, ' ').slice(0, 60)}${cleanSessionText(call.response).length > 60 ? '...' : ''}`
                                  : '无响应内容'}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                                <span>{call.model}</span>
                                <span>·</span>
                                <span>{call.inputTokens.toLocaleString()} → {call.outputTokens.toLocaleString()} tokens</span>
                                <span>·</span>
                                <span>{formatDuration(call.duration)}</span>
                              </div>
                            </div>
                            {isCallExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
                          </button>

                          {isCallExpanded && (
                            <div className="px-3 pb-3 border-t border-slate-700/50 space-y-3">
                              {call.response && (
                                <JsonOrTextBlock
                                  title="模型响应"
                                  value={cleanSessionText(call.response)}
                                  copyId={`llm-response-${callKey}`}
                                  copiedId={copiedId}
                                  onCopy={copyToClipboard}
                                />
                              )}
                              {relatedTools.length > 0 && (
                                <div>
                                  <div className="text-xs font-medium text-violet-400 mb-2">相关工具调用</div>
                                  <div className="space-y-2">
                                    {relatedTools.map((tool) => (
                                      <div key={`${callKey}-${tool.id}`} className="rounded bg-slate-900/40 border border-slate-800 p-2 text-xs text-gray-300">
                                        <div className="font-medium text-violet-300">{tool.name}</div>
                                        {tool.input && <pre className="mt-1 whitespace-pre-wrap text-gray-400">{JSON.stringify(tool.input, null, 2)}</pre>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );

  const renderRaw = () => (
    <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-slate-900/50 border-b border-slate-800">
        <span className="text-xs text-gray-400">原始 Session 记录</span>
        <button
          onClick={() => copyToClipboard(JSON.stringify(typedTrace.raw || trace, null, 2), 'raw-trace')}
          className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
        >
          {copiedId === 'raw-trace' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copiedId === 'raw-trace' ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="p-4 text-xs text-gray-300 overflow-auto max-h-[32rem] whitespace-pre-wrap font-mono">{JSON.stringify(typedTrace.raw || trace, null, 2)}</pre>
    </div>
  );

  return (
    <div className="bg-slate-800 rounded-lg border border-slate-700/50 overflow-hidden">
      <div className="border-b border-slate-700 px-4 py-3 flex flex-wrap gap-2">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-lg text-sm flex items-center gap-2 transition-colors ${
              activeTab === tab.id ? 'bg-blue-600 text-white' : 'text-gray-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      <div className="p-4">
        {activeTab === 'overview' && renderOverview()}
        {activeTab === 'timeline' && renderTimeline()}
        {activeTab === 'tools' && renderTools()}
        {activeTab === 'llm' && renderLLM()}
        {activeTab === 'raw' && renderRaw()}
      </div>
    </div>
  );
};

function statusLabel(status: Trace['status']): string {
  switch (status) {
    case 'completed':
      return '已完成';
    case 'failed':
      return '失败';
    case 'running':
      return '运行中';
    case 'cancelled':
      return '已取消';
    default:
      return status;
  }
}

function MetricCard({
  icon: Icon,
  color,
  value,
  label,
}: {
  icon: ComponentType<{ className?: string }>;
  color: string;
  value: string;
  label: string;
}) {
  return (
    <div className="bg-slate-800/50 rounded-lg p-4 text-center border border-slate-700/50">
      <Icon className={`w-6 h-6 mx-auto mb-2 ${color}`} />
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-gray-500">{label}</div>
    </div>
  );
}

function InfoField({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <span className="text-gray-500 block text-xs mb-1">{label}</span>
      <span className={mono ? 'font-mono text-xs' : 'font-medium'}>{value}</span>
    </div>
  );
}

function PathField({ label, value }: { label: string; value: string }) {
  return (
    <div className="mt-3 flex items-start gap-2">
      <span className="text-xs text-gray-500 shrink-0">{label}:</span>
      <code className="text-xs text-gray-300 font-mono break-all">{value}</code>
    </div>
  );
}

function PreviewBlock({
  icon: Icon,
  label,
  content,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  content: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-1 mb-1">
        <Icon className="w-3 h-3 text-gray-500" />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <div className="text-sm text-gray-200 bg-slate-900/50 rounded p-2 border border-slate-700/50 whitespace-pre-wrap">{content}</div>
    </div>
  );
}

function SummaryList({ title, color, rows }: { title: string; color: string; rows: Array<{ label: string; meta: string }> }) {
  return (
    <div>
      <h4 className={`text-xs font-medium mb-2 ${color}`}>{title}</h4>
      <div className="space-y-1">
        {rows.map((row, idx) => (
          <div key={`${row.label}-${idx}`} className="flex items-center justify-between gap-3 text-sm">
            <span className="truncate flex-1">{row.label}</span>
            <span className="text-xs text-gray-500">{row.meta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, label }: { icon: ComponentType<{ className?: string }>; label: string }) {
  return (
    <div className="text-center py-8 text-gray-500">
      <Icon className="w-12 h-12 mx-auto mb-3 opacity-30" />
      <p>{label}</p>
    </div>
  );
}

function JsonBlock({
  title,
  value,
  copyId,
  copiedId,
  onCopy,
}: {
  title: string;
  value: unknown;
  copyId: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-green-400 flex items-center gap-1">
          <Terminal className="w-3 h-3" />
          {title}
        </span>
        <button onClick={() => onCopy(JSON.stringify(value, null, 2), copyId)} className="text-xs text-gray-500 hover:text-white flex items-center gap-1">
          {copiedId === copyId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copiedId === copyId ? '已复制' : '复制'}
        </button>
      </div>
      <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
        <pre className="p-3 text-xs text-green-400 overflow-auto max-h-60 whitespace-pre-wrap font-mono">{JSON.stringify(value, null, 2)}</pre>
      </div>
    </div>
  );
}

function JsonOrTextBlock({
  title,
  value,
  copyId,
  copiedId,
  onCopy,
}: {
  title: string;
  value: unknown;
  copyId: string;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-blue-400 flex items-center gap-1">
          <FileText className="w-3 h-3" />
          {title}
        </span>
        <button onClick={() => onCopy(text, copyId)} className="text-xs text-gray-500 hover:text-white flex items-center gap-1">
          {copiedId === copyId ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copiedId === copyId ? '已复制' : '复制'}
        </button>
      </div>
      <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
        <pre className="p-3 text-xs text-blue-300 overflow-auto max-h-60 whitespace-pre-wrap font-mono">{text}</pre>
      </div>
    </div>
  );
}

export default EnhancedTraceDetail;
