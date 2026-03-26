# AgentLens 深度工作流追踪指南

## 🎯 核心功能

AgentLens 现在支持三种观测模式：

### 1. 深度工作流追踪（推荐）
追踪 Agent 的完整工作流程，包括：
- ✅ 工具调用的完整输入输出
- ✅ LLM 请求的提示词和响应
- ✅ 执行时间和成本
- ✅ 调用链和依赖关系

### 2. 文件系统监控
无需修改代码，监控项目文件变化：
- ✅ 文件创建/修改事件
- ✅ Token 消耗估算
- ✅ 活动模式分析

### 3. 轻量级集成
简单的装饰器和函数调用：
- ✅ `@trace_tool` 装饰器
- ✅ `trace_session` 上下文管理器
- ✅ 便捷日志函数

---

## 🚀 快速开始

### 启动服务

```bash
# 1. 启动 API 服务器（已运行）
cd /Users/findai/.openclaw/workspace/projects/agentlens
PYTHONPATH=src:$PYTHONPATH python3 src/agentlens/api.py

# 2. 启动 Dashboard（已运行）
cd /Users/findai/.openclaw/workspace/projects/agentlens/dashboard
npm run dev
```

访问：
- Dashboard: http://localhost:5174
- API: http://localhost:8080

---

## 📊 使用方式

### 方式 1：深度工作流追踪

```python
from workflow_tracer import trace_session, trace_tool

# 追踪整个 Agent 会话
with trace_session("my-agent", "openclaw") as tracer:
    
    # 记录工具调用
    tracer.trace_tool(
        tool_name="read_file",
        input_args={"path": "/tmp/test.txt"},
        output="file content...",
        duration_ms=50
    )
    
    # 记录 LLM 调用
    tracer.trace_llm(
        model="claude-3-5-sonnet",
        prompt="Your prompt here...",
        response="LLM response...",
        input_tokens=500,
        output_tokens=150,
        cost_usd=0.015,
        duration_ms=2500
    )
```

### 方式 2：装饰器方式

```python
from workflow_tracer import trace_tool, trace_session

class MyAgent:
    @trace_tool("read_file")
    def read_file(self, path: str) -> str:
        with open(path, 'r') as f:
            return f.read()
    
    @trace_tool("web_search")
    def search(self, query: str) -> list:
        # 搜索逻辑
        return results

# 使用
with trace_session("my-agent"):
    agent = MyAgent()
    content = agent.read_file("/tmp/test.txt")
    results = agent.search("AI agents")
```

### 方式 3：文件系统监控

```bash
# 监控任意项目，无需修改代码
python3 project_watcher.py /path/to/your/project agent-name
```

### 方式 4：轻量级日志

```python
from workflow_tracer import log_tool_call, log_llm_call

# 快速记录工具调用
log_tool_call(
    tool_name="calculator",
    input_args={"expr": "2+2"},
    output=4,
    duration_ms=10
)

# 快速记录 LLM 调用
log_llm_call(
    model="gpt-4",
    prompt="Hello",
    response="Hi there!",
    input_tokens=10,
    output_tokens=5,
    cost_usd=0.0002
)
```

---

## 📈 Dashboard 功能

打开 http://localhost:5174 查看：

### Trace 列表
- 所有 Agent 执行记录
- 按平台筛选（OpenClaw, Claude Code, etc.）
- 状态过滤（成功/失败）

### Trace 详情
- 工具调用链
- LLM 调用记录
- 输入输出详情
- 执行时间线

### 成本分析
- 总成本统计
- 按模型分布
- 按平台分布
- 时间趋势

---

## 🔧 高级用法

### 自定义追踪器

```python
from workflow_tracer import WorkflowTracer

# 创建自定义追踪器
tracer = WorkflowTracer("custom-agent", "openclaw")
tracer.start_trace("特殊任务")

# ... 你的代码 ...

tracer.end_trace(status="success")
```

### 批量追踪

```python
from workflow_tracer import get_tracer

# 获取当前追踪器
tracer = get_tracer()

# 批量记录
for item in items:
    tracer.trace_tool(f"process_{item.id}", {...}, result, duration)
```

### 错误追踪

```python
with trace_session("my-agent") as tracer:
    try:
        result = risky_operation()
    except Exception as e:
        # 自动记录错误
        tracer.trace_tool(
            tool_name="risky_operation",
            input_args={},
            output=None,
            duration_ms=0,
            error=str(e)
        )
        raise
```

---

## 📊 API 端点

```bash
# 获取统计
curl http://localhost:8080/api/v1/stats

# 获取 Traces
curl "http://localhost:8080/api/v1/traces?limit=10"

# 提交 Trace
curl -X POST http://localhost:8080/api/v1/traces \
  -H "Content-Type: application/json" \
  -d '{
    "trace_id": "abc123",
    "platform": "openclaw",
    "agent_name": "my-agent",
    "model": "gpt-4",
    "prompt": "test",
    "response": "result",
    "input_tokens": 10,
    "output_tokens": 5,
    "cost_usd": 0.0002
  }'
```

---

## 💡 最佳实践

1. **命名规范**
   - Agent 名称：使用小写和连字符（如 `research-assistant`）
   - 工具名称：使用动词+名词（如 `read_file`, `search_web`）

2. **Token 估算**
   - 英文：1 token ≈ 4 字符
   - 中文：1 token ≈ 1-2 字符
   - 代码：根据语言不同

3. **成本控制**
   - 设置预算上限
   - 监控高频调用
   - 优化提示词长度

4. **性能优化**
   - 异步发送追踪数据
   - 批量处理减少 API 调用
   - 失败时静默处理

---

## 🐛 故障排除

**Dashboard 无法访问**
```bash
# 检查服务状态
curl http://localhost:8080/api/v1/stats

# 重启 Dashboard
cd dashboard && npm run dev
```

**数据未显示**
```bash
# 检查 API 连接
curl http://localhost:8080/api/v1/traces

# 确认追踪器配置
print(tracer.agent_name, tracer.platform)
```

**性能问题**
- 减少追踪频率
- 使用批量发送
- 过滤不必要的工具

---

## 📚 示例文件

- `workflow_tracer.py` - 核心追踪库
- `openclaw_example.py` - 完整示例
- `project_watcher.py` - 文件监控
- `agentlens_observer.py` - Claude Code 集成

运行示例：
```bash
python3 openclaw_example.py
```

---

## 🎉 完成！

AgentLens 现在可以：
- ✅ 深度追踪 Agent 工作流
- ✅ 监控工具调用和 LLM 请求
- ✅ 实时显示在 Dashboard
- ✅ 分析成本和性能

查看 Dashboard: http://localhost:5174
