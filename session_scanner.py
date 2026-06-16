"""AgentLens CLI wrapper for Claude Code session ingestion.

This script intentionally delegates to the canonical CollectorManager-based
pipeline in `src/agentlens/collectors.py`.

Use it for one-shot backfills or lightweight watch mode against local
Claude Code session logs.
"""

from __future__ import annotations

import argparse
import signal
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "src"))

from agentlens.collectors import CollectorManager
from agentlens.storage import SQLiteStorage


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Scan and watch local Claude Code session logs for AgentLens."
    )
    parser.add_argument(
        "--watch",
        action="store_true",
        help="Continuously watch local Claude Code session-log sources.",
    )
    parser.add_argument(
        "--interval",
        type=float,
        default=5.0,
        help="Polling interval in seconds when --watch is enabled (default: 5).",
    )
    parser.add_argument(
        "--db-path",
        default="~/.agentlens/agentlens.db",
        help="SQLite database path (default: ~/.agentlens/agentlens.db).",
    )
    return parser


def print_summary(manager: CollectorManager, count: int, purged: int) -> None:
    print("AgentLens Claude Code ingestion summary")
    print("-" * 40)
    print(f"Imported session records: {count}")
    print(f"Purged non-Claude rows: {purged}")
    for collector in manager.collectors:
        print(f"- {collector.get_name()}: {len(collector.get_log_paths())} source files")


def main() -> int:
    args = build_parser().parse_args()
    storage = SQLiteStorage(args.db_path)
    purged = storage.purge_non_claude_rows()
    manager = CollectorManager(storage)

    count = manager.collect_all_historical()
    print_summary(manager, count, purged)

    if not args.watch:
        return 0

    manager.start_all(interval=args.interval)
    print(f"\nWatching Claude Code session logs every {args.interval:.1f}s. Press Ctrl+C to stop.")

    def handle_signal(_sig, _frame):
        manager.stop_all()
        raise KeyboardInterrupt

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    try:
        while True:
            time.sleep(60)
    except KeyboardInterrupt:
        manager.stop_all()
        print("\nStopped AgentLens Claude Code watcher.")
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
