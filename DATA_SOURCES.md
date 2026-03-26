# AgentLens 数据来源说明

## 数据流向

```
┌─────────────────────────────────────────────────────────────┐
│                      数据来源层                              │
├─────────────────────────────────────────────────────────────┤
│  1. Project Watcher        2. Session Scanner               │
│     (project_watcher.py)      (session_scanner.py)          │
│     - 文件系统监控            - OpenClaw runs.json          │
│     - 文件创建/修改事件       - Kimi sessions               │
│     - Token 估算              - Claude Code sessions        │
├─────────────────────────────────────────────────────────────┤
│  3. Workflow Tracer          4. Manual API Calls            │
│     (workflow_tracer.py)      (curl / python)               │
│     - 工具调用追踪            - 手动提交 trace              │
│     - LLM 调用追踪                                          │
│     - 完整输入输出                                          │
├─────────────────────────────────────────────────────────────┤
│                      数据存储层                              │
├─────────────────────────────────────────────────────────────┤
│  SQLite Database: ~/.agentlens/agentlens.db                 │
│  - traces 表: 所有 trace 数据                               │
│  - sessions 表: session 聚合信息                            │
├─────────────────────────────────────────────────────────────┤
│                      API 服务层                              │
├─────────────────────────────────────────────────────────────┤
│  FastAPI Server: http://localhost:8080                      │
│  - POST /api/v1/traces       - 接收 trace 数据              │
│  - GET  /api/v1/traces       - 查询 trace 列表              │
│  - GET  /api/v1/stats        - 获取统计数据                 │
├─────────────────────────────────────────────────────────────┤
│                      展示层                                  │
├─────────────────────────────────────────────────────────────┤
│  Dashboard: http://localhost:5177                           │
│  - Trace 列表                                               │
│  - 详细调用链 (工具参数、LLM 提示词)                        │
│  - 统计分析                                                 │
└─────────────────────────────────────────────────────────────┘
```

## 当前数据来源

### 1. Project Watcher (agentlens-dev)

**来源文件**: `project_watcher.py`

**监控内容**:
- 文件创建事件 (`file_created`)
- 文件修改事件 (`file_modified`)
- Token 数估算 (基于文件大小)

**数据字段**:
```json
{
  "platform": "agentlens-dev",
  "agent_name": "agentlens-dev",
  "model": "file_modified",
  "prompt": "File: dashboard/src/App.tsx",
  "tool_calls": [],
  "response": ""
}
```

**用途**: 监控项目文件变化，了解开发活动

---

### 2. Session Scanner (openclaw / kimi-code)

**来源文件**: `session_scanner.py`

**扫描位置**:
- `~/.openclaw/subagents/runs.json` - OpenClaw subagent 执行记录
- `~/.kimi/` - Kimi Code sessions
- `~/.codex/sessions/` - Claude Code sessions (待配置)

**数据字段** (OpenClaw):
```json
{
  "platform": "openclaw",
  "agent_name": "openclaw-agent",
  "model": "moonshot/kimi-k2.5",
  "prompt": "[任务描述]",
  "response": "[执行结果]",
  "duration_ms": 300000,
  "status": "success|timeout|error",
  "tool_calls": [...]
}
```

**用途**: 分析历史 Agent 执行情况

---

### 3. Workflow Tracer (深度追踪)

**来源文件**: `workflow_tracer.py`

**追踪内容**:
- 工具调用 (名称、输入参数、输出结果、耗时)
- LLM 调用 (模型、提示词、响应、Token、成本)
- 完整调用链

**数据字段**:
```json
{
  "platform": "openclaw",
  "agent_name": "my-agent",
  "model": "gpt-4",
  "prompt": "完整提示词内容...",
  "response": "LLM 响应内容...",
  "input_tokens": 500,
  "output_tokens": 150,
  "cost_usd": 0.015,
  "duration_ms": 2500,
  "tool_calls": [
    {
      "name": "read_file",
      "input": {"path": "/tmp/test.txt"},
      "output": "文件内容...",
      "duration_ms": 50
    }
  ]
}
```

**用途**: 深度分析 Agent 工作流程

---

## 数据存储结构

### SQLite 表结构

```sql
CREATE TABLE traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT UNIQUE,          -- 唯一标识
    platform TEXT,                  -- 平台 (openclaw, claude-code, etc.)
    agent_name TEXT,                -- Agent 名称
    session_id TEXT,                -- Session ID
    start_time TEXT,                -- 开始时间
    end_time TEXT,                  -- 结束时间
    duration_ms INTEGER,            -- 执行时长
    model TEXT,                     -- 模型/工具名称
    prompt TEXT,                    -- 提示词/输入
    response TEXT,                  -- 响应/输出
    input_tokens INTEGER,           -- 输入 Token 数
    output_tokens INTEGER,          -- 输出 Token 数
    cost_usd REAL,                  -- 成本 (USD)
    tool_calls TEXT,                -- 工具调用 JSON
    status TEXT,                    -- 状态
    error_message TEXT,             -- 错误信息
    created_at TIMESTAMP            -- 创建时间
);
```

---

## 当前数据概况

```
总 Traces: 26
├── agentlens-dev: 20 traces (文件监控)
├── yiliansheng-agent: 4 traces (文件监控)
└── claude-code: 2 traces (测试数据)
```

---

## 如何添加新的数据来源

### 方式 1: 使用 Workflow Tracer (推荐)

```python
from workflow_tracer import trace_session

with trace_session("my-agent", "openclaw") as tracer:
    # 记录工具调用
    tracer.trace_tool(
        tool_name="search",
        input_args={"query": "AI"},
        output=results,
        duration_ms=1200
    )
    
    # 记录 LLM 调用
    tracer.trace_llm(
        model="gpt-4",
        prompt="Your prompt",
        response="LLM response",
        input_tokens=100,
        output_tokens=50,
        cost_usd=0.002,
        duration_ms=2000
    )
```

### 方式 2: 直接调用 API

```bash
curl -X POST http://localhost:8080/api/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "trace_id": "unique-id",
    "platform": "custom",
    "agent_name": "my-agent",
    "model": "gpt-4",
    "prompt": "input",
    "response": "output",
    "tool_calls": [{"name": "tool1", "input": {}, "output": {}}]
  }'
```

### 方式 3: 扩展 Session Scanner

编辑 `session_scanner.py`，添加新的 session 目录解析逻辑。

---

## 数据质量说明

| 数据来源 | 详细程度 | 实时性 | 用途 |
|---------|---------|--------|------|
| Project Watcher | ⭐⭐ 文件级 | 实时 | 开发活动监控 |
| Session Scanner | ⭐⭐⭐ Session 级 | 准实时 | 历史分析 |
| Workflow Tracer | ⭐⭐⭐⭐⭐ 调用级 | 实时 | 深度分析 |

---

## 下一步改进

1. **集成真实 Agent 工具**
   - OpenClaw 插件拦截
   - Claude Code hook
   - Kimi Code 适配器

2. **增强数据内容**
   - 捕获完整 HTTP 请求/响应
   - 记录系统资源使用
   - 追踪错误堆栈

3. **数据持久化优化**
   - 数据压缩
   - 自动归档
   - 导出功能
