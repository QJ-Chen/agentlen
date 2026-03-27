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
} from 'lucide-react';
import type { Trace } from '../types';

interface EnhancedTraceDetailProps {
  trace: Trace & { raw?: any };
}

type TabType = 'overview' | 'timeline' | 'tools' | 'llm' | 'raw';

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
    { id: 'llm', label: `LLM (${allLLMCalls.length})`, icon: MessageSquare },
    { id: 'raw', label: '原始', icon: Code },
  ];

  // Render Overview Tab
  const renderOverview = () => (
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
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs ${
              trace.platform === 'openclaw' ? 'bg-blue-500/20 text-blue-300' :
              trace.platform === 'claude-code' ? 'bg-orange-500/20 text-orange-300' :
              trace.platform === 'kimi-code' ? 'bg-violet-500/20 text-violet-300' :
              'bg-gray-500/20 text-gray-300'
            }`}>
              {trace.platform}
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

      {/* Quick Preview */}
      {(allTools.length > 0 || allLLMCalls.length > 0) && (
        <div className="bg-slate-800/30 rounded-lg p-4 border border-slate-700/50">
          <h3 className="text-sm font-semibold text-gray-400 mb-3 flex items-center gap-2">
            <Layers className="w-4 h-4" />
            执行摘要
          </h3>
          
          {allTools.length > 0 && (
            <div className="mb-4">
              <h4 className="text-xs font-medium text-gray-500 mb-2">工具调用</h4>
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
          
          {allLLMCalls.length > 0 && (
            <div>
              <h4 className="text-xs font-medium text-gray-500 mb-2">LLM 调用</h4>
              <div className="space-y-1">
                {allLLMCalls.map((call, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm">
                    <MessageSquare className="w-3 h-3 text-cyan-400" />
                    <span className="truncate flex-1">{call.model}</span>
                    <span className="text-xs text-gray-500">
                      {call.inputTokens.toLocaleString()} → {call.outputTokens.toLocaleString()} tokens
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

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
                    <span className="font-medium truncate">{tool.name}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${
                      tool.status === 'success' ? 'bg-emerald-500/20 text-emerald-300' :
                      tool.status === 'error' ? 'bg-red-500/20 text-red-300' :
                      'bg-yellow-500/20 text-yellow-300'
                    }`}>
                      {tool.status}
                    </span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {formatDuration(tool.duration)} · {formatTime(tool.startTime)}
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
                          // 字符串输出 - 尝试解析为代码块
                          (() => {
                            const parts = formatMessageContent(tool.output);
                            return parts.map((part, pIdx) => (
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
                            ));
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
    <div className="space-y-2">
      {allLLMCalls.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p>无 LLM 调用记录</p>
        </div>
      ) : (
        allLLMCalls.map((call, idx) => {
          const isExpanded = expandedLLMs.has(idx);
          const promptParts = call.prompt ? formatMessageContent(call.prompt) : [];
          const responseParts = call.response ? formatMessageContent(call.response) : [];
          
          return (
            <div
              key={idx}
              className={`rounded-lg border transition-all ${
                isExpanded ? 'bg-slate-800/50 border-slate-600' : 'bg-slate-800/30 border-slate-700/50'
              }`}
            >
              <button
                onClick={() => toggleLLM(idx)}
                className="w-full px-4 py-3 flex items-center gap-3 text-left"
              >
                <div className="w-8 h-8 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <MessageSquare className="w-4 h-4 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium truncate">{call.model}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {formatDuration(call.duration)} · {call.inputTokens.toLocaleString()} → {call.outputTokens.toLocaleString()} tokens · ${call.cost.toFixed(4)}
                  </div>
                </div>
                {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
              </button>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-700/50">
                  {/* Prompt Section */}
                  {call.prompt && (
                    <div className="mt-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-cyan-400 flex items-center gap-1">
                          <MessageSquare className="w-3 h-3" />
                          提示词 (Prompt)
                        </span>
                        <button
                          onClick={() => copyToClipboard(call.prompt || '', `llm-prompt-${idx}`)}
                          className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
                        >
                          {copiedId === `llm-prompt-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === `llm-prompt-${idx}` ? '已复制' : '复制'}
                        </button>
                      </div>
                      <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
                        {promptParts.map((part, pIdx) => (
                          <div key={pIdx}>
                            {part.type === 'code' ? (
                              <div className="border-t border-b border-slate-800 first:border-t-0 last:border-b-0">
                                <div className="flex items-center justify-between px-3 py-1 bg-slate-900/50 border-b border-slate-800">
                                  <span className="text-xs text-gray-500">{part.language}</span>
                                </div>
                                <pre className="p-3 text-xs text-green-400 overflow-auto max-h-60 whitespace-pre-wrap font-mono">
                                  {part.content}
                                </pre>
                              </div>
                            ) : (
                              <div className="p-3 text-sm text-gray-300 whitespace-pre-wrap leading-relaxed">
                                {part.content}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Response Section */}
                  {call.response && (
                    <div className="mt-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs font-medium text-blue-400 flex items-center gap-1">
                          <FileText className="w-3 h-3" />
                          响应 (Response)
                        </span>
                        <button
                          onClick={() => copyToClipboard(call.response || '', `llm-response-${idx}`)}
                          className="text-xs text-gray-500 hover:text-white flex items-center gap-1"
                        >
                          {copiedId === `llm-response-${idx}` ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                          {copiedId === `llm-response-${idx}` ? '已复制' : '复制'}
                        </button>
                      </div>
                      <div className="bg-slate-950 rounded border border-slate-800 overflow-hidden">
                        {responseParts.map((part, pIdx) => (
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
                      </div>
                    </div>
                  )}

                  {!call.prompt && !call.response && (
                    <div className="mt-3 text-center py-4 text-gray-500 text-sm">
                      无详细对话记录
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
