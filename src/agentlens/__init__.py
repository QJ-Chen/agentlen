"""AgentLens - 轻量级 Agent 可观测平台

核心模块：
- tracer: Agent 调用追踪
- collector: 数据收集
- models: 数据模型
- dashboard: 仪表盘
"""

__version__ = "0.1.0"

from agentlens.tracer import AgentTracer, trace
from agentlens.models import AgentSpan, TeamSession

__all__ = [
    "AgentTracer",
    "trace",
    "AgentSpan",
    "TeamSession",
]
