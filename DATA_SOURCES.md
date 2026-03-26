# AgentLens 数据来源说明

本文档说明 AgentLens 的数据来源、流向和存储结构。

## 数据流向

```
┌─────────────────────────────────────────────────────────────┐
│                      数据来源层                              │
├─────────────────────────────────────────────────────────────┤
│  Session Scanner                                            │
│  - Claude Code: ~/.claude/projects/*.jsonl                  │
│  - Kimi Code: ~/.kimi/sessions/*/wire.jsonl                 │
│  - OpenClaw: ~/.openclaw/subagents/runs.json                │
├─────────────────────────────────────────────────────────────┤
│                      数据存储层                              │
├─────────────────────────────────────────────────────────────┤
│  SQLite: ~/.agentlens/agentlens.db                          │
│  - traces 表: 执行追踪数据                                  │
├─────────────────────────────────────────────────────────────┤
│                      API 服务层                              │
├─────────────────────────────────────────────────────────────┤
│  FastAPI: http://localhost:8080                             │
│  - POST /api/v1/traces                                      │
│  - GET  /api/v1/traces                                      │
│  - GET  /api/v1/stats                                       │
├─────────────────────────────────────────────────────────────┤
│                      展示层                                  │
├─────────────────────────────────────────────────────────────┤
│  Dashboard: http://localhost:5177                           │
│  - Trace 列表                                               │
│  - 工具调用详情                                             │
│  - LLM 对话内容                                             │
│  - 统计分析                                                 │
└─────────────────────────────────────────────────────────────┘
```

## 平台数据格式

### Claude Code

**文件位置**: `~/.claude/projects/<project>/<session>.jsonl`

**数据内容**:
- 完整对话历史 (user/assistant)
- 工具调用 (tool_use/tool_result)
- Token 使用统计
- 模型信息

**示例**:
```json
{"type": "user", "content": "Hello"}
{"type": "assistant", "message": {"content": [{"type": "text", "text": "Hi!"}], "usage": {"input_tokens": 10, "output_tokens": 5}}}
```

### Kimi Code

**文件位置**: `~/.kimi/sessions/<session>/<uuid>/wire.jsonl`

**数据内容**:
- TurnBegin (用户输入)
- ToolCall / ToolResult
- ContentPart (LLM 响应)
- StatusUpdate (Token 使用)

**示例**:
```json
{"timestamp": 1234567890, "message": {"type": "TurnBegin", "payload": {"user_input": "Hello"}}}
{"timestamp": 1234567891, "message": {"type": "ToolCall", "payload": {"function": {"name": "ReadFile", "arguments": "{}"}}}}
```

### OpenClaw

**文件位置**: `~/.openclaw/subagents/runs.json`

**数据内容**:
- Subagent 执行记录
- 任务描述和结果
- 状态 (ok/error/timeout)
- 执行时长

**示例**:
```json
{
  "runs": [{
    "runId": "uuid",
    "label": "task-name",
    "frozenResultText": "result",
    "status": "ok",
    "durationMs": 5000
  }]
}
```

## 数据存储结构

### SQLite 表结构

```sql
CREATE TABLE traces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    trace_id TEXT UNIQUE,          -- 唯一标识
    platform TEXT,                  -- 平台 (claude-code, kimi-code, openclaw)
    agent_name TEXT,                -- Agent 名称
    session_id TEXT,                -- Session ID
    start_time TEXT,                -- 开始时间 (ISO 8601)
    end_time TEXT,                  -- 结束时间
    duration_ms INTEGER,            -- 执行时长
    model TEXT,                     -- 模型名称
    prompt TEXT,                    -- 提示词/输入
    response TEXT,                  -- 响应/输出
    input_tokens INTEGER,           -- 输入 Token 数
    output_tokens INTEGER,          -- 输出 Token 数
    cost_usd REAL,                  -- 成本 (USD)
    tool_calls TEXT,                -- 工具调用 JSON 数组
    status TEXT,                    -- 状态 (success/error/timeout)
    error_message TEXT,             -- 错误信息
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## 添加新数据来源

### 方式 1: 扩展 Session Scanner

编辑 `session_scanner.py`，添加新的解析方法:

```python
def _scan_new_platform(self, dir_path: Path) -> List[Dict]:
    sessions = []
    for session_file in dir_path.glob('*.json'):
        data = self._parse_new_format(session_file)
        if data:
            sessions.append(data)
    return sessions
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
    "input_tokens": 100,
    "output_tokens": 50,
    "cost_usd": 0.002
  }'
```

## 数据质量

| 平台 | 详细程度 | Token 准确性 | 实时性 |
|------|---------|-------------|--------|
| Claude Code | ⭐⭐⭐⭐⭐ | 高 (API 返回) | 历史扫描 |
| Kimi Code | ⭐⭐⭐⭐ | 高 (API 返回) | 历史扫描 |
| OpenClaw | ⭐⭐⭐ | 估算 | 历史扫描 |

## 注意事项

1. **Token 计算**: Claude/Kimi 使用 API 返回的真实值，OpenClaw 基于字符数估算
2. **成本计算**: 基于各平台官方定价
   - Claude Sonnet: $3/M input, $15/M output
   - Kimi K2.5: $2/M input, $8/M output
3. **数据隐私**: 所有数据存储在本地 SQLite，不会上传到云端
