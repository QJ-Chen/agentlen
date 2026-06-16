"""AgentLens package exports.

AgentLens is a local-first session intelligence toolkit for coding agents.
The canonical product path is log ingestion + storage + API + dashboard, with
SDK/manual tracing kept as a secondary compatibility path.
"""

__version__ = "0.2.0"

try:
    from agentlens.collector import Collector, create_collector
    from agentlens.storage import JSONLStorage, SQLiteStorage

    __all__ = [
        "Collector",
        "create_collector",
        "SQLiteStorage",
        "JSONLStorage",
    ]
except ImportError:
    __all__ = []
