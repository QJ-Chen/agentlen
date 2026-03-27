# Agent Session 日志记录方式整理

## 1. Claude Code

### 存储位置
```
~/.claude/
├── sessions/           # Session 元数据（PID 索引）
│   ├── 37555.json
│   ├── 41464.json
│   └── 86728.json
├── history.jsonl       # 命令历史记录
├── projects/           # 项目级 Session 日志（按工作目录组织）
│   └── -Users-findai-Documents-workspace/     # 工作目录（路径编码）
│       └── <session-id>.jsonl                 # Session 消息记录
├── skills/             # Skill 配置
└── telemetry/          # 遥测数据
```

### Session 元数据（sessions/*.json）
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

### 项目级 Session 日志（projects/*/<session-id>.jsonl）

#### 1. 文件历史快照
```json
{
  "type": "file-history-snapshot",
  "messageId": "058bcb95-2b80-477d-91a9-eb07bbc8cfe4",
  "snapshot": {
    "messageId": "058bcb95-2b80-477d-91a9-eb07bbc8cfe4",
    "trackedFileBackups": {},
    "timestamp": "2026-03-17T02:56:17.166Z"
  },
  "isSnapshotUpdate": false
}
```

#### 2. 用户消息
```json
{
  "parentUuid": null,
  "isSidechain": false,
  "userType": "external",
  "cwd": "/Users/findai/Documents/workspace",
  "sessionId": "a7ec2b19-1749-4940-961c-bbd8eb8b1e88",
  "version": "2.1.84",
  "gitBranch": "main",
  "type": "user",
  "message": {
    "role": "user",
    "content": "用户输入内容"
  },
  "uuid": "a3bdb7c0-4bb1-4084-89cc-bd62b1dc7a2a",
  "timestamp": "2026-03-26T03:52:31.909Z",
  "todos": [],
  "permissionMode": "default"
}
```

#### 3. AI 助手消息（带工具调用）
```json
{
  "parentUuid": "a3bdb7c0-4bb1-4084-89cc-bd62b1dc7a2a",
  "isSidechain": false,
  "type": "assistant",
  "uuid": "9bdfe22f-542f-4c22-a58b-1c3d9505c81e",
  "timestamp": "2026-03-26T03:52:39.303Z",
  "message": {
    "id": "msg_643e0844780e40dea42da65dc1ac7294",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "AI 回复内容"
      },
      {
        "type": "tool_use",
        "id": "tooluse_YnTySE5KL06BJfxdgrbecA",
        "name": "WebSearch",
        "input": {"query": "agent observability monitoring tools 2026"}
      }
    ],
    "model": "claude-sonnet-4-5-20250929",
    "stop_reason": null,
    "usage": {
      "input_tokens": 31734,
      "output_tokens": 1,
      "cache_creation_input_tokens": 26607,
      "cache_read_input_tokens": 0
    }
  }
}
```

#### 4. 工具执行结果
```json
{
  "parentUuid": "9e54987c-1674-44c6-87c9-e6243f214e41",
  "isSidechain": false,
  "type": "user",
  "uuid": "1e0660ed-541f-4a85-9808-72497d9354c8",
  "timestamp": "2026-03-26T03:54:00.367Z",
  "message": {
    "role": "user",
    "content": [
      {
        "tool_use_id": "tooluse_DXwrxocjmaoSjAaizCbVIO",
        "type": "tool_result",
        "content": "工具执行结果内容"
      }
    ]
  },
  "toolUseResult": {
    "query": "LangSmith Langfuse agent monitoring comparison 2026",
    "results": [...],
    "durationSeconds": 1.7262063339999878
  }
}
```

