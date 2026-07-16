# Claude Code Session 日志记录方式整理

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

## 2. AgentLens 采集重点

AgentLens 当前只围绕 Claude Code 日志做标准化提取，重点关注：

- session_id
- start/end timestamps
- prompt / response 概览
- tool_use / tool_result 调用链
- model 和 token 使用
- cwd / project_path / session_file_path provenance

---

## 3. 数据采集建议

### Claude Code
- 监听 `~/.claude/projects/<encoded-project>/*.jsonl` 变化
- 以 `type = user | assistant` 为主消息流
- 从 `message.content` 中提取 `text` / `tool_use` / `tool_result`
- 优先使用 `cwd`，否则从父目录名解码 project path
- 将结果标准化写入统一 `traces` 表

---

## 4. 相关文档

- [Raw Claude Code session log IDs and structure](./raw-session-log-ids-and-structure.md) — identifier families, raw record envelopes, and graph-relevant relationships.

---

## 5. 结论

对 AgentLens 当前支持的运行时而言，Claude Code 日志已经提供了足够丰富的 session 证据，可以支撑：
- session replay
- tool / LLM timeline
- token / cost analytics
- provenance-based debugging

因此当前文档和实现都应以 Claude Code 为唯一支持来源来保持一致。
