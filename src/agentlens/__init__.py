"""AgentLens - 轻量级 Agent 可观测平台

核心模块：
- collector: 数据收集
- storage: 数据存储
- api: REST API
"""

__version__ = "0.1.0"

from agentlens.collector import Collector, create_collector
from agentlens.storage import SQLiteStorage, JSONLStorage

__all__ = [
    "Collector",
    "create_collector",
    "SQLiteStorage",
    "JSONLStorage",
]
