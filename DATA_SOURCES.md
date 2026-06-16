# AgentLens 数据来源说明

AgentLens 的核心能力不是“运行 Agent”，而是**读取和理解 Claude Code 已经留下的本地执行证据**。

本文件说明：
- 支持哪些数据来源
- 数据如何进入系统
- AgentLens 如何把原始日志变成可检索的 session 记录

---

## 产品视角：什么是核心数据

AgentLens 主要围绕以下对象构建：

### Session
一个完整的 Claude Code 会话，通常对应一次持续的任务执行过程。

### Tool Call
会话中的工具调用，如读取文件、搜索、编辑、执行命令等。

### LLM Call
会话中的模型交互，包括 prompt、response、token usage、model 等信息。

### Session Metadata
帮助定位上下文的附加信息，例如：
- project/workdir
- session 文件路径
- session 状态
- 时间范围

---

## 数据流向

```text
Claude Code 本地 session 日志 / 兼容 trace 事件
                    ↓
CollectorManager + Claude Code Collector
                    ↓
标准化 session record
                    ↓
SQLite (~/.agentlens/agentlens.db)
                    ↓
FastAPI
                    ↓
Dashboard / CLI / analytics
```

---

## 核心数据来源（主产品路径）

### Claude Code

**路径模式**
- `~/.claude/projects/<encoded-project>/*.jsonl`

**主要内容**
- user / assistant 消息
- tool_use / tool_result
- usage token 信息
- model 信息
- cwd / project 上下文

**AgentLens 提取目标**
- session 级 prompt / response 概览
- tool 调用列表
- llm 调用列表
- token / cost 汇总
- session 文件来源

---

## 次级数据来源（兼容 / 高级路径）

### 手动 trace ingestion

适用于：
- 自定义 Claude Code 相关实验
- 内部兼容写入
- 需要直接向 API 提交 trace 的场景

相关入口：
- `POST /api/v1/traces`
- `POST /api/v1/traces/batch`
- `src/agentlens/collector.py`

这类数据源仍然可用，但支持范围应与 Claude Code 运行时保持一致。核心产品仍应优先优化**真实本地 Claude Code session 日志**的解析与可视化。

---

## 存储模型（当前实现）

当前实现使用 SQLite 中的 `traces` 表承载 session 记录。

虽然表名是 `traces`，但对 AgentLens 的主产品而言，它更应该被理解为：

> **标准化后的 Claude Code session records**

每条记录通常包含：
- `platform`（固定为 `claude-code`）
- `session_id`
- `agent_name`
- `start_time` / `end_time`
- `duration_ms`
- `model`
- `prompt` / `response`
- `input_tokens` / `output_tokens`
- `cost_usd`
- `tool_calls` (JSON)
- `llm_calls` (JSON)
- `project_path`
- `session_file_path`
- `metadata`

---

## 标准化目标

虽然底层日志有多种 message/content 形式，AgentLens 的 collector 应尽量输出统一结构：

```json
{
  "trace_id": "session_...",
  "platform": "claude-code",
  "agent_name": "claude-code",
  "session_id": "...",
  "session_file_path": "...",
  "project_path": "...",
  "start_time": "2026-06-08T10:00:00+00:00",
  "end_time": "2026-06-08T10:05:00+00:00",
  "duration_ms": 300000,
  "model": "claude-opus-4-8",
  "prompt": "...",
  "response": "...",
  "input_tokens": 1000,
  "output_tokens": 600,
  "cost_usd": 0.0123,
  "tool_calls": [...],
  "llm_calls": [...],
  "status": "success",
  "metadata": {
    "message_count": 24,
    "llm_call_count": 5
  }
}
```

---

## 数据质量与取舍

| 维度 | 说明 |
|------|------|
| 完整度 | 取决于 Claude Code 原始日志是否公开了 tool / usage / prompt / response |
| 成本精度 | 优先使用日志内真实 usage；必要时按 Claude Code 定价估算 |
| 实时性 | 目前主要依赖 polling/watch 模式，不是事件流系统 |
| 隐私 | 默认本地 SQLite，不上传云端 |

---

## 当前边界

### AgentLens 主要做什么
- 读取本地 Claude Code session 日志
- 聚合为可查询 session 记录
- 提供 Inspector / Analytics 视图
- 帮助开发者复盘 Claude Code 行为

### AgentLens 当前不主打什么
- 远程控制 agent
- 完整任务编排系统
- 通用企业级 OpenTelemetry 平台
- 多租户 SaaS 监控

---

## 支持范围原则

当前支持范围优先回答下面的问题：

1. 这个来源是否真的是 Claude Code 会话证据？
2. 能否提取 prompt / response / tools / usage 等关键数据？
3. 能否恢复 project/workdir 或 session 来源？
4. 这种数据是否会增强 AgentLens 的“Claude Code session intelligence”定位？

如果只是为了保留旧平台痕迹或抽象而抽象，不建议继续扩展在主产品路径中。
