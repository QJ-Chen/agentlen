# AgentLens 架构设计

## 1. 重新定义：AgentLens 是什么

AgentLens 是一个 **local-first 的 Claude Code session intelligence 工具**。

它的核心目标不是“控制 Agent”，而是：

> **把本地 Claude Code session 日志变成可搜索、可复盘、可分析的结构化记录。**

典型使用场景：
- 回看 Claude Code 某次会话到底做了什么
- 找出最贵/最长/失败的 session
- 分析一个项目近期消耗了多少 token/cost
- 从工具调用与 LLM 响应链路中定位问题
- 理解某次 Claude Code 工作流中哪些工具、模型和上下文参与了结果生成

---

## 2. 设计原则

### 2.1 Local-first
- 优先使用本地 Claude Code session 文件
- 默认 SQLite
- 默认不依赖外部云服务

### 2.2 Session-centric
- 产品核心对象是 session，而不是抽象 trace/span 平台
- 重要实体：session / tool call / LLM call / project context

### 2.3 Claude Code specific
- 面向 Claude Code 会话日志
- 重点优化 prompt / tool / cost / workdir / provenance 的恢复

### 2.4 Forensic usefulness
- 优先支持复盘与排障能力
- 不是为了“漂亮监控图”而牺牲数据解释性

### 2.5 Honest scope
- 不把实验性 orchestration / multi-agent sandbox 误写成主产品能力

---

## 3. 逻辑架构

```text
┌────────────────────────────────────────────────────────────┐
│ Local Claude Code artifacts                                │
│  - Claude Code project sessions                            │
│  - optional compatibility/manual traces                    │
└───────────────────────────┬────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│ Ingestion layer                                             │
│  CollectorManager                                            │
│  - historical backfill                                       │
│  - watch/poll mode                                           │
│  - Claude Code normalization                                 │
└───────────────────────────┬────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│ Storage layer                                                │
│  SQLiteStorage                                               │
│  - session records (currently stored in traces table)        │
│  - stats / rollups / project summaries                       │
└───────────────────────────┬────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│ API layer                                                    │
│  FastAPI                                                     │
│  - sessions                                                  │
│  - session detail                                            │
│  - overview stats                                            │
│  - project rollups                                           │
│  - ingest triggers                                           │
└───────────────────────────┬────────────────────────────────┘
                            │
                            ▼
┌────────────────────────────────────────────────────────────┐
│ UI layer                                                     │
│  React dashboard                                             │
│  - Sessions Inbox                                            │
│  - Session Inspector                                         │
│  - Analytics                                                 │
│  - Recent Activity                                           │
└────────────────────────────────────────────────────────────┘
```

---

## 4. 核心模块职责

### 4.1 `collectors.py`
这是主产品的 **canonical ingestion pipeline**。

职责：
- 发现 Claude Code session 文件
- 解析 Claude Code 日志格式
- 聚合同一 session 的消息、tool calls、LLM calls
- 输出统一 session record
- watch 模式下持续增量刷新

### 4.2 `storage.py`
职责：
- 初始化本地 SQLite
- 保存 normalized session records
- 提供 session 查询、overview stats、project rollups
- 兼容旧的 trace-oriented API，但仅支持 Claude Code 平台

### 4.3 `api.py`
职责：
- 暴露 session/stats 查询接口
- 提供 ingest 触发入口
- 保持与兼容 trace 写入路径的一致 contract
- 拒绝非 Claude Code 平台写入

### 4.4 `realtime.py`
职责：
- 后台 watch/poll 封装
- 持续读取 collector 更新
- 在刷新前清理历史遗留的非 Claude 数据

### 4.5 `dashboard/`
职责：
- 让开发者快速找到“值得看的 Claude Code session”
- 让开发者打开某次 session 后立即理解发生了什么
- 提供跨项目 / 模型 / 工具的成本与活动分析

---

## 5. 领域模型

虽然底层表名仍是 `traces`，但产品层应按以下模型理解：

### SessionRecord
- platform（固定为 `claude-code`）
- session_id
- agent_name
- project_path
- session_file_path
- start_time / end_time
- duration_ms
- model
- prompt / response preview
- input_tokens / output_tokens / cost_usd
- status

### ToolCall
- tool name
- input preview
- output preview
- error flag
- timestamp

### LLMCall
- model
- prompt preview
- response preview
- token usage
- timestamp

### Derived Analytics
- model distribution
- project activity
- top tools
- expensive sessions
- failed sessions

---

## 6. 产品表面设计

### 6.1 Sessions Inbox
目标：快速找到值得看的 session

应支持：
- 搜索 agent / prompt / session id / project path
- 按状态 / 模型筛选
- 按时间 / cost / tokens / duration 排序
- 快速定位失败或昂贵 session

### 6.2 Session Inspector
目标：回答“这次 Claude Code session 到底做了什么？”

应支持：
- prompt / response 预览
- timeline of tool calls + LLM calls
- provenance（session 文件路径、project/workdir）
- usage/cost summary
- raw evidence drill-down

### 6.3 Analytics
目标：回答“整体资源花在了哪里？”

应支持：
- cost over time
- model mix
- top projects
- top tools
- outcome/status 分布

### 6.4 Recent Activity
目标：看到最近更新过的 Claude Code session，而不是假装有实时任务控制能力。

---

## 7. 核心 / 次级 / 实验边界

### 核心（必须长期维护）
- Claude Code local log ingestion
- session normalization
- SQLite-backed query model
- session inspector
- cost/token/project analytics

### 次级（可以保留，但不应主导产品叙事）
- manual compatibility tracing
- Claude-oriented adapters

### 实验（明确标注）
- 多 agent 模拟
- orchestration sandbox
- config-driven team workflows

这些实验可以继续存在，但应避免影响主架构判断。

---

## 8. 演进方向

### 近期高价值演进
1. 更稳定的 parser fixtures / regression tests
2. 更好的全文搜索与过滤
3. 更强的 project rollups
4. 更好的 tool output / diff 预览
5. 更清晰的 failure/expensive-session triage

### 当前阶段不优先
1. 远程控制 agent
2. 云端多租户平台
3. 复杂 orchestration runtime
4. 通用 OpenTelemetry 基础设施替代品

---

## 9. 结论

AgentLens 最有价值的 niche 不是“大而全 observability”，也不是“agent mission control”。

更有竞争力的定义是：

> **一个专注于 Claude Code 本地 session 复盘、检索与分析的轻量级工具。**

只要保持这条主线，AgentLens 的架构、API、UI 和文档就会自然收敛。
