# AgentLens 平台日志结构文档

本文档记录 AgentLens 支持的各平台（OpenClaw、Claude Code、Kimi Code）的 session 日志结构和数据获取逻辑。

## 目录

1. [OpenClaw](#openclaw)
2. [Claude Code](#claude-code)
3. [Kimi Code](#kimi-code)
4. [数据映射对比](#数据映射对比)

---

## OpenClaw

### 日志位置

```
~/.openclaw/agents/{agent_name}/sessions/{session_id}.jsonl
```

### 日志结构

OpenClaw 使用 JSON Lines 格式，每行是一个 JSON 对象：

```json
{"type": "message", "id": "msg-xxx", "timestamp": "2026-03-31T10:00:00Z", "agentId": "main", "message": {...}}
```

### Message 结构

```typescript
{
  "role": "user" | "assistant",
  "model": "kimi-k2.5" | "claude-sonnet-4-6" | ...,
  "content": [
    {"type": "text", "text": "..."},
    {"type": "toolCall", "id": "...", "name": "...", "arguments": {...}},
    {"type": "toolResult", "toolCallId": "...", "toolName": "...", "content": "...", "isError": false}
  ],
  "usage": {
    "input": 100,
    "output": 200,
    "cost": {"total": 0.001}
  }
}
```

### 数据提取逻辑

| 字段 | 提取方式 |
|------|----------|
| session_id | 文件名（去掉 .jsonl） |
| agent_name | `data.agentId` 或 "main" |
| platform | 固定值 "openclaw" |
| prompt | role="user" 时，提取 content 中的 text 类型 |
| response | role="assistant" 时，提取 content 中的 text 类型；如果没有 text 但有 toolCall，使用 toolCall 信息 |
| model | `message.model` |
| tool_calls | 提取 content 中的 toolCall 和 toolResult |
| project_path | 从 session 初始化消息中获取 `cwd` |

### 实时监听

- 监控文件大小变化
- 记录文件位置，只解析新增行
- 增量写入数据库

---

## Claude Code

### 日志位置

```
~/.claude/projects/{encoded_path}/{session_id}.jsonl
```

其中 `{encoded_path}` 是工作目录的编码形式（`/` 替换为 `-`）。

### 日志结构

```json
{"type": "user" | "assistant", "uuid": "...", "timestamp": "...", "cwd": "/path/to/project", "message": {...}}
```

### Message 结构

```typescript
{
  "role": "user" | "assistant",
  "model": "claude-sonnet-4-6" | ...,
  "content": [
    {"type": "text", "text": "..."},
    {"type": "tool_use", "id": "...", "name": "...", "input": {...}},
    {"type": "tool_result", "tool_use_id": "...", "content": "..."}
  ],
  "usage": {
    "input_tokens": 100,
    "output_tokens": 200
  }
}
```

### 数据提取逻辑

| 字段 | 提取方式 |
|------|----------|
| session_id | 文件名（去掉 .jsonl） |
| agent_name | 固定值 "claude-code" |
| platform | 固定值 "claude-code" |
| prompt | role="user" 时，提取 content 中的 text 类型 |
| response | role="assistant" 时，提取 content 中的 text 类型；如果没有 text 但有 tool_use，使用 tool_use 信息 |
| model | `message.model` |
| tool_calls | 提取 content 中的 tool_use 和 tool_result |
| project_path | 优先从 `data.cwd` 获取，否则从目录名解码 |

### 路径解码

```python
def _decode_path(encoded_name: str) -> str:
    decoded = encoded_name.replace("-", "/")
    if decoded.startswith("/"):
        decoded = decoded[1:]
    return decoded
```

### 实时监听

- 监控文件大小变化
- 记录文件位置，只解析新增行
- 增量写入数据库

---

## Kimi Code

### 日志位置

```
~/.kimi/sessions/{session_hash}/{sub_session_id}/wire.jsonl
~/.kimi/sessions/{session_hash}/{sub_session_id}/context.jsonl
```

### 日志结构

Kimi Code 使用更复杂的结构，消息类型在 `message.type` 中：

```json
{"type": null, "timestamp": 1234567890.123, "message": {"type": "TurnBegin", "payload": {...}}}
```

### Message 类型

| 类型 | 说明 |
|------|------|
| `TurnBegin` | 新对话回合开始，包含 user_input |
| `TurnEnd` | 对话回合结束 |
| `ToolCall` | 工具调用 |
| `ToolResult` | 工具结果 |
| `ContentPart` | LLM 响应内容片段 |
| `StatusUpdate` | 状态更新，包含 usage 信息 |

### TurnBegin Payload

```typescript
{
  "user_input": [
    {"type": "text", "text": "..."}
  ] | "string",
  "context": {...}
}
```

### ToolCall Payload

```typescript
{
  "id": "...",
  "function": {
    "name": "ReadFile",
    "arguments": "{\"path\": \"/path/to/file\"}"
  }
}
```

### 数据提取逻辑

| 字段 | 提取方式 |
|------|----------|
| session_id | 子目录名（sub_session_id） |
| agent_name | 固定值 "kimi-code" |
| platform | 固定值 "kimi-code" |
| prompt | `TurnBegin` 时从 `user_input` 提取（支持字符串和数组） |
| response | 从 `ContentPart` 累加 text 内容 |
| model | 固定值 "kimi-k2.5" |
| tool_calls | 收集 `ToolCall` 和 `ToolResult` |
| project_path | 从所有 tool_calls 的 path 参数推断共同前缀 |

### user_input 处理

```python
if isinstance(user_input, str):
    prompt_text = user_input
elif isinstance(user_input, list) and len(user_input) > 0:
    first_item = user_input[0]
    if isinstance(first_item, dict):
        prompt_text = first_item.get("text", "")
    else:
        prompt_text = str(first_item)
else:
    prompt_text = None
```

### 工作目录推断

```python
def _extract_work_dir_from_tool_calls(tool_calls: List[Dict]) -> str:
    paths = []
    for tool in tool_calls:
        path = tool.get("input", {}).get("path", "")
        if path and path.startswith("/"):
            paths.append(path)
    
    if not paths:
        return ""
    
    common = commonprefix(paths)
    if common:
        work_dir = dirname(common)
        if "." in common.split("/")[-1]:
            work_dir = dirname(work_dir)
        return work_dir
    return ""
```

### 实时监听

- 监控文件大小变化
- 由于需要维护 `current_turn` 状态，重新解析整个文件
- 保存到数据库

---

## 数据映射对比

### 通用字段

| 字段 | OpenClaw | Claude Code | Kimi Code |
|------|----------|-------------|-----------|
| trace_id | `data.id` | `data.uuid` | `turn-{timestamp}` |
| session_id | 文件名 | 文件名 | 子目录名 |
| platform | "openclaw" | "claude-code" | "kimi-code" |
| agent_name | `data.agentId` | "claude-code" | "kimi-code" |
| start_time | `data.timestamp` | `data.timestamp` | `timestamp` |
| model | `message.model` | `message.model` | "kimi-k2.5" |

### 内容提取

| 字段 | OpenClaw | Claude Code | Kimi Code |
|------|----------|-------------|-----------|
| prompt | text content | text content | `user_input` |
| response | text / toolCall | text / tool_use | ContentPart 累加 |
| tool_calls | toolCall / toolResult | tool_use / tool_result | ToolCall / ToolResult |

### 特殊处理

| 平台 | 特殊处理 |
|------|----------|
| OpenClaw | 从 session 消息获取 cwd |
| Claude Code | 路径编码解码 |
| Kimi Code | 状态机维护 current_turn，从 tool_calls 推断工作目录 |

---

## 增量更新策略

### OpenClaw & Claude Code

1. 记录文件位置（`file_positions`）
2. 检测到文件变大时，读取新增行
3. 解析新增行并写入数据库

### Kimi Code

1. 记录文件位置
2. 检测到变化时，重新解析整个文件
3. 写入数据库（SQLite UPSERT 处理重复）

---

## 相关代码文件

- `src/agentlens/collectors.py` - 收集器实现
- `src/agentlens/api.py` - API 服务和实时监听启动
