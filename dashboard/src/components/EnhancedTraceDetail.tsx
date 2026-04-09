import React, { useState, useMemo } from 'react';
import {
  Terminal,
  Wrench,
  MessageSquare,
  Code,
  FileText,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
  Check,
  Clock,
  Hash,
  DollarSign,
  Layers,
  Zap,
  Box,
  Activity,
  Sparkles,
  User,
  Bot,
} from 'lucide-react';
import type { Trace } from '../types';

interface EnhancedTraceDetailProps {
  trace: Trace & { raw?: any };
}

type TabType = 'overview' | 'timeline' | 'tools' | 'llm' | 'raw';

// Platform display names and colors
const PLATFORM_CONFIG: Record<string, { name: string; color: string; bg: string }> = {
  'claude-code': { name: 'Claude Code', color: 'text-orange-400', bg: 'bg-orange-500/20' },
  'openclaw': { name: 'OpenClaw', color: 'text-blue-400', bg: 'bg-blue-500/20' },
  'kimi-code': { name: 'Kimi Code', color: 'text-violet-400', bg: 'bg-violet-500/20' },
  'cursor': { name: 'Cursor', color: 'text-purple-400', bg: 'bg-purple-500/20' },
};

// Clean command tag pollution from text
function cleanCommandText(text: string): string {
  if (!text) return '';
  return text
    .replace(/<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi, '')
    .replace(/<command-name>.*?<\/command-name>/gi, '')
    .replace(/<command-args>.*?<\/command-args>/gi, '')
    .replace(/<command-message>.*?<\/command-message>/gi, '')
    .replace(/<local-command-stdout>[\s\S]*?<\/local-command-stdout>/gi, '')
    .trim();
}

// Truncate text with ellipsis
function truncateText(text: string, maxLength: number): string {
  if (!text || text.length <= maxLength) return text;
  return text.substring(0, maxLength) + '...';
}

// Format thinking content for display
function formatThinking(thinking: string): string {
  if (!thinking) return '';
  // Truncate long thinking content
  if (thinking.length > 500) {
    return thinking.substring(0, 500) + '...\n[thinking truncated]';
  }
  return thinking;
}

