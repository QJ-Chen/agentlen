import { useState, useMemo } from 'react';
import {
  LayoutDashboard,
  Activity,
  DollarSign,
  Settings,
  Menu,
  X,
} from 'lucide-react';
import { Trace, AgentStats, CostMetrics } from './types';
import { TraceList } from './components/TraceList';
import { TraceTimeline } from './components/TraceTimeline';
import { CostPanel } from './components/CostPanel';
import { AgentSelector } from './components/AgentSelector';
import './index.css';

// Mock Data
const mockAgents: AgentStats[] = [
  {
    agentId: 'agent-1',
    agentName: 'Code Reviewer',
    platform: 'openclaw',
    totalExecutions: 156,
    successRate: 0.94,
    avgDuration: 45000,
    totalTokens: 2450000,
    totalCost: 12.5,
    lastActive: Date.now() - 3600000,
  },
  {
    agentId: 'agent-2',
    agentName: 'Documentation Writer',
    platform: 'claude-code',
    totalExecutions: 89,
    successRate: 0.88,
    avgDuration: 120000,
    totalTokens: 1890000,
    totalCost: 18.9,
    lastActive: Date.now() - 7200000,
  },
  {
    agentId: 'agent-3',
    agentName: 'Test Generator',
    platform: 'kimi-code',
    totalExecutions: 234,
    successRate: 0.96,
    avgDuration: 32000,
    totalTokens: 3200000,
    totalCost: 15.8,
    lastActive: Date.now() - 1800000,
  },
  {
    agentId: 'agent-4',
    agentName: 'Refactoring Assistant',
    platform: 'cursor',
    totalExecutions: 67,
    successRate: 0.82,
    avgDuration: 180000,
    totalTokens: 980000,
    totalCost: 9.2,
    lastActive: Date.now() - 14400000,
  },
];

const generateMockTraces = (): Trace[] => {
  const traces: Trace[] = [];
  const platforms: Array<'openclaw' | 'claude-code' | 'kimi-code' | 'cursor'> = [
    'openclaw',
    'claude-code',
    'kimi-code',
    'cursor',
  ];
  const statuses: Array<'running' | 'completed' | 'failed' | 'cancelled'> = [
    'completed',
    'completed',
    'completed',
    'failed',
    'running',
  ];

  for (let i = 0; i < 20; i++) {
    const agent = mockAgents[i % mockAgents.length];
    const status = statuses[i % statuses.length];
    const startTime = Date.now() - Math.random() * 86400000 * 7;
    const duration = Math.random() * 120000 + 10000;
    const toolCount = Math.floor(Math.random() * 8) + 2;
    const llmCount = Math.floor(Math.random() * 5) + 1;

    const tools = Array.from({ length: toolCount }, (_, j) => ({
      id: `tool-${i}-${j}`,
      name: ['read_file', 'write_file', 'exec', 'web_search', 'image_generate'][
        Math.floor(Math.random() * 5)
      ],
      startTime: startTime + j * 5000,
      endTime: startTime + j * 5000 + Math.random() * 3000,
      duration: Math.random() * 3000,
      status: Math.random() > 0.1 ? 'success' : 'error',
      input: { path: '/tmp/test.txt' },
      output: { result: 'success' },
    }));

    const llmCalls = Array.from({ length: llmCount }, (_, j) => {
      const inputTokens = Math.floor(Math.random() * 2000) + 500;
      const outputTokens = Math.floor(Math.random() * 1000) + 200;
      return {
        id: `llm-${i}-${j}`,
        model: ['gpt-4', 'claude-3', 'kimi-k2', 'cursor-small'][
          Math.floor(Math.random() * 4)
        ],
        startTime: startTime + j * 8000,
        endTime: startTime + j * 8000 + Math.random() * 5000,
        duration: Math.random() * 5000,
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
        cost: (inputTokens + outputTokens) * 0.00001,
        status: 'success' as const,
      };
    });

    const totalTokens = llmCalls.reduce((sum, llm) => sum + llm.totalTokens, 0);
    const totalCost = llmCalls.reduce((sum, llm) => sum + llm.cost, 0);

    traces.push({
      id: `trace-${i}`,
      agentId: agent.agentId,
      agentName: agent.agentName,
      platform: agent.platform as any,
      status,
      startTime,
      endTime: status !== 'running' ? startTime + duration : undefined,
      duration: status !== 'running' ? duration : undefined,
      tools,
      llmCalls,
      totalTokens,
      cost: totalCost,
    });
  }

  return traces.sort((a, b) => b.startTime - a.startTime);
};

const mockTraces = generateMockTraces();

const mockCostMetrics: CostMetrics[] = Array.from({ length: 7 }, (_, i) => {
  const date = new Date();
  date.setDate(date.getDate() - (6 - i));
  return {
    date: date.toISOString().split('T')[0],
    cost: Math.random() * 5 + 2,
    tokens: Math.floor(Math.random() * 50000) + 20000,
    requests: Math.floor(Math.random() * 50) + 20,
  };
});

function App() {
  const [selectedTraceId, setSelectedTraceId] = useState<string | undefined>();
  const [selectedAgentId, setSelectedAgentId] = useState<string | undefined>();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const filteredTraces = useMemo(() => {
    if (!selectedAgentId) return mockTraces;
    return mockTraces.filter((t) => t.agentId === selectedAgentId);
  }, [selectedAgentId]);

  const selectedTrace = useMemo(
    () => mockTraces.find((t) => t.id === selectedTraceId),
    [selectedTraceId]
  );

  const totalStats = useMemo(() => {
    const filtered = selectedAgentId
      ? mockTraces.filter((t) => t.agentId === selectedAgentId)
      : mockTraces;
    return {
      cost: filtered.reduce((sum, t) => sum + t.cost, 0),
      tokens: filtered.reduce((sum, t) => sum + t.totalTokens, 0),
      requests: filtered.length,
    };
  }, [selectedAgentId]);

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Header */}
      <header className="bg-slate-800 border-b border-slate-700 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-500 flex items-center justify-center">
                <LayoutDashboard className="w-5 h-5 text-white" />
              </div>
              <h1 className="text-xl font-bold text-gradient">AgentLens</h1>
            </div>
            <button
              onClick={() => setSidebarOpen(!sidebarOpen)}
              className="lg:hidden p-2 rounded-lg hover:bg-slate-700 transition-colors"
            >
              {sidebarOpen ? (
                <X className="w-5 h-5" />
              ) : (
                <Menu className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Sidebar - Agent Selector */}
          <div
            className={`
              lg:col-span-3
              ${sidebarOpen ? 'block' : 'hidden lg:block'}
            `}
          >
            <AgentSelector
              agents={mockAgents}
              selectedAgentId={selectedAgentId}
              onSelectAgent={setSelectedAgentId}
            />
          </div>

          {/* Middle - Trace List */}
          <div className="lg:col-span-4">
            <TraceList
              traces={filteredTraces}
              selectedTraceId={selectedTraceId}
              onSelectTrace={(trace) => setSelectedTraceId(trace.id)}
            />
          </div>

          {/* Right - Trace Timeline or Cost Panel */}
          <div className="lg:col-span-5">
            {selectedTrace ? (
              <TraceTimeline trace={selectedTrace} />
            ) : (
              <CostPanel
                metrics={mockCostMetrics}
                totalCost={totalStats.cost}
                totalTokens={totalStats.tokens}
                totalRequests={totalStats.requests}
              />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
