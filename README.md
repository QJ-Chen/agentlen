# AgentLens - 轻量级 Agent 可观测平台

为中小团队打造的轻量级 Agent 可观测工具，专注多 Agent 协作追踪与成本优化。

## 核心特性

- 🔍 **多 Agent 追踪**：可视化 Agent 间调用链
- 💰 **成本仪表盘**：实时监控 Token 消耗
- 👥 **团队视图**：模拟开发团队协作面板
- 🚨 **智能告警**：异常行为/成本突增检测
- 📊 **性能对比**：不同 Agent 配置 A/B 测试

## 快速开始

```bash
# 安装 SDK
pip install agentlens

# 自动追踪 Agent 调用
from agentlens import tracer

@tracer.trace(agent_name="Backend-Bob", role="backend_dev")
def implement_api():
    # 你的代码
    pass
```

## 项目结构

```
agentlens/
├── src/              # 核心代码
├── agents/           # Agent 配置文件
├── configs/          # 项目配置
├── tests/            # 测试
└── docs/             # 文档
```

## 开发团队模拟

6 个角色模拟真实开发团队：
- TechLead-Alex：技术负责人
- Backend-Bob：后端开发
- Frontend-Cathy：前端开发
- DevOps-David：DevOps 工程师
- QA-Emma：QA 工程师
- PM-Frank：产品经理

## 路线图

- [ ] Week 1: 基础 SDK + Trace 收集
- [ ] Week 2: 多 Agent 追踪 + 仪表盘
- [ ] Week 3: 团队模拟运行
- [ ] Week 4: 优化与文档

## License

MIT
