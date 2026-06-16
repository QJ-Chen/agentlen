# AgentLens 深度工作流追踪指南

## 当前状态

本仓库当前支持的主产品路径是：
- 读取 Claude Code 本地 session 日志
- 写入本地 SQLite
- 通过 FastAPI + Dashboard 进行检索、复盘与分析

历史上的旧 tracing 示例已不再是受支持的运行时路径。

如果你要使用 AgentLens，请优先使用以下方式：
- `python3 -m src.agentlens.api`
- `python3 session_scanner.py`
- `python3 session_scanner.py --watch --interval 5`

---

## 启动方式

### 启动 API

```bash
python3 -m src.agentlens.api
```

### 刷新本地 Claude Code 会话

```bash
python3 session_scanner.py
```

### 持续监听 Claude Code 会话

```bash
python3 session_scanner.py --watch --interval 5
```

### 启动 Dashboard

```bash
cd dashboard
npm run dev
```

访问：
- Dashboard: 查看 `npm run dev` 输出的本地地址
- API: http://localhost:8080

---

## Dashboard 功能

### Session 列表
- Claude Code session 列表
- 按状态筛选
- 搜索 project / session / prompt

### Session 详情
- 工具调用链
- LLM 调用记录
- 输入输出详情
- 执行时间线

### 成本分析
- 总成本统计
- 按模型分布
- 按工具分布
- 项目级汇总

---

## API 端点

```bash
# 获取统计
curl http://localhost:8080/api/v1/stats

# 获取 Sessions
curl "http://localhost:8080/api/v1/sessions?limit=10"

# 获取 Traces
curl "http://localhost:8080/api/v1/traces?limit=10"

# 刷新采集
curl -X POST http://localhost:8080/api/v1/ingest/rescan
```

---

## 备注

如果未来重新引入更深的手动 tracing 能力，应基于新的产品决策重新设计，而不是依赖已删除的旧示例或旧工作流追踪脚本。
