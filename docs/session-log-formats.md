# Agent Session 日志记录方式整理

## 1. Claude Code

### 存储位置
```
~/.claude/
├── sessions/           # Session 元数据
│   ├── 37555.json
│   ├── 41464.json
│   └── 86728.json
├── history.jsonl       # 命令历史记录
├── projects/           # 项目相关数据
├── skills/             # Skill 配置
└── telemetry/          # 遥测数据
```

### Session 文件格式
```json
{
  "pid": 86728,
  "sessionId": "a7ec2b19-1749-4940-961c-bbd8eb8b1e88",
  "cwd": "/Users/findai/Documents/workspace",
  "startedAt": 1774497090382,
  "kind": "interactive",
  "entrypoint": "cli"
}
```

### History 格式 (history.jsonl)
```json
{
  "display": "命令内容",
  "pastedContents": {},
  "timestamp": 1769070053703,
  "project": "/Users/findai/Documents/workspace/project",
  "sessionId": "57055722-ce0f-4c69-9aec-db2d3fd03147"
}
```

### 特点
- 使用 JSON Lines 格式记录命令历史
- Session 元数据与命令历史分离
- 包含项目路径和 session ID 关联

---

## 2. Kimi Code

### 存储位置
```
~/.kimi/
├── sessions/           # Session 目录（按 session hash）
│   └── a9e23d7495aee3efd9515048671691c5/
│       ├── 8ab3107a-5201-472a-9c75-26e55221e98e/  # Sub-session
│       └── dd637cb9-4aab-46be-8738-3d6fb52e3936/  # Sub-session
│           ├── context.jsonl      # 上下文消息
│           ├── context_1.jsonl    # 上下文备份
│           ├── wire.jsonl         # 完整通信记录
│           ├── state.json         # 状态
│           ├── tasks/             # 任务数据
│           └── notifications/     # 通知
├── logs/               # 日志文件
├── plans/              # 计划数据
├── user-history/       # 用户历史
└── kimi.json           # 配置文件
```

### Wire 格式 (wire.jsonl)
```json
{"type": "metadata", "protocol_version": "1.6"}
{"timestamp": 1774509608.800511, "message": {"type": "TurnBegin", "payload": {"user_input": [{"type": "text", "text": "用户输入"}]}}}
{"timestamp": 1774509614.251198, "message": {"type": "ToolCall", "payload": {"type": "function", "id": "Shell:0", "function": {"name": "Shell", "arguments": "{\"command\": \"ls\"}"}}}}
{"timestamp": 1774509622.055312, "message": {"type": "ToolResult", "payload": {"tool_call_id": "Shell:0", "return_value": {"is_error": false, "output": "..."}}}}
{"timestamp": 1774509625.391933, "message": {"type": "ContentPart", "payload": {"type": "text", "text": "AI 回复内容"}}}
```

### 特点
- 使用 wire.jsonl 记录完整的通信流程
- 包含 TurnBegin, StepBegin, ToolCall, ToolResult, ContentPart, StatusUpdate 等消息类型
- 支持子 session（sub-session）
- 详细的 token 使用统计

---

## 3. OpenClaw

### 存储位置
```
~/.openclaw/
├── logs/
│   ├── gateway.log          # 网关日志
│   ├── gateway.err.log      # 错误日志
│   ├── commands.log         # 命令日志
│   └── config-audit.jsonl   # 配置审计
├── memory/                  # 记忆文件
│   └── 2026-03-27.md
├── workspace/               # 工作空间
│   └── projects/
├── agents/                  # Agent 配置
├── devices/                 # 设备配对信息
├── completions/             # 补全记录
└── openclaw.json            # 主配置
```

### Gateway 日志格式
```
2026-03-19T14:28:35.167+08:00 [plugins] feishu_doc: Registered feishu_doc
2026-03-19T14:28:35.310+08:00 [canvas] host mounted at http://127.0.0.1:18789/__openclaw__/canvas/
2026-03-19T14:28:35.314+08:00 [gateway] agent model: moonshot/kimi-k2.5
2026-03-19T14:28:35.315+08:00 [gateway] listening on ws://127.0.0.1:18789
```

### 特点
- 使用结构化日志（带时间戳和标签）
- Session 数据存储在工作区的 memory/ 目录
- 通过 Gateway 集中管理所有连接
- 支持设备配对和远程访问

---

## 4. AgentLens 数据存储

### 存储位置
```
~/.agentlens/
└── agentlens.db          # SQLite 数据库
```

### 数据库表结构

#### traces 表
```sql
CREATE TABLE traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT UNIQUE,
    platform TEXT,              -- openclaw / claude-code / kimi-code
    agent_name TEXT,
    session_id TEXT,
    start_time TIMESTAMP,
    end_time TIMESTAMP,
    duration_ms INTEGER,
    status TEXT,                -- success / error / cancelled
    input_tokens INTEGER,
    output_tokens INTEGER,
    cost_usd REAL,
    prompt TEXT,                -- 用户输入/Prompt
    response TEXT,              -- AI 响应
    tool_calls TEXT,            -- JSON 格式的工具调用
    model TEXT,
    metadata TEXT               -- 其他元数据
);
```

### 数据收集方式
1. **Claude Code**: 通过 hooks 拦截命令执行
2. **Kimi Code**: 读取 wire.jsonl 文件
3. **OpenClaw**: 通过 API 拦截或日志解析

---

## 5. 对比总结

| 特性 | Claude Code | Kimi Code | OpenClaw |
|------|-------------|-----------|----------|
| 存储格式 | JSON + JSONL | JSONL | 结构化日志 |
| Session 粒度 | 进程级别 | 子 Session 级别 | Gateway 级别 |
| 工具调用记录 | 有 | 详细 (wire.jsonl) | 有 |
| Token 统计 | 有 | 详细 | 有 |
| 实时性 | 文件写入 | 文件写入 | WebSocket |
| 历史查询 | history.jsonl | wire.jsonl | 数据库/API |

---

## 6. 数据采集建议

### Claude Code
- 监听 `~/.claude/history.jsonl` 变化
- 解析 `~/.claude/sessions/*.json` 获取 session 元数据
- 通过 Claude Code 的 hooks 机制拦截事件

### Kimi Code
- 监听 `~/.kimi/sessions/*/wire.jsonl` 变化
- 解析 wire 消息获取完整的工具调用链
- 注意处理子 session 的情况

### OpenClaw
- 通过 Gateway API 获取实时数据
- 监听 `~/.openclaw/logs/gateway.log`
- 读取工作区的 memory/ 文件

### 统一存储
- 使用 AgentLens 的 SQLiteStorage
- 标准化字段：trace_id, platform, agent_name, tool_calls, llm_calls
- 支持跨平台的统一查询和分析
