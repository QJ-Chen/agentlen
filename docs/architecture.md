# AgentLens 架构设计

## 系统概述

AgentLens 是一个轻量级 Agent 执行观测平台，支持监控 Claude Code、Kimi Code、OpenClaw 等 Agent 的执行过程。

## 核心设计原则

- **轻量级**: 默认 SQLite，零配置启动
- **多平台**: 统一适配不同 Agent 框架
- **低开销**: 异步写入，不阻塞 Agent
- **成本敏感**: Token 消耗实时监控

## 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                        AgentLens                             │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────────────┐    ┌─────────────┐    ┌─────────────┐  │
│  │  Session Scanner│    │  Collector  │    │   Storage   │  │
│  │                 │───→│             │───→│             │  │
│  │ - Claude Code   │    │ - Batch     │    │ - SQLite    │  │
│  │ - Kimi Code     │    │ - Async     │    │ - PostgreSQL│  │
│  │ - OpenClaw      │    │             │    │             │  │
│  └─────────────────┘    └─────────────┘    └─────────────┘  │
│           │                    │                  │          │
│           └────────────────────┴──────────────────┘          │
│                            │                                 │
│                            ↓                                 │
│                   ┌─────────────────┐                        │
│                   │    API Server   │                        │
│                   │    (FastAPI)    │                        │
│                   └────────┬────────┘                        │
│                            │                                 │
│                            ↓                                 │
│                   ┌─────────────────┐                        │
│                   │    Dashboard    │                        │
│                   │    (React)      │                        │
│                   └─────────────────┘                        │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. Session Scanner

扫描历史 Agent 执行记录，支持多平台:

- **Claude Code**: `~/.claude/projects/*.jsonl`
- **Kimi Code**: `~/.kimi/sessions/*/wire.jsonl`
- **OpenClaw**: `~/.openclaw/subagents/runs.json`

### 2. Collector

数据收集 SDK，支持手动埋点:

```python
from workflow_tracer import trace_session

with trace_session("agent-name", "platform") as tracer:
    tracer.trace_tool(...)
    tracer.trace_llm(...)
```

### 3. Storage

数据存储层，支持多种后端:

- **SQLiteStorage**: 本地文件，默认选项
- **PostgreSQLStorage**: 生产环境
- **JSONLStorage**: 追加写入，易于分析

### 4. API Server

FastAPI 提供 REST 接口:

- `POST /api/v1/traces` - 写入 trace
- `GET /api/v1/traces` - 查询 traces
- `GET /api/v1/stats` - 获取统计

### 5. Dashboard

React 前端展示:

- Trace 列表
- 工具调用链
- LLM 对话详情
- 成本统计

## 数据模型

### Trace

```python
@dataclass
class Trace:
    trace_id: str              # 唯一标识
    platform: str              # 平台类型
    agent_name: str            # Agent 名称
    session_id: str            # Session ID
    
    start_time: datetime       # 开始时间
    end_time: datetime         # 结束时间
    duration_ms: int           # 执行时长
    
    model: str                 # 模型名称
    prompt: str                # 输入提示
    response: str              # 输出响应
    input_tokens: int          # 输入 Token
    output_tokens: int         # 输出 Token
    cost_usd: float            # 成本
    
    tool_calls: List[Dict]     # 工具调用
    status: str                # 状态
    error_message: str         # 错误信息
```

### ToolCall

```python
@dataclass
class ToolCall:
    name: str                  # 工具名称
    input: Dict                # 输入参数
    output: Any                # 输出结果
    tool_use_id: str           # 调用 ID
    timestamp: float           # 时间戳
    duration_ms: int = 0       # 执行时长
```

## 多平台适配

### Claude Code

解析 JSONL 文件，提取:
- 用户输入 (user)
- 助手响应 (assistant)
- 工具调用 (tool_use/tool_result)
- Token 使用 (usage)

### Kimi Code

解析 wire.jsonl (NDJSON)，提取:
- TurnBegin (用户输入)
- ToolCall / ToolResult
- ContentPart (LLM 响应)
- StatusUpdate (Token 使用)

### OpenClaw

解析 runs.json，提取:
- Subagent 执行记录
- 任务和结果
- 状态和时长

## 存储方案

### SQLite (默认)

```python
# 配置
DB_PATH = ~/.agentlens/agentlens.db

# 特点
- 零配置
- 单文件
- 适合个人/小团队
```

### PostgreSQL (生产)

```python
# 配置
DATABASE_URL = postgresql://user:pass@host/db

# 特点
- 高并发
- 复杂查询
- 适合团队
```

## API 设计

### 写入 Trace

```http
POST /api/v1/traces
Content-Type: application/json

{
    "trace_id": "uuid",
    "platform": "claude-code",
    "agent_name": "my-agent",
    "model": "claude-3-5-sonnet",
    "prompt": "Hello",
    "response": "Hi!",
    "input_tokens": 10,
    "output_tokens": 5,
    "cost_usd": 0.0002,
    "tool_calls": [],
    "status": "success"
}
```

### 查询 Traces

```http
GET /api/v1/traces?platform=claude-code&limit=50

Response:
{
    "traces": [...],
    "total": 100
}
```

### 获取统计

```http
GET /api/v1/stats?period_hours=24

Response:
{
    "total_traces": 100,
    "total_tokens": 50000,
    "total_cost": 0.5,
    "platforms": [...],
    "models": [...]
}
```

## Dashboard 功能

### Trace 列表

- 平台筛选
- 时间排序
- 搜索过滤

### Trace 详情

- 概览: 基本信息、Token、成本
- 工具: 调用链、参数、结果
- LLM: 完整提示词和响应
- 原始: JSON 数据

### 统计面板

- 平台分布
- 模型使用
- 成本趋势
- Token 消耗

## 性能优化

### 数据收集

- 异步写入
- 批量上报
- 本地队列缓冲

### 存储优化

- 索引: trace_id, session_id, timestamp
- 分页查询
- 数据压缩

### 前端优化

- 虚拟列表
- 自动刷新 (3s 间隔)
- 懒加载详情

## 路线图

### v0.1.0 (当前)
- ✅ Session Scanner (Claude, Kimi, OpenClaw)
- ✅ SQLite + FastAPI
- ✅ React Dashboard
- ✅ 成本统计

### v0.2.0 (计划)
- 🔄 WebSocket 实时推送
- 🔄 更多平台适配 (Cursor, Copilot)
- 🔄 告警系统

### v0.3.0 (计划)
- 📋 PostgreSQL 支持
- 📋 高级查询
- 📋 数据导出

## License

MIT