#### 5. 进度更新
```json
{
  "parentUuid": "82613b60-dabc-4b52-b83a-c9cc2c0e7f06",
  "isSidechain": false,
  "type": "progress",
  "data": {
    "type": "query_update",
    "query": "LangSmith Langfuse agent monitoring comparison 2026"
  },
  "toolUseID": "search-progress-1",
  "parentToolUseID": "tooluse_DXwrxocjmaoSjAaizCbVIO",
  "uuid": "ae9e2d48-5419-4e93-8f7a-caeafb36acf7",
  "timestamp": "2026-03-26T03:54:00.300Z"
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
- **项目级组织**: Session 日志按工作目录（projects/）组织
- **路径编码**: 目录名使用路径编码（如 `-Users-findai-Documents-workspace`）
- **丰富的消息类型**: user, assistant, progress, file-history-snapshot
- **完整的工具链**: tool_use → tool_result 的完整链路
- **父子关系**: 通过 `parentUuid` 建立消息树
- **详细的 Token 统计**: input_tokens, output_tokens, cache_creation_input_tokens, cache_read_input_tokens
- **工具执行详情**: toolUseResult 包含执行时间和结果

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
│   ├── gateway.log          # 网关日志（结构化文本）
│   ├── gateway.err.log      # 错误日志
│   ├── commands.log         # 命令日志
│   └── config-audit.jsonl   # 配置审计（JSON Lines）
├── agents/
│   └── main/
│       └── sessions/        # Session 日志（JSON Lines）
│           ├── sessions.json           # Session 索引
│           ├── <session-id>.jsonl      # Session 消息记录
│           └── <session-id>.jsonl.lock # 文件锁
├── memory/                  # 记忆文件
│   └── 2026-03-27.md
├── workspace/               # 工作空间
│   └── projects/
├── devices/                 # 设备配对信息
├── completions/             # 补全记录
└── openclaw.json            # 主配置
```

### Session 日志格式（agents/main/sessions/*.jsonl）

#### 1. Session 初始化
```json
{
  "type": "session",
  "version": 3,
  "id": "12a466be-65bf-488b-935f-ccd3db81bc89",
  "timestamp": "2026-03-26T20:15:25.522Z",
  "cwd": "/Users/findai/.openclaw/workspace"
}
```

#### 2. 模型变更
```json
{
  "type": "model_change",
  "id": "ad4fded5",
  "parentId": null,
  "timestamp": "2026-03-26T20:15:25.523Z",
  "provider": "moonshot",
  "modelId": "kimi-k2.5"
}
```

#### 3. 用户消息
```json
{
  "type": "message",
  "id": "adef9913",
  "parentId": "b71d5b90",
  "timestamp": "2026-03-26T20:15:25.527Z",
  "message": {
    "role": "user",
    "content": [{"type": "text", "text": "用户输入内容"}],
    "timestamp": 1774556125525
  }
}
```

#### 4. AI 助手消息（带工具调用）
```json
{
  "type": "message",
  "id": "7616511b",
  "parentId": "adef9913",
  "timestamp": "2026-03-26T20:15:29.136Z",
  "message": {
    "role": "assistant",
    "content": [
      {
        "type": "toolCall",
        "id": "read:0",
        "name": "read",
        "arguments": {"file_path": "/path/to/file"}
      }
    ],
    "api": "openai-completions",
    "provider": "moonshot",
    "model": "kimi-k2.5",
    "usage": {
      "input": 8097,
      "output": 57,
      "cacheRead": 3584,
      "cacheWrite": 0,
      "totalTokens": 11738,
      "cost": {
        "input": 0,
        "output": 0,
        "cacheRead": 0,
        "cacheWrite": 0,
        "total": 0
      }
    },
    "stopReason": "toolUse",
    "timestamp": 1774556125528,
    "responseId": "chatcmpl-69c593de4d445f2e4948e024"
  }
}
```

#### 5. 工具执行结果
```json
{
  "type": "message",
  "id": "9e3baace",
  "parentId": "7616511b",
  "timestamp": "2026-03-26T20:15:29.162Z",
  "message": {
    "role": "toolResult",
    "toolCallId": "read:0",
    "toolName": "read",
    "content": [{"type": "text", "text": "文件内容"}],
    "isError": false,
    "timestamp": 1774556129160
  }
}
```