export const EnhancedTraceDetail: React.FC<EnhancedTraceDetailProps> = ({ trace }) => {
  const [activeTab, setActiveTab] = useState<TabType>('overview');
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set([0]));
  const [expandedLLMs, setExpandedLLMs] = useState<Set<number>>(new Set([0]));
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  const formatDuration = (ms?: number) => {
    if (!ms) return '-';
    if (ms < 1000) return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Use tools directly from trace (already parsed in App.tsx)
  const allTools = useMemo(() => {
    return trace.tools || [];
  }, [trace.tools]);

  // Use llmCalls directly from trace (already parsed in App.tsx)
  const allLLMCalls = useMemo(() => {
    return trace.llmCalls || [];
  }, [trace.llmCalls]);

  // Group LLM calls by prompt
  const groupedLLMCalls = useMemo(() => {
    const groups: { prompt: string; calls: typeof allLLMCalls }[] = [];
    let currentGroup: { prompt: string; calls: typeof allLLMCalls } | null = null;

    for (const call of allLLMCalls) {
      if (!currentGroup || currentGroup.prompt !== call.prompt) {
        currentGroup = { prompt: call.prompt || '', calls: [] };
        groups.push(currentGroup);
      }
      currentGroup.calls.push(call);
    }

    return groups;
  }, [allLLMCalls]);

  // Find tool calls related to a specific LLM call
  const getRelatedToolCalls = (call: typeof allLLMCalls[0]) => {
    if (!trace.tools || !call.startTime) return [];
    
    // Find tools that happened after this LLM call but before the next one
    const callIndex = allLLMCalls.findIndex(c => c.id === call.id);
    const nextCall = allLLMCalls[callIndex + 1];
    
    return trace.tools.filter(tool => {
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

  const toggleLLM = (idx: number) => {
    const newSet = new Set(expandedLLMs);
    if (newSet.has(idx)) newSet.delete(idx);
    else newSet.add(idx);
    setExpandedLLMs(newSet);
  };

  const tabs = [
    { id: 'overview', label: '概览', icon: Activity },
    { id: 'timeline', label: '时序', icon: Clock },
    { id: 'tools', label: `工具 (${allTools.length})`, icon: Wrench },
    { id: 'llm', label: `LLM (${groupedLLMCalls.length}组)`, icon: MessageSquare },
    { id: 'raw', label: '原始', icon: Code },
  ];

  // Render Overview Tab
  const renderOverview = () => {
    // Get cleaned prompt and response from raw data
    const rawTrace = (trace as any).raw || {};
    const cleanedPrompt = cleanCommandText(rawTrace.prompt || '');
    const cleanedResponse = cleanCommandText(rawTrace.response || '');
    const platformConfig = PLATFORM_CONFIG[trace.platform] || { name: trace.platform, color: 'text-gray-400', bg: 'bg-gray-500/20' };

    return (
      <div className="space-y-6">
        {/* Key Metrics */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-slate-800/50 rounded-lg p-4 text-center border border-slate-700/50">
            <Clock className="w-6 h-6 mx-auto mb-2 text-blue-400" />
            <div className="text-2xl font-bold">{formatDuration(trace.duration)}</div>
            <div className="text-xs text-gray-500">执行时间</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4 text-center border border-slate-700/50">
            <Wrench className="w-6 h-6 mx-auto mb-2 text-violet-400" />
            <div className="text-2xl font-bold">{allTools.length}</div>
            <div className="text-xs text-gray-500">工具调用</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4 text-center border border-slate-700/50">
            <Hash className="w-6 h-6 mx-auto mb-2 text-cyan-400" />
            <div className="text-2xl font-bold">{trace.totalTokens.toLocaleString()}</div>
            <div className="text-xs text-gray-500">Tokens</div>
          </div>
          <div className="bg-slate-800/50 rounded-lg p-4 text-center border border-slate-700/50">
            <DollarSign className="w-6 h-6 mx-auto mb-2 text-emerald-400" />
            <div className="text-2xl font-bold">${trace.cost.toFixed(4)}</div>
            <div className="text-xs text-gray-500">成本</div>
          </div>
        </div>

        {/* Agent Info */}
        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <Box className="w-4 h-4" />
            Agent 信息
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500 block text-xs mb-1">名称</span>
              <span className="font-medium">{trace.agentName}</span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs mb-1">平台</span>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${platformConfig.bg} ${platformConfig.color}`}>
                {platformConfig.name}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs mb-1">状态</span>
              <span className={`inline-flex items-center gap-1 ${
                trace.status === 'completed' ? 'text-emerald-400' :
                trace.status === 'failed' ? 'text-red-400' :
                trace.status === 'running' ? 'text-blue-400' :
                'text-gray-400'
              }`}>
                {trace.status === 'completed' && <Zap className="w-3 h-3" />}
                {trace.status === 'failed' && <AlertCircle className="w-3 h-3" />}
                {trace.status === 'running' && <Activity className="w-3 h-3" />}
                {trace.status === 'completed' ? '已完成' :
                 trace.status === 'failed' ? '失败' :
                 trace.status === 'running' ? '运行中' : '已取消'}
              </span>
            </div>
            <div>
              <span className="text-gray-500 block text-xs mb-1">时间</span>
              <span>{formatTime(trace.startTime)}</span>
            </div>
          </div>
        </div>

        {/* Session Preview - cleaned prompt/response */}
        {(cleanedPrompt || cleanedResponse) && (
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              Session 预览
            </h3>
            <div className="space-y-3">
              {cleanedPrompt && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <User className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-500">用户</span>
                  </div>
                  <div className="text-sm text-gray-200 bg-slate-900/50 rounded p-2 border border-slate-700/50">
                    {truncateText(cleanedPrompt, 300)}
                  </div>
                </div>
              )}
              {cleanedResponse && (
                <div>
                  <div className="flex items-center gap-1 mb-1">
                    <Bot className="w-3 h-3 text-gray-500" />
                    <span className="text-xs text-gray-500">助手</span>
                  </div>
                  <div className="text-sm text-gray-200 bg-slate-900/50 rounded p-2 border border-slate-700/50">
                    {truncateText(cleanedResponse, 300)}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Quick Preview */}
        {(allTools.length > 0 || allLLMCalls.length > 0) && (
          <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
            <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
              <Layers className="w-4 h-4" />
              执行摘要
            </h3>

            {allLLMCalls.length > 0 && (
              <div className="mb-4">
                <h4 className="text-xs font-medium text-gray-500 mb-2">LLM 调用 ({allLLMCalls.length})</h4>
                <div className="space-y-1">
                  {allLLMCalls.slice(0, 5).map((call, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <MessageSquare className="w-3 h-3 text-cyan-400" />
                      <span className="truncate flex-1" title={call.model}>{call.model}</span>
                      <span className="text-xs text-gray-500">
                        {call.inputTokens.toLocaleString()} → {call.outputTokens.toLocaleString()}
                      </span>
                    </div>
                  ))}
                  {allLLMCalls.length > 5 && (
                    <div className="text-xs text-gray-500 pl-5">
                      +{allLLMCalls.length - 5} more...
                    </div>
                  )}
                </div>
              </div>
            )}

            {allTools.length > 0 && (
              <div>
                <h4 className="text-xs font-medium text-gray-500 mb-2">工具调用 ({allTools.length})</h4>
                <div className="space-y-1">
                  {allTools.slice(0, 5).map((tool, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm">
                      <Wrench className="w-3 h-3 text-violet-400" />
                      <span className="truncate flex-1">{tool.name}</span>
                      <span className="text-xs text-gray-500">{formatDuration(tool.duration)}</span>
                    </div>
                  ))}
                  {allTools.length > 5 && (
                    <div className="text-xs text-gray-500 pl-5">
                      +{allTools.length - 5} more...
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  // Render Timeline Tab
  const renderTimeline = () => {
    const events = [
      { type: 'start', name: '开始', time: trace.startTime, duration: 0 },
      ...allTools.map(t => ({ type: 'tool', name: t.name, time: t.startTime, duration: t.duration })),
      ...allLLMCalls.map(l => ({ type: 'llm', name: l.model, time: l.startTime, duration: l.duration })),
      ...(trace.endTime ? [{ type: 'end', name: trace.status === 'completed' ? '完成' : '结束', time: trace.endTime, duration: 0 }] : []),
    ].sort((a, b) => a.time - b.time);

    const totalDuration = trace.duration || 1;

    return (
      <div className="space-y-4">
        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <div className="relative">
            {/* Timeline bar */}
            <div className="h-8 bg-slate-900 rounded-full overflow-hidden mb-4">
              {events.filter(e => e.type !== 'start' && e.type !== 'end').map((event, idx) => {
                const left = ((event.time - trace.startTime) / totalDuration) * 100;
                const width = Math.max((event.duration / totalDuration) * 100, 0.5);
                return (
                  <div
                    key={idx}
                    className={`absolute top-1 bottom-1 rounded ${
                      event.type === 'tool' ? 'bg-violet-500/60' : 'bg-cyan-500/60'
                    }`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    title={`${event.name} (${formatDuration(event.duration)})`}
                  />
                );
              })}
            </div>

            {/* Event list */}
            <div className="space-y-2">
              {events.map((event, idx) => (
                <div key={idx} className="flex items-center gap-3 text-sm">
                  <div className={`w-2 h-2 rounded-full ${
                    event.type === 'start' ? 'bg-blue-500' :
                    event.type === 'end' ? (trace.status === 'completed' ? 'bg-emerald-500' : 'bg-red-500') :
                    event.type === 'tool' ? 'bg-violet-500' : 'bg-cyan-500'
                  }`} />
                  <span className="text-gray-400 w-20">{formatTime(event.time)}</span>
                  <span className="flex-1">{event.name}</span>
                  {event.duration > 0 && (
                    <span className="text-gray-500">{formatDuration(event.duration)}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // 获取工具缩略描述
  const getToolSummary = (tool: any): string => {
    const input = tool.input || {};
    
    switch (tool.name) {
      case 'Agent':
        return input.description || input.prompt || '';
      case 'Bash':
        return input.command || '';
      case 'Write':
      case 'Edit':
        return input.file_path || input.path || '';
      case 'Read':
        return input.file_path || input.path || '';
      case 'TaskCreate':
        return input.description || input.prompt || '';
      case 'TaskUpdate':
        return input.description || '';
      case 'Grep':
        return `${input.query || ''} in ${input.path || ''}`;
      case 'Glob':
        return input.pattern || '';
      case 'LSP':
        return `${input.operation || ''} ${input.path || ''}`;
      default:
        // 尝试从 input 中提取有用的信息
        const keys = Object.keys(input);
        if (keys.length > 0) {
          const firstKey = keys[0];
          const value = input[firstKey];
          if (typeof value === 'string' && value.length < 50) {
            return `${firstKey}: ${value}`;
          }
        }
        return '';
    }
  };

  // Render Tools Tab
  const renderTools = () => (
    <div className="space-y-2">
      {allTools.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <Wrench className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>无工具调用记录</p>
        </div>
      ) : (
        allTools.map((tool, idx) => {
          const isExpanded = expandedTools.has(idx);
          const summary = getToolSummary(tool);
          const displaySummary = summary.length > 40 ? summary.substring(0, 40) + '...' : summary;
          
          return (
            <div
              key={idx}
              className={`rounded-lg border transition-all ${
                isExpanded ? 'bg-slate-800/50 border-slate-600' : 'bg-slate-800/30 border-slate-700/50'
              }`}
            >
              <button
                onClick={() => toggleTool(idx)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                  tool.status === 'success' ? 'bg-emerald-500/20' :
                  tool.status === 'error' ? 'bg-red-500/20' :
                  'bg-yellow-500/20'
                }`}>
                  <Wrench className={`w-4 h-4 ${
                    tool.status === 'success' ? 'text-emerald-400' :
                    tool.status === 'error' ? 'text-red-400' :
                    'text-yellow-400'
                  }`} />
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
                    <span className={`px-1.5 py-0.5 rounded ${
                      tool.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' :
                      tool.status === 'error' ? 'bg-red-500/20 text-red-300' :
                      'bg-yellow-500/20 text-yellow-300'
                    }`}>
                      {tool.status}
                    </span>
                    <span>·</span>
                    <span>{formatDuration(tool.duration)}</span>
                    <span>·</span>
                    <span>{formatTime(tool.startTime)}</span>
                  </div>
                </div>
                {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-700/50">
                  {/* Input Section */}
                  {tool.input && Object.keys(tool.input).length > 0 && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-green-400 flex items-center gap-1">
                          <Terminal className="w-3 h-3" />
                          输入参数
                        </span>
                        <button
                          onClick={() => copyToClipboard(JSON.stringify(tool.input, null, 2), `tool-input-${idx}`)}
                          className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
                        >
                          {copiedId === `tool-input-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === `tool-input-${idx}` ? '已复制' : '复制'}
                        </button>
                      </div>
                      <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
                        <pre className="p-3 text-xs text-green-400 overflow-auto max-h-60 whitespace-pre-wrap font-mono">
                          {JSON.stringify(tool.input, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}

                  {/* Output Section - 使用统一的分块展示风格 */}
                  {tool.output != null && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-blue-400 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          输出结果
                        </span>
                        <button
                          onClick={() => {
                            const output = tool.output;
                            const text = typeof output === 'string' ? output : JSON.stringify(output, null, 2);
                            copyToClipboard(text, `tool-output-${idx}`);
                          }}
                          className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
                        >
                          {copiedId === `tool-output-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === `tool-output-${idx}` ? '已复制' : '复制'}
                        </button>
                      </div>
                      <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
                        {typeof tool.output === 'string' ? (
                          // 字符串输出 - 尝试解析为代码块，支持长输出截断
                          (() => {
                            // 对于超长输出，先截断
                            const maxOutputLength = 2000;
                            let output = tool.output;
                            let isTruncated = false;
                            if (output.length > maxOutputLength) {
                              output = output.substring(0, maxOutputLength);
                              isTruncated = true;
                            }

                            const parts = formatMessageContent(output);
                            return (
                              <>
                                {parts.map((part, pIdx) => (
                                  <div key={pIdx}>
                                    {part.type === 'code' ? (
                                      <div className="border-t border-b border-slate-800 first:border-t-0 last:border-b-0">
                                        <div className="flex items-center justify-between px-3 py-1 bg-slate-900/50 border-b border-slate-800">
                                          <span className="text-xs text-gray-500">{part.language}</span>
                                        </div>
                                        <pre className="p-3 text-xs text-blue-300 overflow-auto max-h-60 whitespace-pre-wrap font-mono">
                                          {part.content}
                                        </pre>
                                      </div>
                                    ) : (
                                      <div className="p-3 text-sm text-gray-200 whitespace-pre-wrap leading-relaxed">
                                        {part.content}
                                      </div>
                                    )}
                                  </div>
                                ))}
                                {isTruncated && (
                                  <div className="p-2 text-xs text-gray-500 text-center border-t border-slate-800 bg-slate-900/50">
                                    [Output truncated - full content available via copy button]
                                  </div>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          // JSON 输出
                          <pre className="p-3 text-xs text-blue-400 overflow-auto max-h-60 whitespace-pre-wrap font-mono">
                            {JSON.stringify(tool.output, null, 2)}
                          </pre>
                        )}
                      </div>
                    </div>
                  )}

                  {tool.error && (
                    <div className="mt-4">
                      <div className="flex items-center gap-1 mb-2">
                        <AlertCircle className="w-3 h-3 text-red-500" />
                        <span className="text-xs font-medium text-red-400">错误信息</span>
                      </div>
                      <div className="bg-red-950/30 border border-red-900/30 rounded p-3">
                        <pre className="text-xs text-red-400 overflow-auto whitespace-pre-wrap">
                          {tool.error}
                        </pre>
                      </div>
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

  // Format message content for display
  const formatMessageContent = (content: string): Array<{type: 'text' | 'code', content: string, language?: string}> => {
    const parts: Array<{type: 'text' | 'code', content: string, language?: string}> = [];
    const codeBlockRegex = /```(\w+)?\n([\s\S]*?)```/g;
    let lastIndex = 0;
    let match;

    while ((match = codeBlockRegex.exec(content)) !== null) {
      // Add text before code block
      if (match.index > lastIndex) {
        parts.push({
          type: 'text',
          content: content.slice(lastIndex, match.index).trim()
        });
      }
      // Add code block
      parts.push({
        type: 'code',
        language: match[1] || 'text',
        content: match[2].trim()
      });
      lastIndex = match.index + match[0].length;
    }

    // Add remaining text
    if (lastIndex < content.length) {
      const remaining = content.slice(lastIndex).trim();
      if (remaining) {
        parts.push({
          type: 'text',
          content: remaining
        });
      }
    }

    return parts.length > 0 ? parts : [{ type: 'text', content: content.trim() }];
  };

  // Render LLM Tab
  const renderLLM = () => (
    <div className="space-y-4">
      {allLLMCalls.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>无 LLM 调用记录</p>
        </div>
      ) : (
        groupedLLMCalls.map((group, groupIdx) => {
          const isGroupExpanded = expandedLLMs.has(groupIdx);
          // Clean command tags from prompt for preview
          const cleanedPrompt = cleanCommandText(group.prompt || '');
          const promptPreview = cleanedPrompt
            ? cleanedPrompt.replace(/\n/g, ' ').substring(0, 80) + (cleanedPrompt.length > 80 ? '...' : '')
            : '无提示词';
          
          return (
            <div
              key={groupIdx}
              className={`rounded-lg border transition-all ${
                isGroupExpanded ? 'bg-slate-800/50 border-slate-600' : 'bg-slate-800/30 border-slate-700/50'
              }`}
            >
              {/* Group Header */}
              <button
                onClick={() => toggleLLM(groupIdx)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <span className="text-xs text-cyan-400 font-mono">{groupIdx + 1}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-gray-200 truncate" title={group.prompt}>
                    {promptPreview}
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-2">
                    <span>{group.calls.length} 次调用</span>
                    <span>·</span>
                    <span>{group.calls.reduce((sum, c) => sum + c.inputTokens, 0).toLocaleString()} → {group.calls.reduce((sum, c) => sum + c.outputTokens, 0).toLocaleString()} tokens</span>
                  </div>
                </div>
                {isGroupExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>

              {/* Group Content */}
              {isGroupExpanded && (
                <div className="border-t border-slate-700/50">
                  {/* Show Prompt Once */}
                  {group.prompt && (
                    <div className="px-4 py-3 bg-slate-900/30 border-b border-slate-700/50">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-cyan-400 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          用户提示词
                        </span>
                        <button
                          onClick={() => copyToClipboard(group.prompt, `group-prompt-${groupIdx}`)}
                          className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
                        >
                          {copiedId === `group-prompt-${groupIdx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === `group-prompt-${groupIdx}` ? '已复制' : '复制'}
                        </button>
                      </div>
                      <div className="text-sm text-gray-300 whitespace-pre-wrap leading-relaxed max-h-32 overflow-auto">
                        {cleanedPrompt}
                      </div>
                    </div>
                  )}

                  {/* Individual LLM Calls */}
                  <div className="space-y-2 p-4">
                    {group.calls.map((call, callIdx) => {
                      const callKey = `${groupIdx}-${callIdx}`;
                      const isCallExpanded = expandedLLMs.has(callKey as unknown as number);
                      const relatedTools = getRelatedToolCalls(call);
                      
                      return (
                        <div
                          key={callKey}
                          className={`rounded border ${isCallExpanded ? 'bg-slate-800/70 border-slate-600' : 'bg-slate-800/40 border-slate-700/50'}`}
                        >
                          <button
                            onClick={() => toggleLLM(callKey as unknown as number)}
                            className="w-full px-3 py-2 flex items-center gap-2 text-left"
                          >
                            <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center">
                              <span className="text-xs text-blue-400 font-mono">{callIdx + 1}</span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm text-gray-300 truncate">
                                {call.response
                                  ? cleanCommandText(call.response).replace(/\n/g, ' ').substring(0, 50) + (cleanCommandText(call.response).length > 50 ? '...' : '')
                                  : '无响应内容'}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5 flex items-center gap-2">
                                <span>{call.model}</span>
                                <span>·</span>
                                <span>{call.inputTokens.toLocaleString()} → {call.outputTokens.toLocaleString()} tokens</span>
                                {relatedTools.length > 0 && (
                                  <>
                                    <span>·</span>
                                    <span className="text-violet-400">{relatedTools.length} 个工具调用</span>
                                  </>
                                )}
                              </div>
                            </div>
                            {isCallExpanded ? <ChevronDown className="w-3 h-3 text-gray-400" /> : <ChevronRight className="w-3 h-3 text-gray-400" />}
                          </button>

                          {isCallExpanded && (
                            <div className="px-3 pb-3 border-t border-slate-700/50 space-y-3">
                              {/* Response */}
                              {call.response && (
                                <div>
                                  <div className="flex items-center justify-between mb-1">
                                    <span className="text-xs font-medium text-blue-400">响应内容</span>
                                    <button
                                      onClick={() => copyToClipboard(call.response || '', `call-response-${callKey}`)}
                                      className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
                                    >
                                      {copiedId === `call-response-${callKey}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                                      {copiedId === `call-response-${callKey}` ? '已复制' : '复制'}
                                    </button>
                                  </div>
                                  <div className="bg-slate-950 rounded border border-slate-800 p-2 text-sm text-gray-200 whitespace-pre-wrap max-h-40 overflow-auto">
                                    {cleanCommandText(call.response)}
                                  </div>
                                </div>
                              )}

                              {/* Related Tool Calls */}
                              {relatedTools.length > 0 && (
                                <div>
                                  <div className="text-xs font-medium text-violet-400 mb-2 flex items-center gap-1">
                                    <Wrench className="w-3 h-3" />
                                    相关工具调用 ({relatedTools.length})
                                  </div>
                                  <div className="space-y-1">
                                    {relatedTools.map((tool, toolIdx) => (
                                      <div key={toolIdx} className="bg-slate-900/50 rounded border border-slate-700/50 p-2">
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className="text-violet-400 font-medium">{tool.name}</span>
                                          <span className="text-gray-500">{formatTime(tool.startTime || 0)}</span>
                                        </div>
                                        {tool.input && Object.keys(tool.input).length > 0 && (
                                          <div className="mt-1 text-xs text-gray-400 font-mono truncate">
                                            {JSON.stringify(tool.input).substring(0, 100)}
                                          </div>
                                        )}
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

  // Render Raw Tab
  const renderRaw = () => (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-400">原始 JSON 数据</span>
        <button
          onClick={() => copyToClipboard(JSON.stringify(trace.raw || trace, null, 2), 'raw-all')}
          className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
        >
          {copiedId === 'raw-all' ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          {copiedId === 'raw-all' ? '已复制' : '复制全部'}
        </button>
      </div>
      <pre className="bg-slate-950 p-4 rounded text-xs text-gray-400 overflow-auto max-h-[600px]">
        {JSON.stringify(trace.raw || trace, null, 2)}
      </pre>
    </div>
  );

  return (
    <div className="bg-slate-800 rounded-lg overflow-hidden border border-slate-700">
      {/* Header */}
      <div className="px-4 py-3 bg-slate-750 border-b border-slate-700 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">{trace.agentName}</h3>
          <div className="text-sm text-gray-400 flex items-center gap-2 mt-0.5">
            <span className={`inline-block w-2 h-2 rounded-full ${
              trace.status === 'completed' ? 'bg-emerald-500' :
              trace.status === 'failed' ? 'bg-red-500' :
              'bg-yellow-500'
            }`} />
            {trace.status === 'completed' ? '已完成' :
             trace.status === 'failed' ? '失败' :
             trace.status === 'running' ? '运行中' : '已取消'}
            <span className="text-gray-600">|</span>
            <span>{trace.platform}</span>
            <span className="text-gray-600">|</span>
            <span>{formatTime(trace.startTime)}</span>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-700 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as TabType)}
            className={`px-4 py-2.5 text-sm font-medium flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            <tab.icon className="w-4 h-4" />
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
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

export default EnhancedTraceDetail;
