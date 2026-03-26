# AgentLens - Agent 可观测平台

轻量级、多平台 Agent 执行追踪与成本分析工具。

## 功能特性

- 🔍 **多平台支持**: OpenClaw、Claude Code、Kimi Code、Cursor
- 📊 **执行追踪**: 工具调用链、LLM 请求详情
- 💰 **成本监控**: Token 消耗、API 成本实时统计
- 🌐 **Web Dashboard**: 可视化展示执行流程
- 🚀 **轻量级**: SQLite 默认，零配置启动

## 快速开始

### 安装

```bash
# 克隆仓库
git clone git@github.com:QJ-Chen/agentlen.git
cd agentlen

# 安装依赖
pip install -r requirements.txt
cd dashboard && npm install && cd ..
```

### 启动服务

```bash
# 1. 启动 API 服务器
python3 -m src.agentlens.api

# 2. 启动 Dashboard (新终端)
cd dashboard && npm run dev

# 3. 扫描历史 Sessions
python3 session_scanner.py
```

访问 http://localhost:5177 查看 Dashboard。

## 项目结构

```
agentlens/
├── src/agentlens/          # 核心代码
│   ├── api.py              # FastAPI 服务
│   ├── storage.py          # SQLite/PostgreSQL 存储
│   ├── collector.py        # 数据收集 SDK
│   └── adapters/           # 平台适配器
├── dashboard/              # React 前端
│   ├── src/App.tsx         # 主界面
│   └── src/components/     # 组件
├── session_scanner.py      # Session 扫描器
├── workflow_tracer.py      # 工作流追踪 SDK
├── docs/                   # 文档
└── tests/                  # 测试
```

## 数据来源

AgentLens 支持多种数据来源：

| 来源 | 平台 | 数据内容 |
|------|------|----------|
| `~/.claude/projects/*.jsonl` | Claude Code | 完整对话、工具调用、Token 使用 |
| `~/.kimi/sessions/*/wire.jsonl` | Kimi Code | 工具调用、LLM 交互 |
| `~/.openclaw/subagents/runs.json` | OpenClaw | Subagent 执行记录 |
| SDK 手动埋点 | 任意 | 自定义追踪 |

## 使用示例

### 扫描历史 Sessions

```bash
# 单次扫描
python3 session_scanner.py

# 持续监控模式
python3 session_scanner.py --watch --interval 30
```

### SDK 手动埋点

```python
from workflow_tracer import trace_session

with trace_session("my-agent", "openclaw") as tracer:
    # 追踪工具调用
    tracer.trace_tool(
        tool_name="read_file",
        input_args={"path": "/tmp/test.txt"},
        output="文件内容",
        duration_ms=50
    )
    
    # 追踪 LLM 调用
    tracer.trace_llm(
        model="gpt-4",
        prompt="Hello",
        response="Hi there!",
        input_tokens=10,
        output_tokens=5,
        cost_usd=0.0002,
        duration_ms=1000
    )
```

## API 接口

### 写入 Trace

```bash
POST /api/v1/traces
Content-Type: application/json

{
    "trace_id": "unique-id",
    "platform": "openclaw",
    "agent_name": "my-agent",
    "model": "gpt-4",
    "prompt": "input",
    "response": "output",
    "input_tokens": 100,
    "output_tokens": 50,
    "cost_usd": 0.002,
    "tool_calls": [{"name": "tool1", "input": {}, "output": {}}],
    "status": "success"
}
```

### 查询 Traces

```bash
GET /api/v1/traces?platform=openclaw&limit=50
```

### 获取统计

```bash
GET /api/v1/stats?period_hours=24
```

## 技术栈

- **后端**: Python 3.9+, FastAPI, SQLite/PostgreSQL
- **前端**: React 18, TypeScript, Tailwind CSS
- **数据采集**: 文件扫描、SDK 埋点

## 开发状态

当前版本: v0.1.0

已实现:
- ✅ 多平台 Session 扫描 (Claude Code, Kimi Code, OpenClaw)
- ✅ SQLite 存储 + FastAPI
- ✅ React Dashboard 实时展示
- ✅ 工具调用链可视化
- ✅ Token/成本统计

进行中:
- 🔄 实时数据推送 (WebSocket)
- 🔄 更多平台适配器

## 文档

- [架构设计](docs/architecture.md)
- [数据来源说明](DATA_SOURCES.md)
- [API 文档](docs/api.md) (待完善)

## License

MIT
