"""AgentLens realtime updater.

This module wraps the canonical CollectorManager-based ingestion pipeline for
background watch mode. It is intentionally lightweight: AgentLens is a local
Claude Code session-inspection tool, so this service simply keeps the SQLite
store fresh while letting the API become ready immediately.
"""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from agentlens.collectors import CollectorManager
from agentlens.storage import SQLiteStorage

logger = logging.getLogger(__name__)


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class RealtimeUpdater:
    """Background refresh service for local Claude Code session ingestion."""

    def __init__(self, storage: SQLiteStorage, interval: float = 5.0):
        self.storage = storage
        self.interval = interval
        self.manager = CollectorManager(storage)
        self.running = False
        self.heartbeat_thread: Optional[threading.Thread] = None
        self.job_thread: Optional[threading.Thread] = None
        self.state_lock = threading.Lock()
        self.job_lock = threading.Lock()
        self.current_job: Optional[Dict[str, Any]] = None
        self.last_job: Optional[Dict[str, Any]] = None
        self.startup_backfill_completed = False
        self.last_error = ""
        self.last_purged_rows = 0

    def start(self):
        with self.state_lock:
            if self.running:
                return
            self.running = True

        self._start_job_thread(
            job_type="startup_backfill",
            target=lambda: self._run_ingestion_job(
                job_type="startup_backfill",
                start_watch_after=True,
            ),
        )
        self.heartbeat_thread = threading.Thread(target=self._heartbeat_loop, daemon=True)
        self.heartbeat_thread.start()
        logger.info("Realtime updater scheduled startup ingest (interval=%ss)", self.interval)

    def stop(self):
        with self.state_lock:
            self.running = False
        self.manager.stop_all()
        if self.heartbeat_thread:
            self.heartbeat_thread.join(timeout=5)
            self.heartbeat_thread = None
        if self.job_thread and self.job_thread.is_alive():
            self.job_thread.join(timeout=1)
        logger.info("Realtime updater stopped")

    def _heartbeat_loop(self):
        while self.running:
            time.sleep(max(self.interval, 1.0) * 12)
            logger.info("Realtime updater heartbeat: %s", self.get_status())

    def _start_job_thread(self, job_type: str, target) -> bool:
        with self.state_lock:
            if self.job_thread and self.job_thread.is_alive():
                return False
            self.current_job = {
                "job_type": job_type,
                "job_state": "queued",
                "started_at": _utc_now_iso(),
                "finished_at": None,
                "records_imported": 0,
                "error": "",
            }
            self.job_thread = threading.Thread(target=target, daemon=True)
            self.job_thread.start()
            return True

    def _finish_current_job(
        self,
        job_state: str,
        records_imported: int = 0,
        error: str = "",
    ) -> None:
        with self.state_lock:
            if not self.current_job:
                return
            self.current_job["job_state"] = job_state
            self.current_job["finished_at"] = _utc_now_iso()
            self.current_job["records_imported"] = records_imported
            self.current_job["error"] = error
            self.last_job = dict(self.current_job)
            self.current_job = None
            self.last_error = error

    def _run_ingestion_job(self, job_type: str, start_watch_after: bool) -> None:
        with self.job_lock:
            with self.state_lock:
                if self.current_job:
                    self.current_job["job_state"] = "running"
                    self.current_job["started_at"] = _utc_now_iso()
                    self.current_job["error"] = ""
            try:
                purge = getattr(
                    self.storage, "purge_unsupported_rows", self.storage.purge_non_claude_rows
                )
                purged = purge()
                self.last_purged_rows = purged
                if purged:
                    logger.info("Purged %s unsupported trace rows", purged)

                count = self.manager.collect_all_historical()
                logger.info("%s imported %s supported session records", job_type, count)

                if start_watch_after and self.running:
                    self.manager.start_all(interval=self.interval)
                    self.startup_backfill_completed = True
                    logger.info("Started coding-agent session log watching")

                self._finish_current_job("completed", records_imported=count)
            except Exception as exc:  # pragma: no cover - defensive logging path
                logger.exception("Realtime updater %s failed", job_type)
                self._finish_current_job("failed", error=str(exc))

    def request_rescan(self) -> Dict[str, Any]:
        if not self.running:
            self.start()

        with self.state_lock:
            current_job = dict(self.current_job) if self.current_job else None
            job_running = bool(self.job_thread and self.job_thread.is_alive())
            startup_completed = self.startup_backfill_completed

        if job_running and current_job:
            return {
                "status": "busy",
                "job_type": current_job.get("job_type"),
                "job_state": current_job.get("job_state"),
            }

        if not startup_completed:
            return {
                "status": "warming_up",
                "job_type": "startup_backfill",
                "job_state": "pending",
            }

        launched = self._start_job_thread(
            job_type="manual_rescan",
            target=lambda: self._run_ingestion_job(
                job_type="manual_rescan",
                start_watch_after=False,
            ),
        )
        if not launched:
            return {
                "status": "busy",
                "job_type": "manual_rescan",
                "job_state": "queued",
            }

        return {
            "status": "accepted",
            "job_type": "manual_rescan",
            "job_state": "queued",
        }

    def get_status(self) -> Dict[str, Any]:
        with self.state_lock:
            current_job = dict(self.current_job) if self.current_job else None
            last_job = dict(self.last_job) if self.last_job else None
            running = self.running
            startup_completed = self.startup_backfill_completed
            last_error = self.last_error
            last_purged_rows = self.last_purged_rows

        watching = any(c.watching for c in self.manager.collectors)
        return {
            "running": running,
            "interval": self.interval,
            "watching": watching,
            "job_type": current_job.get("job_type") if current_job else None,
            "job_state": current_job.get("job_state") if current_job else None,
            "startup_backfill_completed": startup_completed,
            "last_error": last_error,
            "last_purged_rows": last_purged_rows,
            "current_job": current_job,
            "last_job": last_job,
            "collectors": self.manager.get_collector_status(),
            "legacy_non_claude_rows": self.storage.count_non_claude_rows(),
        }


_updater: Optional[RealtimeUpdater] = None


def start_realtime_updater(
    interval: float = 5.0,
    storage: Optional[SQLiteStorage] = None,
) -> RealtimeUpdater:
    global _updater
    if _updater is None:
        _updater = RealtimeUpdater(storage or SQLiteStorage(), interval)
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
    return {
        "running": False,
        "watching": False,
        "job_type": None,
        "job_state": None,
        "startup_backfill_completed": False,
        "collectors": [],
    }


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
