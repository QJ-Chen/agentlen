# AgentLens for Claude Code - 使用指南

## 🚀 快速开始

### 1. 启动 AgentLens 服务

在终端 1 运行：
```bash
cd /Users/findai/.openclaw/workspace/projects/agentlens
PYTHONPATH=src:$PYTHONPATH python3 src/agentlens/api.py
```

服务将在 http://localhost:8080 启动

### 2. 在 Claude Code 中集成

将 `agentlens_observer.py` 复制到你的 Claude Code 项目根目录：

```bash
cp /Users/findai/.openclaw/workspace/projects/agentlens/agentlens_observer.py \
   /path/to/your/claude-code-project/
```

### 3. 在 Agent 中使用

编辑你的 `.claude/agents/*.md` 文件，添加观测代码：

```python
---
name: MyAgent
description: 带观测的 Agent
---

from agentlens_observer import observe_tool, observe_llm, log_event

# 观测工具调用
@observe_tool("read_file")
def read_file(path: str):
    # 原有的文件读取逻辑
    with open(path, 'r') as f:
        return f.read()

# 观测 LLM 调用
with observe_llm("claude-3-5", "你的提示词"):
    # 原有的 LLM 调用
    response = call_llm(...)

# 记录自定义事件
log_event("custom_event", {"key": "value"})
```

### 4. 查看观测数据

在终端 2 运行监控：
```bash
cd /Users/findai/.openclaw/workspace/projects/agentlens
PYTHONPATH=src:$PYTHONPATH python3 src/agentlens/cli.py monitor
```

或查看摘要：
```bash
PYTHONPATH=src:$PYTHONPATH python3 src/agentlens/cli.py
```

### 5. 启动 Dashboard

在终端 3 运行：
```bash
cd /Users/findai/.openclaw/workspace/projects/agentlens/dashboard
npm install  # 首次运行
npm run dev
```

访问 http://localhost:5173 查看可视化仪表盘

## 📊 观测内容

AgentLens 会自动收集：

- ✅ 工具调用（名称、参数、耗时、结果）
- ✅ LLM 调用（模型、提示词、Token 消耗）
- ✅ 执行时间（开始、结束、总耗时）
- ✅ 成本估算（基于 Token 数）
- ✅ 错误追踪（异常、堆栈）

## 🔌 API 端点

- `GET /api/v1/stats` - 统计摘要
- `GET /api/v1/traces` - Trace 列表
- `POST /api/v1/traces` - 提交 Trace
- `GET /api/v1/platforms` - 平台列表
- `GET /api/v1/sessions` - 会话列表

## 💡 使用技巧

1. **批量观测**：使用 `log_event()` 记录批量操作
2. **过滤查看**：Dashboard 支持按平台筛选
3. **成本告警**：监控总成本，设置预算上限
4. **性能分析**：查看平均延迟，识别慢操作

## 🐛 故障排除

**API 连接失败**
- 检查服务是否启动：`curl http://localhost:8080`
- 确认端口未被占用

**数据未显示**
- 确认 observer 文件路径正确
- 检查 API URL 是否为 `http://localhost:8080`

**Dashboard 无法访问**
- 确认 `npm install` 成功
- 检查端口 5173 是否可用
