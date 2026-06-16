"""AgentLens realtime updater.

This module wraps the canonical CollectorManager-based ingestion pipeline for
background watch mode. It is intentionally lightweight: AgentLens is a local
Claude Code session-inspection tool, so this service simply keeps the SQLite
store fresh.
"""

from __future__ import annotations

import logging
import threading
import time
from typing import Any, Dict, Optional

from agentlens.collectors import CollectorManager
from agentlens.storage import SQLiteStorage

logger = logging.getLogger(__name__)


class RealtimeUpdater:
    """Background refresh service for local Claude Code session ingestion."""

    def __init__(self, storage: SQLiteStorage, interval: float = 5.0):
        self.storage = storage
        self.interval = interval
        self.manager = CollectorManager(storage)
        self.running = False
        self.thread: Optional[threading.Thread] = None

    def start(self):
        if self.running:
            return

        self.running = True
        purged = self.storage.purge_non_claude_rows()
        if purged:
            logger.info("Purged %s non-Claude trace rows", purged)
        count = self.manager.collect_all_historical()
        logger.info("Collected %s historical Claude Code session records", count)
        self.manager.start_all(interval=self.interval)
        self.thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self.thread.start()
        logger.info("Realtime updater started (interval=%ss)", self.interval)

    def stop(self):
        self.running = False
        self.manager.stop_all()
        if self.thread:
            self.thread.join(timeout=5)
            self.thread = None
        logger.info("Realtime updater stopped")

    def _heartbeat_loop(self):
        while self.running:
            time.sleep(max(self.interval, 1.0) * 12)
            logger.info("Realtime updater heartbeat: %s", self.get_status())

    def rescan(self) -> int:
        purged = self.storage.purge_non_claude_rows()
        if purged:
            logger.info("Purged %s non-Claude trace rows before rescan", purged)
        count = self.manager.collect_all_historical()
        logger.info("Manual rescan imported %s Claude Code session records", count)
        return count

    def get_status(self) -> Dict[str, Any]:
        return {
            "running": self.running,
            "interval": self.interval,
            "collectors": self.manager.get_collector_status(),
            "legacy_non_claude_rows": self.storage.count_non_claude_rows(),
        }


_updater: Optional[RealtimeUpdater] = None


def start_realtime_updater(interval: float = 5.0) -> RealtimeUpdater:
    global _updater
    if _updater is None:
        storage = SQLiteStorage()
        _updater = RealtimeUpdater(storage, interval)
        _updater.start()
    return _updater


def stop_realtime_updater():
    global _updater
    if _updater:
        _updater.stop()
        _updater = None


def get_updater_status() -> Dict[str, Any]:
    if _updater:
        return _updater.get_status()
    return {"running": False, "collectors": []}


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    )
    updater = start_realtime_updater(interval=5.0)
    try:
        while True:
            time.sleep(10)
            print(updater.get_status())
    except KeyboardInterrupt:
        stop_realtime_updater()
        print("Stopped")