#### 6. 其他事件类型
- `thinking_level_change`: 思考级别变更
- `custom`: 自定义事件（如 model-snapshot）

### Sessions 索引文件（sessions.json）
```json
{
  "agent:main:main": {
    "sessionId": "12a466be-65bf-488b-935f-ccd3db81bc89",
    "updatedAt": 1774594635670,
    "systemSent": true,
    "abortedLastRun": false,
    "authProfileOverride": "moonshot:default",
    "chatType": "direct",
    "deliveryContext": {"channel": "webchat"},
    "origin": {
      "label": "heartbeat",
      "provider": "webchat",
      "surface": "webchat"
    },
    "sessionFile": "/Users/findai/.openclaw/agents/main/sessions/12a466be-...jsonl",
    "compactionCount": 2,
    "skillsSnapshot": {...}
  }
}
```

### Gateway 日志格式（logs/gateway.log）
```
2026-03-19T14:28:35.167+08:00 [plugins] feishu_doc: Registered feishu_doc
2026-03-19T14:28:35.310+08:00 [canvas] host mounted at http://127.0.0.1:18789/__openclaw__/canvas/
2026-03-19T14:28:35.314+08:00 [gateway] agent model: moonshot/kimi-k2.5
2026-03-19T14:28:35.315+08:00 [gateway] listening on ws://127.0.0.1:18789
```

### Config 审计日志（logs/config-audit.jsonl）
```json
{
  "ts": "2026-03-19T06:22:52.079Z",
  "source": "config-io",
  "event": "config.write",
  "configPath": "/Users/findai/.openclaw/openclaw.json",
  "pid": 52010,
  "ppid": 52009,
  "cwd": "/Users/findai",
  "argv": [...],
  "previousHash": "e3b0c44298fc1c149afbf4c8996fb924...",
  "nextHash": "4ef3183a7fa6da2e03de058c05588cfd...",
  "result": "rename"
}
```

### 特点
- **详细的 Session 日志**: JSON Lines 格式，记录完整的对话流程
- **丰富的消息类型**: session, model_change, message, thinking_level_change, custom
- **完整的 Token 统计**: input, output, cacheRead, cacheWrite, cost
- **工具调用链**: toolCall → toolResult 的完整链路
- **Session 索引**: sessions.json 提供快速查找
- **配置审计**: 记录所有配置变更
- **多 Agent 支持**: agents/ 目录下可以有多个 agent 配置

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
- **Session 元数据**: 解析 `~/.claude/sessions/*.json` 获取 PID 和 session 信息
- **项目级日志**: 监听 `~/.claude/projects/*/<session-id>.jsonl` 变化
- **命令历史**: 读取 `~/.claude/history.jsonl` 获取命令记录
- **路径解码**: 将编码的目录名（如 `-Users-findai-Documents-workspace`）解码为实际路径
- 通过 Claude Code 的 hooks 机制拦截事件

### Kimi Code
- 监听 `~/.kimi/sessions/*/wire.jsonl` 变化
- 解析 wire 消息获取完整的工具调用链
- 注意处理子 session 的情况

### OpenClaw
- **Session 日志**: 监听 `~/.openclaw/agents/<agent>/sessions/*.jsonl` 变化
- **Session 索引**: 读取 `~/.openclaw/agents/<agent>/sessions/sessions.json` 获取活跃 session
- **Gateway 日志**: 监听 `~/.openclaw/logs/gateway.log` 获取系统事件
- **Config 审计**: 读取 `~/.openclaw/logs/config-audit.jsonl` 获取配置变更
- **实时数据**: 通过 Gateway WebSocket API 获取实时更新

### 统一存储
- 使用 AgentLens 的 SQLiteStorage
- 标准化字段：trace_id, platform, agent_name, tool_calls, llm_calls
- 支持跨平台的统一查询和分析
