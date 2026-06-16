# Claude Code 平台日志结构文档

本文档记录 AgentLens 当前支持的 **Claude Code** session 日志结构和数据获取逻辑。

## 目录

1. [Claude Code](#claude-code)
2. [数据映射](#数据映射)
3. [增量更新策略](#增量更新策略)

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
| agent_name | 固定值 `claude-code` |
| platform | 固定值 `claude-code` |
| prompt | role=`user` 时，提取 content 中的 text 类型 |
| response | role=`assistant` 时，提取 content 中的 text 类型；如果没有 text 但有 tool_use，使用 tool_use 信息 |
| model | `message.model` |
| tool_calls | 提取 content 中的 `tool_use` 和 `tool_result` |
| project_path | 优先从 `data.cwd` 获取，否则从目录名解码 |

### 路径解码

```python
def _decode_path(encoded_name: str) -> str:
    decoded = encoded_name.replace("-", "/")
    if decoded.startswith("/"):
        decoded = decoded[1:]
    return decoded
```

---

## 数据映射

### 通用字段

| 字段 | Claude Code |
|------|-------------|
| trace_id | `data.uuid` |
| session_id | 文件名 |
| platform | `claude-code` |
| agent_name | `claude-code` |
| start_time | `data.timestamp` |
| model | `message.model` |

### 内容提取

| 字段 | Claude Code |
|------|-------------|
| prompt | user text content |
| response | assistant text content / tool_use fallback / thinking fallback |
| tool_calls | `tool_use` + `tool_result` |
| project_path | `cwd` 或目录名解码 |
| usage | `input_tokens` + `output_tokens` |

---

## 增量更新策略

### Claude Code

- 监控文件大小变化
- 记录文件位置，只解析新增行
- 如果文件被截断或轮转，则重建该文件状态
- 每次增量更新后重新生成该 session 的标准化记录并写入数据库

---

## 备注

AgentLens 当前支持的运行时是 Claude Code only。

如果未来重新引入其他平台，应该以新的显式产品决策为前提，而不是依赖历史文档残留。
