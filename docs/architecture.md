# AgentLens 架构设计文档

## 1. 系统概述

AgentLens 是一个轻量级 Agent 执行观测平台，支持监控 OpenClaw、Claude Code、Kimi Code 等真实 Agent 的执行过程。

## 2. 核心设计原则

- **轻量级**：适合中小团队，资源占用低
- **多平台**：统一适配不同 Agent 框架
- **低开销**：最小化对 Agent 性能的影响
- **成本敏感**：Token 消耗优化

## 3. 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        AgentLens                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │   SDKs      │    │  Collector  │    │   Storage   │     │
│  │             │───→│             │───→│             │     │
│  │ - OpenClaw  │    │ - Intercept │    │ - SQLite    │     │
│  │ - Claude    │    │ - Batch     │    │ - PostgreSQL│     │
│  │ - Kimi      │    │ - Async     │    │ - File      │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
│         │                  │                  │              │
│         └──────────────────┴──────────────────┘              │
│                            │                                 │
│                            ↓                                 │
│                   ┌─────────────────┐                        │
│                   │    API Server   │                        │
│                   │   (FastAPI)     │                        │
│                   └────────┬────────┘                        │
│                            │                                 │
│                            ↓                                 │
│                   ┌─────────────────┐                        │
│                   │   Dashboard     │                        │
│                   │   (React)       │                        │
│                   └─────────────────┘                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 4. 数据模型

### 4.1 Trace（执行追踪）

```python
class Trace:
    trace_id: str          # 唯一标识
    platform: str          # 平台类型 (openclaw, claude, kimi)
    agent_name: str        # Agent 名称
    session_id: str        # 会话标识
    
    # 时间
    start_time: datetime
    end_time: datetime
    duration_ms: int
    
    # LLM 调用
    model: str             # 模型名称
    prompt: str            # 输入提示
    response: str          # 输出响应
    input_tokens: int
    output_tokens: int
    cost_usd: float
    
    # 工具调用
    tool_calls: List[ToolCall]
    
    # 元数据
    status: str            # success, error, cancelled
    error_message: str
    metadata: dict         # 平台特定数据
```

### 4.2 ToolCall（工具调用）

```python
class ToolCall:
    call_id: str
    tool_name: str
    input_args: dict
    output_result: any
    duration_ms: int
    status: str
```

### 4.3 Session（会话）

```python
class Session:
    session_id: str
    platform: str
    start_time: datetime
    end_time: datetime
    total_traces: int
    total_tokens: int
    total_cost: float
```

## 5. 多平台适配

### 5.1 OpenClaw 适配

```python
# 通过拦截 tool calls 和 LLM 请求
class OpenClawAdapter:
    def intercept_tool_call(self, tool_name, args):
        trace = self.start_trace("tool_call", tool_name)
        result = self.original_call(tool_name, args)
        self.end_trace(trace, result)
        return result
    
    def intercept_llm_call(self, model, prompt):
        trace = self.start_trace("llm_call", model)
        response = self.original_llm_call(model, prompt)
        self.end_trace(trace, response)
        return response
```

### 5.2 Claude Code 适配

```python
# 通过 srt (system runtime) 拦截
class ClaudeCodeAdapter:
    def hook_into_srt(self):
        # 拦截 srt 的工具调用
        # 记录到 AgentLens
        pass
```

### 5.3 Kimi Code 适配

```python
# 通过 MCP 协议拦截
class KimiCodeAdapter:
    def intercept_mcp_call(self, server, tool, args):
        trace = self.start_trace("mcp", f"{server}.{tool}")
        result = self.original_mcp_call(server, tool, args)
        self.end_trace(trace, result)
        return result
```

## 6. 存储方案

### 6.1 轻量级（默认）
- **SQLite**: 本地文件，零配置
- **JSONL**: 追加写入，易于分析

### 6.2 生产级
- **PostgreSQL**: 关系型，支持复杂查询
- **ClickHouse**: 时序数据，高性能分析

### 6.3 数据保留策略
```python
# 自动清理旧数据
retention_days = 30
max_storage_mb = 1000
```

## 7. API 设计

### 7.1 Trace API

```python
# 写入 Trace
POST /api/v1/traces
{
    "platform": "openclaw",
    "agent_name": "main",
    "model": "claude-3-5-sonnet",
    "prompt": "...",
    "response": "...",
    "tool_calls": [...]
}

# 查询 Traces
GET /api/v1/traces?platform=openclaw&start_time=...&end_time=...

# 获取统计
GET /api/v1/stats?period=24h
{
    "total_traces": 1000,
    "total_tokens": 500000,
    "total_cost": 1.25,
    "avg_latency_ms": 2500
}
```

### 7.2 Session API

```python
# 创建 Session
POST /api/v1/sessions

# 结束 Session
PUT /api/v1/sessions/{id}/end

# 获取 Session 详情
GET /api/v1/sessions/{id}
```

## 8. Dashboard 功能

### 8.1 实时视图
- 当前执行列表
- 实时成本统计
- Agent 状态监控

### 8.2 Trace 分析
- 时序图（类似 Chrome DevTools）
- 工具调用链
- 延迟分析

### 8.3 成本优化
- Token 消耗趋势
- 成本分解（按平台/模型/Agent）
- 优化建议

## 9. 性能优化

### 9.1 数据收集
- 异步写入（不阻塞 Agent）
- 批量上报（减少网络开销）
- 本地队列（网络故障时缓冲）

### 9.2 存储优化
- 数据压缩（Snappy/Zstd）
- 自动分区（按时间）
- 索引优化（trace_id, session_id, timestamp）

## 10. 安全考虑

- 敏感数据脱敏（API keys, tokens）
- 本地优先（数据不出境）
- 可选加密存储

## 11. 部署方案

### 11.1 本地开发
```bash
pip install agentlens
agentlens server --local
```

### 11.2 团队共享
```bash
docker run -p 8080:8080 agentlens/server
```

### 11.3 云托管
- 支持 BYOC（Bring Your Own Cloud）
- AWS/GCP/Azure 一键部署

## 12. 路线图

### Phase 1 (Week 1)
- [x] 基础架构设计
- [ ] OpenClaw SDK
- [ ] SQLite 存储
- [ ] 基础 Dashboard

### Phase 2 (Week 2)
- [ ] Claude Code 适配
- [ ] Kimi Code 适配
- [ ] Trace 可视化
- [ ] 成本分析

### Phase 3 (Week 3)
- [ ] PostgreSQL 支持
- [ ] 高级查询
- [ ] 告警系统
- [ ] 性能优化

### Phase 4 (Week 4)
- [ ] 文档完善
- [ ] 测试覆盖
- [ ] 发布准备
