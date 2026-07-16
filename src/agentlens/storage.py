"""AgentLens storage layer.

The product is session-centric, but the current on-disk schema keeps a
backward-compatible `traces` table so existing ingestion paths keep working.
This module provides the compatibility trace APIs plus richer session/query
helpers used by the dashboard.
"""

from __future__ import annotations

import json
import re
import sqlite3
import warnings
from collections import Counter, defaultdict
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional

CLAUDE_CODE_PLATFORM = "claude-code"


def _activity_response(content_blocks: List[Dict[str, Any]]) -> Optional[str]:
    text = "\n".join(
        str(block.get("text") or "")
        for block in content_blocks
        if block.get("type") == "text" and block.get("text")
    ).strip()
    if text:
        return text[:1000]
    tools = [block for block in content_blocks if block.get("type") == "tool_use"]
    if tools:
        return "\n".join(
            f"[{block.get('name', 'Unknown')}] "
            f"{json.dumps(block.get('input', {}), ensure_ascii=False)[:200]}"
            for block in tools
        )[:1000]
    thinking = "\n".join(
        str(block.get("thinking") or "")
        for block in content_blocks
        if block.get("type") == "thinking" and block.get("thinking")
    ).strip()
    return ("[thinking] " + thinking)[:1000] if thinking else None


def _merge_activity_blocks(
    existing: List[Dict[str, Any]], new_blocks: List[Dict[str, Any]]
) -> List[Dict[str, Any]]:
    """Match the collector's parent-turn content deduplication."""
    merged = [dict(block) for block in existing]

    def key(block: Dict[str, Any]) -> tuple[Any, ...]:
        block_type = block.get("type")
        if block_type == "tool_use":
            return (block_type, block.get("id"))
        if block_type == "tool_result":
            return (
                block_type,
                block.get("tool_use_id"),
                json.dumps(block.get("content", ""), ensure_ascii=False, sort_keys=True),
            )
        if block_type == "thinking":
            return (block_type, block.get("thinking", ""))
        if block_type == "text":
            return (block_type, block.get("text", ""))
        return (block_type, json.dumps(block, ensure_ascii=False, sort_keys=True))

    positions = {key(block): index for index, block in enumerate(merged)}
    for block in new_blocks:
        block_key = key(block)
        if block_key in positions:
            if block.get("type") == "tool_use" and block.get("id"):
                merged[positions[block_key]] = dict(block)
            continue
        positions[block_key] = len(merged)
        merged.append(dict(block))
    return merged


def _activity_cost(model: Any, usage: Dict[str, Any]) -> float:
    normalized = str(model or "").lower()
    if "fable" in normalized or "mythos" in normalized:
        input_rate, output_rate = 10.0, 50.0
    elif "opus" in normalized:
        input_rate, output_rate = 5.0, 25.0
    elif "haiku" in normalized:
        input_rate, output_rate = 1.0, 5.0
    else:
        input_rate, output_rate = 3.0, 15.0
    return (
        int(usage.get("input_tokens") or 0) * input_rate
        + int(usage.get("output_tokens") or 0) * output_rate
        + int(usage.get("cache_read_input_tokens") or 0) * input_rate * 0.1
        + int(usage.get("cache_creation_input_tokens") or 0) * input_rate * 1.25
    ) / 1_000_000


def _activity_command(content: Any) -> tuple[Optional[Dict[str, str]], Optional[str]]:
    if not isinstance(content, str):
        return None, None
    name = re.search(r"<command-name>(.*?)</command-name>", content, re.DOTALL)
    if not name:
        return None, content
    args = re.search(r"<command-args>(.*?)</command-args>", content, re.DOTALL)
    message = re.search(r"<command-message>(.*?)</command-message>", content, re.DOTALL)
    command = {
        "name": name.group(1).strip(),
        "args": args.group(1).strip() if args else "",
        "message": message.group(1).strip() if message else "",
    }
    prompt = content
    for pattern in (
        r"<command-name>.*?</command-name>",
        r"<command-message>.*?</command-message>",
        r"<command-args>.*?</command-args>",
    ):
        prompt = re.sub(pattern, "", prompt, flags=re.DOTALL)
    return command, prompt.strip() or None


class Storage:
    """Storage base class."""

    def save_trace(self, trace: Dict[str, Any]):
        raise NotImplementedError

    def save_traces(self, traces: List[Dict[str, Any]]):
        for trace in traces:
            self.save_trace(trace)

    def get_traces(
        self,
        platform: Optional[str] = None,
        session_id: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: Optional[int] = 100,
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError

    def get_stats(
        self,
        period_hours: int = 24,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
    ) -> Dict[str, Any]:
        raise NotImplementedError


class SQLiteStorage(Storage):
    """SQLite-backed storage implementation."""

    def __init__(self, db_path: str = "~/.agentlens/agentlens.db"):
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    @contextmanager
    def _connect(self, *, row_factory: bool = False) -> Iterator[sqlite3.Connection]:
        """Open a short-lived configured connection and always close it."""
        conn = sqlite3.connect(self.db_path, timeout=30)
        if row_factory:
            conn.row_factory = sqlite3.Row
        try:
            conn.execute("PRAGMA foreign_keys = ON")
            conn.execute("PRAGMA busy_timeout = 30000")
            conn.execute("PRAGMA wal_autocheckpoint = 1000")
            with conn:
                yield conn
        finally:
            conn.close()

    def checkpoint(self, *, truncate: bool = False) -> tuple[int, int, int]:
        """Checkpoint committed WAL pages after large ingestion transactions."""
        mode = "TRUNCATE" if truncate else "PASSIVE"
        with self._connect() as conn:
            row = conn.execute(f"PRAGMA wal_checkpoint({mode})").fetchone()
        return tuple(int(value) for value in row)

    def _validate_platform(self, platform: Any) -> str:
        value = str(platform or CLAUDE_CODE_PLATFORM).strip().lower()
        if value != CLAUDE_CODE_PLATFORM:
            raise ValueError(f"Unsupported platform: {platform}")
        return CLAUDE_CODE_PLATFORM

    def purge_non_claude_rows(self) -> int:
        with self._connect() as conn:
            cursor = conn.execute(
                "DELETE FROM traces WHERE lower(coalesce(platform, '')) != ?",
                (CLAUDE_CODE_PLATFORM,),
            )
            return int(cursor.rowcount or 0)

    def count_non_claude_rows(self) -> int:
        with self._connect() as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) FROM traces WHERE lower(coalesce(platform, '')) != ?",
                (CLAUDE_CODE_PLATFORM,),
            )
            row = cursor.fetchone()
            return int(row[0] if row else 0)

    def _init_db(self):
        with self._connect() as conn:
            conn.execute("PRAGMA journal_mode = WAL")
            conn.execute("PRAGMA wal_autocheckpoint = 1000")
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS traces (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    trace_id TEXT UNIQUE,
                    platform TEXT,
                    agent_name TEXT,
                    session_id TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    duration_ms INTEGER,
                    model TEXT,
                    prompt TEXT,
                    response TEXT,
                    input_tokens INTEGER,
                    output_tokens INTEGER,
                    cache_read_tokens INTEGER,
                    cache_write_tokens INTEGER,
                    cache_creation_input_tokens INTEGER,
                    cache_read_input_tokens INTEGER,
                    cost_usd REAL,
                    tool_calls TEXT,
                    llm_calls TEXT,
                    status TEXT,
                    error_message TEXT,
                    project_path TEXT,
                    session_file_path TEXT,
                    role TEXT,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traces_session
                ON traces(session_id)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traces_platform
                ON traces(platform)
                """
            )
            conn.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_traces_time
                ON traces(start_time)
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS activity_nodes (
                    session_id TEXT NOT NULL,
                    node_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    sequence INTEGER NOT NULL,
                    timestamp TEXT,
                    raw_uuid TEXT,
                    parent_uuid TEXT,
                    prompt_id TEXT,
                    message_id TEXT,
                    tool_use_id TEXT,
                    source_tool_assistant_uuid TEXT,
                    source_file TEXT,
                    payload TEXT NOT NULL DEFAULT '{}',
                    PRIMARY KEY (session_id, node_id)
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS activity_edges (
                    session_id TEXT NOT NULL,
                    edge_id TEXT NOT NULL,
                    source_node_id TEXT NOT NULL,
                    target_node_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    payload TEXT NOT NULL DEFAULT '{}',
                    PRIMARY KEY (session_id, edge_id)
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_activity_nodes_page "
                "ON activity_nodes(session_id, sequence, node_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_activity_nodes_kind "
                "ON activity_nodes(session_id, kind, sequence)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_activity_nodes_uuid ON activity_nodes(raw_uuid)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_activity_edges_source "
                "ON activity_edges(session_id, source_node_id, kind)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_activity_edges_kind_source "
                "ON activity_edges(session_id, kind, source_node_id)"
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_activity_edges_target "
                "ON activity_edges(session_id, target_node_id, kind)"
            )

    def save_trace(self, trace: Dict[str, Any]):
        normalized = self._normalize_trace(trace)
        stored = self._trace_for_storage(normalized)
        with self._connect() as conn:
            self._upsert_trace(conn, stored)
            self._replace_activity_graph(conn, normalized)

    def save_traces(self, traces: List[Dict[str, Any]]):
        normalized = [self._normalize_trace(trace) for trace in traces]
        with self._connect() as conn:
            for trace in normalized:
                stored = self._trace_for_storage(trace)
                self._upsert_trace(conn, stored)
                self._replace_activity_graph(conn, trace)

    def _upsert_trace(self, conn: sqlite3.Connection, trace: Dict[str, Any]) -> None:
        columns = (
            "trace_id", "platform", "agent_name", "session_id", "start_time",
            "end_time", "duration_ms", "model", "prompt", "response",
            "input_tokens", "output_tokens", "cache_read_tokens",
            "cache_write_tokens", "cache_creation_input_tokens",
            "cache_read_input_tokens", "cost_usd", "tool_calls", "llm_calls",
            "status", "error_message", "project_path", "session_file_path",
            "role", "metadata",
        )
        mutable = columns[1:]
        assignments = ", ".join(f"{column} = excluded.{column}" for column in mutable)
        changed = " OR ".join(
            f"traces.{column} IS NOT excluded.{column}" for column in mutable
        )
        placeholders = ", ".join("?" for _ in columns)
        conn.execute(
            f"""
            INSERT INTO traces ({', '.join(columns)}) VALUES ({placeholders})
            ON CONFLICT(trace_id) DO UPDATE SET {assignments}
            WHERE {changed}
            """,
            self._trace_row_values(trace),
        )

    @staticmethod
    def _trace_for_storage(trace: Dict[str, Any]) -> Dict[str, Any]:
        """Remove compatibility detail duplicated by a complete activity graph."""
        graph = trace.get("activity_graph")
        if not isinstance(graph, dict):
            return trace
        nodes = graph.get("nodes")
        if not isinstance(nodes, list) or not any(
            isinstance(node, dict)
            and str(node.get("id") or "").startswith("event:")
            and isinstance(node.get("payload"), dict)
            and node["payload"].get("role") in {"user", "assistant"}
            and node["payload"].get("projection_version") == 1
            for node in nodes
        ):
            return trace

        stored = dict(trace)
        stored["tool_calls"] = []
        stored["llm_calls"] = []
        metadata = dict(trace.get("metadata") or {})
        subagent_logs = metadata.get("subagent_logs")
        if isinstance(subagent_logs, list):
            canonical_agent_ids = {
                str(node.get("id") or "").removeprefix("subagent:")
                for node in nodes
                if isinstance(node, dict)
                and node.get("kind") == "subagent"
                and str(node.get("id") or "").startswith("subagent:")
            }
            metadata["subagent_logs"] = [
                {
                    key: value
                    for key, value in item.items()
                    if key not in (
                        {"llm_calls", "tool_calls", "activity_graph"}
                        if str(item.get("agent_id") or "") in canonical_agent_ids
                        else {"activity_graph"}
                    )
                }
                for item in subagent_logs
                if isinstance(item, dict)
            ]
        metadata["detail_source"] = "activity-v1"
        stored["metadata"] = metadata
        return stored

    def _replace_activity_graph(
        self, conn: sqlite3.Connection, trace: Dict[str, Any]
    ) -> None:
        """Replace one session graph in the caller's transaction when supplied."""
        graph = trace.get("activity_graph")
        if not isinstance(graph, dict):
            return
        session_id = str(trace["session_id"])
        nodes = graph.get("nodes")
        edges = graph.get("edges")
        if not isinstance(nodes, list) or not isinstance(edges, list):
            raise ValueError("activity_graph must contain node and edge lists")

        conn.execute(
            "CREATE TEMP TABLE IF NOT EXISTS incoming_activity_nodes "
            "(node_id TEXT PRIMARY KEY) WITHOUT ROWID"
        )
        conn.execute(
            "CREATE TEMP TABLE IF NOT EXISTS incoming_activity_edges "
            "(edge_id TEXT PRIMARY KEY) WITHOUT ROWID"
        )
        conn.execute("DELETE FROM incoming_activity_nodes")
        conn.execute("DELETE FROM incoming_activity_edges")
        for node in nodes:
            if not isinstance(node, dict):
                raise ValueError("activity graph nodes must be objects")
            conn.execute(
                """
                INSERT INTO activity_nodes (
                    session_id, node_id, kind, sequence, timestamp, raw_uuid,
                    parent_uuid, prompt_id, message_id, tool_use_id,
                    source_tool_assistant_uuid, source_file, payload
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, node_id) DO UPDATE SET
                    kind = excluded.kind,
                    sequence = excluded.sequence,
                    timestamp = excluded.timestamp,
                    raw_uuid = excluded.raw_uuid,
                    parent_uuid = excluded.parent_uuid,
                    prompt_id = excluded.prompt_id,
                    message_id = excluded.message_id,
                    tool_use_id = excluded.tool_use_id,
                    source_tool_assistant_uuid = excluded.source_tool_assistant_uuid,
                    source_file = excluded.source_file,
                    payload = excluded.payload
                WHERE kind != excluded.kind
                   OR sequence != excluded.sequence
                   OR timestamp IS NOT excluded.timestamp
                   OR raw_uuid IS NOT excluded.raw_uuid
                   OR parent_uuid IS NOT excluded.parent_uuid
                   OR prompt_id IS NOT excluded.prompt_id
                   OR message_id IS NOT excluded.message_id
                   OR tool_use_id IS NOT excluded.tool_use_id
                   OR source_tool_assistant_uuid IS NOT excluded.source_tool_assistant_uuid
                   OR source_file IS NOT excluded.source_file
                   OR payload != excluded.payload
                """,
                (
                    session_id,
                    node["id"],
                    node["kind"],
                    int(node["sequence"]),
                    node.get("timestamp"),
                    node.get("raw_uuid"),
                    node.get("parent_uuid"),
                    node.get("prompt_id"),
                    node.get("message_id"),
                    node.get("tool_use_id"),
                    node.get("source_tool_assistant_uuid"),
                    node.get("source_file"),
                    json.dumps(node.get("payload", {}), ensure_ascii=False),
                ),
            )
            conn.execute(
                "INSERT OR IGNORE INTO incoming_activity_nodes(node_id) VALUES (?)",
                (node["id"],),
            )
        for edge in edges:
            if not isinstance(edge, dict):
                raise ValueError("activity graph edges must be objects")
            payload = {
                key: value
                for key, value in edge.items()
                if key not in {"id", "session_id", "source", "target", "kind"}
            }
            conn.execute(
                """
                INSERT INTO activity_edges (
                    session_id, edge_id, source_node_id, target_node_id, kind, payload
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id, edge_id) DO UPDATE SET
                    source_node_id = excluded.source_node_id,
                    target_node_id = excluded.target_node_id,
                    kind = excluded.kind,
                    payload = excluded.payload
                WHERE source_node_id != excluded.source_node_id
                   OR target_node_id != excluded.target_node_id
                   OR kind != excluded.kind
                   OR payload != excluded.payload
                """,
                (
                    session_id,
                    edge["id"],
                    edge["source"],
                    edge["target"],
                    edge["kind"],
                    json.dumps(payload, ensure_ascii=False),
                ),
            )
            conn.execute(
                "INSERT OR IGNORE INTO incoming_activity_edges(edge_id) VALUES (?)",
                (edge["id"],),
            )
        conn.execute(
            "DELETE FROM activity_edges WHERE session_id = ? AND edge_id NOT IN "
            "(SELECT edge_id FROM incoming_activity_edges)",
            (session_id,),
        )
        conn.execute(
            "DELETE FROM activity_nodes WHERE session_id = ? AND node_id NOT IN "
            "(SELECT node_id FROM incoming_activity_nodes)",
            (session_id,),
        )

    @staticmethod
    def _activity_node_from_row(row: sqlite3.Row) -> Dict[str, Any]:
        item = dict(row)
        item["id"] = item.pop("node_id")
        item["payload"] = json.loads(item.get("payload") or "{}")
        return item

    @staticmethod
    def _activity_edge_from_row(row: sqlite3.Row) -> Dict[str, Any]:
        item = dict(row)
        item["id"] = item.pop("edge_id")
        item["source"] = item.pop("source_node_id")
        item["target"] = item.pop("target_node_id")
        payload = json.loads(item.pop("payload") or "{}")
        item.update(payload)
        return item

    def has_activity(self, session_id: str) -> bool:
        with self._connect() as conn:
            row = conn.execute(
                "SELECT 1 FROM activity_nodes WHERE session_id = ? LIMIT 1", (session_id,)
            ).fetchone()
            return row is not None

    def get_activity_nodes(
        self,
        session_id: str,
        kind: Optional[str] = None,
        after_sequence: Optional[int] = None,
        after_node_id: Optional[str] = None,
        limit: int = 100,
    ) -> Dict[str, Any]:
        """Return a stable page ordered by the composite sequence/node cursor."""
        query = "SELECT * FROM activity_nodes WHERE session_id = ?"
        params: List[Any] = [session_id]
        if kind:
            query += " AND kind = ?"
            params.append(kind)
        if after_sequence is not None:
            query += " AND (sequence > ? OR (sequence = ? AND node_id > ?))"
            params.extend([after_sequence, after_sequence, after_node_id or ""])
        query += " ORDER BY sequence, node_id LIMIT ?"
        params.append(limit + 1)
        with self._connect(row_factory=True) as conn:
            rows = conn.execute(query, params).fetchall()
        has_more = len(rows) > limit
        page_rows = rows[:limit]
        nodes = [self._activity_node_from_row(row) for row in page_rows]
        next_cursor = None
        if has_more and nodes:
            last = nodes[-1]
            next_cursor = f"{last['sequence']}:{last['id']}"
        return {"nodes": nodes, "next_cursor": next_cursor}

    def get_activity_node(self, session_id: str, node_id: str) -> Optional[Dict[str, Any]]:
        with self._connect(row_factory=True) as conn:
            row = conn.execute(
                "SELECT * FROM activity_nodes WHERE session_id = ? AND node_id = ?",
                (session_id, node_id),
            ).fetchone()
            if row is None:
                return None
            edge_rows = conn.execute(
                """
                SELECT * FROM activity_edges
                WHERE session_id = ? AND (source_node_id = ? OR target_node_id = ?)
                ORDER BY kind, edge_id
                """,
                (session_id, node_id, node_id),
            ).fetchall()
        return {
            "node": self._activity_node_from_row(row),
            "inbound_edges": [
                self._activity_edge_from_row(edge)
                for edge in edge_rows
                if edge["target_node_id"] == node_id
            ],
            "outbound_edges": [
                self._activity_edge_from_row(edge)
                for edge in edge_rows
                if edge["source_node_id"] == node_id
            ],
        }

    def get_activity_neighborhood(
        self,
        session_id: str,
        node_id: str,
        depth: int = 1,
        direction: str = "both",
        node_limit: int = 100,
        edge_limit: int = 500,
    ) -> Optional[Dict[str, Any]]:
        """Traverse a deterministic, bounded activity neighborhood."""
        if direction not in {"inbound", "outbound", "both"}:
            raise ValueError(f"Unsupported activity direction: {direction}")
        if depth < 0 or node_limit < 1 or edge_limit < 1:
            raise ValueError("Activity neighborhood bounds must be positive")

        with self._connect(row_factory=True) as conn:
            center_row = conn.execute(
                "SELECT * FROM activity_nodes WHERE session_id = ? AND node_id = ?",
                (session_id, node_id),
            ).fetchone()
            if center_row is None:
                return None

            selected_rows: Dict[str, sqlite3.Row] = {node_id: center_row}
            selected_edges: Dict[str, sqlite3.Row] = {}
            frontier = [node_id]
            truncated = False
            depth_reached = 0

            for current_depth in range(1, depth + 1):
                if not frontier:
                    break
                placeholders = ",".join("?" for _ in frontier)
                if direction == "inbound":
                    condition = f"target_node_id IN ({placeholders})"
                    edge_params: List[Any] = [session_id, *frontier]
                elif direction == "outbound":
                    condition = f"source_node_id IN ({placeholders})"
                    edge_params = [session_id, *frontier]
                else:
                    condition = (
                        f"source_node_id IN ({placeholders}) "
                        f"OR target_node_id IN ({placeholders})"
                    )
                    edge_params = [session_id, *frontier, *frontier]

                remaining_edges = edge_limit - len(selected_edges)
                if remaining_edges <= 0:
                    truncated = True
                    break
                edge_rows = conn.execute(
                    f"""
                    SELECT * FROM activity_edges
                    WHERE session_id = ? AND ({condition})
                    ORDER BY kind, edge_id
                    LIMIT ?
                    """,
                    [*edge_params, remaining_edges + 1],
                ).fetchall()
                if len(edge_rows) > remaining_edges:
                    truncated = True
                    edge_rows = edge_rows[:remaining_edges]

                candidate_ids = set()
                for edge in edge_rows:
                    selected_edges[edge["edge_id"]] = edge
                    if direction in {"outbound", "both"} and edge["source_node_id"] in frontier:
                        candidate_ids.add(edge["target_node_id"])
                    if direction in {"inbound", "both"} and edge["target_node_id"] in frontier:
                        candidate_ids.add(edge["source_node_id"])
                candidate_ids.difference_update(selected_rows)
                if not candidate_ids:
                    depth_reached = current_depth
                    frontier = []
                    continue

                candidate_placeholders = ",".join("?" for _ in candidate_ids)
                candidate_rows = conn.execute(
                    f"""
                    SELECT * FROM activity_nodes
                    WHERE session_id = ? AND node_id IN ({candidate_placeholders})
                    ORDER BY sequence, node_id
                    """,
                    [session_id, *sorted(candidate_ids)],
                ).fetchall()
                remaining_nodes = node_limit - len(selected_rows)
                if len(candidate_rows) > remaining_nodes:
                    truncated = True
                    candidate_rows = candidate_rows[:remaining_nodes]
                frontier = []
                for row in candidate_rows:
                    selected_rows[row["node_id"]] = row
                    frontier.append(row["node_id"])
                depth_reached = current_depth
                if not frontier or len(selected_rows) >= node_limit:
                    if candidate_ids - set(frontier):
                        truncated = True
                    break

        selected_ids = set(selected_rows)
        edges = [
            self._activity_edge_from_row(edge)
            for edge in selected_edges.values()
            if edge["source_node_id"] in selected_ids
            and edge["target_node_id"] in selected_ids
        ]
        nodes = [self._activity_node_from_row(row) for row in selected_rows.values()]
        nodes.sort(key=lambda item: (item["sequence"], item["id"]))
        return {
            "center_node_id": node_id,
            "depth": depth,
            "depth_reached": depth_reached,
            "direction": direction,
            "nodes": nodes,
            "edges": edges,
            "truncated": truncated,
        }

    def get_activity_session_projection(
        self,
        session_id: str,
        *,
        llm_limit: Optional[int] = 500,
        node_prefix: str = "",
    ) -> Optional[Dict[str, Any]]:
        """Rebuild the dashboard compatibility arrays from canonical activities."""
        event_pattern = f"{node_prefix}event:%"
        with self._connect(row_factory=True) as conn:
            event_rows = conn.execute(
                """
                SELECT * FROM activity_nodes
                WHERE session_id = ? AND node_id LIKE ?
                ORDER BY sequence, node_id
                """,
                (session_id, event_pattern),
            ).fetchall()
            if not event_rows:
                return None
            content_rows = conn.execute(
                """
                SELECT edge.source_node_id, node.*
                FROM activity_edges AS edge
                JOIN activity_nodes AS node
                  ON node.session_id = edge.session_id
                 AND node.node_id = edge.target_node_id
                WHERE edge.session_id = ? AND edge.kind = 'contains'
                  AND edge.source_node_id LIKE ?
                ORDER BY edge.source_node_id, node.sequence, node.node_id
                """,
                (session_id, event_pattern),
            ).fetchall()

        events = [self._activity_node_from_row(row) for row in event_rows]
        content_by_event: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for row in content_rows:
            content_by_event[row["source_node_id"]].append(
                self._activity_node_from_row(row)
            )

        def blocks_for(event_id: str) -> List[Dict[str, Any]]:
            blocks = []
            children = content_by_event[event_id]
            children.sort(
                key=lambda node: (
                    int((node.get("payload") or {}).get("index") or 0), node["id"]
                )
            )
            for child in children:
                block = (child.get("payload") or {}).get("block")
                if isinstance(block, dict):
                    blocks.append(dict(block))
            return blocks

        message_events = [
            event
            for event in events
            if (event.get("payload") or {}).get("role") in {"user", "assistant"}
        ]
        if message_events and any(
            (event.get("payload") or {}).get("projection_version") != 1
            for event in message_events
        ):
            return None
        llm_calls: List[Dict[str, Any]] = []
        tool_calls_by_id: Dict[str, Dict[str, Any]] = {}
        tool_order: List[str] = []
        last_user_prompt: Optional[str] = None
        pending_command: Optional[Dict[str, Any]] = None
        current_turn: Optional[Dict[str, Any]] = None
        skill_tool_ids_by_name: Dict[str, List[str]] = {}

        def finish_turn() -> None:
            nonlocal current_turn
            if current_turn is None:
                return
            children = current_turn.pop("_children")
            all_blocks = current_turn.pop("_blocks")
            for index, child in enumerate(children):
                next_time = (
                    children[index + 1].get("start_time")
                    if index + 1 < len(children)
                    else current_turn.get("end_time")
                )
                duration = self._duration_from_times(child.get("start_time"), next_time)
                if duration > 0:
                    child["end_time"] = next_time
                    child["duration_ms"] = duration
            current_turn["child_records"] = children
            current_turn["child_record_count"] = len(children)
            current_turn["response"] = _activity_response(all_blocks)
            current_turn["tool_call_count"] = sum(
                1
                for tool in tool_calls_by_id.values()
                if tool.get("assistant_turn_id") == current_turn.get("id")
            )
            llm_calls.append(current_turn)
            current_turn = None

        for event in events:
            payload = event.get("payload")
            if not isinstance(payload, dict):
                raise ValueError("activity event payload must be an object")
            role = payload.get("role")
            content_blocks = blocks_for(event["id"])
            source_id = event.get("raw_uuid") or event["id"].removeprefix("event:")
            parsed_command, string_prompt = _activity_command(payload.get("content"))
            # The compatibility collector consumes pure tool-output records
            # without passing them to SessionAggregator.add_message(). They
            # therefore do not interrupt consecutive assistant records that
            # share a message id.
            is_tool_output_record = role == "user" and any(
                block.get("type") == "tool_result" and block.get("tool_use_id")
                for block in content_blocks
            ) and not any(block.get("type") == "text" for block in content_blocks)
            skill_control_record = False
            skill_context = None
            source_tool_use_id = payload.get("source_tool_use_id")
            if role == "user" and payload.get("is_meta"):
                raw_content = payload.get("content")
                candidate = (
                    raw_content.strip()
                    if isinstance(raw_content, str)
                    else "\n".join(
                        str(block.get("text") or "")
                        for block in content_blocks
                        if block.get("type") == "text"
                    ).strip()
                )
                source_tool = tool_calls_by_id.get(str(source_tool_use_id or ""))
                if candidate and (
                    candidate.startswith("Base directory for this skill:")
                    or (source_tool_use_id and source_tool and source_tool.get("name") == "Skill")
                ):
                    skill_control_record = True
                    if not candidate.lstrip().startswith("(Re-invocation of /"):
                        skill_context = candidate
            is_command_only = role == "user" and parsed_command is not None and not string_prompt
            interrupts_turn = (
                role == "user"
                and not is_tool_output_record
                and not is_command_only
                and not skill_control_record
            ) or payload.get("type") == "attachment"

            if interrupts_turn:
                finish_turn()
            if role == "user":
                if skill_control_record:
                    if source_tool_use_id and skill_context is not None:
                        tool_id = str(source_tool_use_id)
                        item = tool_calls_by_id.setdefault(tool_id, {"tool_use_id": tool_id})
                        if tool_id not in tool_order:
                            tool_order.append(tool_id)
                        item["skill_content"] = skill_context
                    continue
                prompt = string_prompt
                if prompt is None and content_blocks:
                    prompt = "\n".join(
                        str(block.get("text") or "")
                        for block in content_blocks
                        if block.get("type") == "text"
                    ).strip() or None
                if parsed_command:
                    pending_command = {
                        **parsed_command,
                        "prompt_id": event.get("prompt_id") or "",
                    }
                if prompt:
                    if pending_command and content_blocks:
                        prefix = f"[/{str(pending_command.get('name') or '').lstrip('/')}"
                        if pending_command.get("args"):
                            prefix += f" {pending_command['args']}"
                        prompt = f"{prefix}]\n{prompt}"
                    last_user_prompt = prompt
                    if not parsed_command:
                        pending_command = None
                for block in content_blocks:
                    if block.get("type") != "tool_result" or not block.get("tool_use_id"):
                        continue
                    tool_id = str(block["tool_use_id"])
                    item = tool_calls_by_id.setdefault(tool_id, {"tool_use_id": tool_id})
                    if tool_id not in tool_order:
                        tool_order.append(tool_id)
                    item["output"] = block.get("content")
                    item.setdefault("timestamp", event.get("timestamp"))
                    if block.get("is_error") is not None:
                        item["is_error"] = bool(block.get("is_error"))
                continue

            if role != "assistant" or not payload.get("model"):
                continue
            message_id = event.get("message_id")
            attribution_skill = payload.get("attribution_skill")
            attribution_tool_use_id = None
            if attribution_skill:
                matching_tools = skill_tool_ids_by_name.get(str(attribution_skill), [])
                if matching_tools:
                    attribution_tool_use_id = matching_tools[-1]
            can_merge = current_turn is not None and message_id and current_turn.get("message_id") == message_id
            command_for_record = None
            if pending_command:
                pending_id = pending_command.get("prompt_id") or ""
                if not pending_id or not event.get("prompt_id") or pending_id == event.get("prompt_id"):
                    command_for_record = {
                        key: str(pending_command.get(key) or "")
                        for key in ("name", "args", "message")
                    }
            if not can_merge:
                finish_turn()
                current_turn = {
                    "id": message_id or source_id,
                    "message_id": message_id,
                    "model": payload.get("model") or "unknown",
                    "prompt": last_user_prompt[:500] if last_user_prompt else None,
                    "prompt_id": event.get("prompt_id") or "",
                    "start_time": event.get("timestamp"),
                    "end_time": event.get("timestamp"),
                    "source_event_ids": [],
                    "record_ids": [],
                    "command": command_for_record,
                    "attribution_skill": attribution_skill,
                    "attribution_tool_use_id": attribution_tool_use_id,
                    "is_assistant_turn": True,
                    "_children": [],
                    "_blocks": [],
                }

            assert current_turn is not None
            usage = payload.get("usage") if isinstance(payload.get("usage"), dict) else {}
            token_fields = {
                "input_tokens": int(usage.get("input_tokens") or 0),
                "output_tokens": int(usage.get("output_tokens") or 0),
                "cache_read_tokens": int(usage.get("cache_read_input_tokens") or 0),
                "cache_creation_tokens": int(usage.get("cache_creation_input_tokens") or 0),
            }
            current_turn.update(token_fields)
            current_turn["cost_usd"] = _activity_cost(payload.get("model"), usage)
            current_turn["model"] = payload.get("model") or current_turn["model"]
            if attribution_skill:
                current_turn["attribution_skill"] = attribution_skill
                current_turn["attribution_tool_use_id"] = attribution_tool_use_id
            current_turn["end_time"] = event.get("timestamp") or current_turn["end_time"]
            current_turn["source_event_ids"].append(source_id)
            current_turn["record_ids"].append(source_id)
            current_turn["_blocks"] = _merge_activity_blocks(
                current_turn["_blocks"], content_blocks
            )
            child = {
                "id": source_id,
                "message_id": message_id or "",
                "assistant_turn_id": current_turn["id"],
                "source_event_ids": [source_id],
                "content_blocks": content_blocks,
                "model": payload.get("model"),
                "start_time": event.get("timestamp"),
                "end_time": event.get("timestamp"),
                **token_fields,
                "cost_usd": _activity_cost(payload.get("model"), usage),
                "prompt": last_user_prompt[:500] if last_user_prompt else None,
                "response": _activity_response(content_blocks),
                "prompt_id": event.get("prompt_id") or "",
                "command": command_for_record,
                "attribution_skill": attribution_skill,
                "attribution_tool_use_id": attribution_tool_use_id,
                "is_assistant_turn": False,
            }
            current_turn["_children"].append(child)
            if command_for_record:
                pending_command = None
            for block in content_blocks:
                if block.get("type") != "tool_use" or not block.get("id"):
                    continue
                tool_id = str(block["id"])
                item = tool_calls_by_id.setdefault(tool_id, {"tool_use_id": tool_id})
                if tool_id not in tool_order:
                    tool_order.append(tool_id)
                item.update(
                    {
                        "name": block.get("name"),
                        "input": block.get("input", {}),
                        "timestamp": event.get("timestamp"),
                        "assistant_turn_id": current_turn["id"],
                        "assistant_message_id": message_id,
                        "assistant_record_id": source_id,
                    }
                )
                if block.get("name") == "Skill":
                    skill_name = (block.get("input") or {}).get("skill")
                    if skill_name:
                        skill_tool_ids_by_name.setdefault(str(skill_name), []).append(tool_id)

        finish_turn()
        return {
            # Match SessionAggregator's bounded compatibility history. The
            # complete record remains available through activity pagination.
            "llm_calls": llm_calls[-llm_limit:] if llm_limit is not None else llm_calls,
            "tool_calls": [tool_calls_by_id[tool_id] for tool_id in tool_order],
        }

    def _project_subagent_details(
        self, session_id: str, subagent_logs: Any
    ) -> List[Dict[str, Any]]:
        """Attach canonical call histories to compact stored subagent summaries."""
        if not isinstance(subagent_logs, list):
            return []
        projected = []
        for summary in subagent_logs:
            if not isinstance(summary, dict):
                continue
            item = dict(summary)
            agent_id = str(item.get("agent_id") or "")
            detail = None
            if agent_id:
                detail = self.get_activity_session_projection(
                    session_id,
                    llm_limit=None,
                    node_prefix=f"subagent:{agent_id}:",
                )
            if detail is not None and (detail["llm_calls"] or detail["tool_calls"]):
                item["llm_calls"] = detail["llm_calls"]
                item["tool_calls"] = detail["tool_calls"]
            else:
                item.setdefault("llm_calls", [])
                item.setdefault("tool_calls", [])
            projected.append(item)
        return projected

    def get_session_conversation(
        self, session_id: str, *, limit: int = 50, before: Optional[int] = None
    ) -> Optional[Dict[str, Any]]:
        """Return a newest-first window boundary with records in display order."""
        try:
            projection = self.get_activity_session_projection(session_id, llm_limit=None)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            projection = None

        if projection is None:
            session = self.get_session(session_id, detail="full")
            if session is None:
                return None
            llm_calls = list(session.get("llm_calls") or [])
            tool_calls = list(session.get("tool_calls") or [])
            source = "legacy"
        else:
            llm_calls = list(projection["llm_calls"])
            tool_calls = list(projection["tool_calls"])
            source = "activity-v1"

        total_llm_calls = len(llm_calls)
        end = total_llm_calls if before is None else min(before, total_llm_calls)
        start = max(0, end - limit)
        page_calls = llm_calls[start:end]
        turn_ids = {
            str(call.get("id"))
            for call in page_calls
            if isinstance(call, dict) and call.get("id")
        }
        page_tools = [
            tool
            for tool in tool_calls
            if not tool.get("assistant_turn_id")
            or str(tool.get("assistant_turn_id")) in turn_ids
        ]
        return {
            "llm_calls": page_calls,
            "tool_calls": page_tools,
            "next_cursor": str(start) if start > 0 else None,
            "has_more": start > 0,
            "total_llm_calls": total_llm_calls,
            "total_tool_calls": len(tool_calls),
            "source": source,
        }

    def _trace_row_values(self, trace: Dict[str, Any]) -> tuple[Any, ...]:
        return (
            trace.get("trace_id"),
            trace.get("platform"),
            trace.get("agent_name"),
            trace.get("session_id"),
            trace.get("start_time"),
            trace.get("end_time"),
            trace.get("duration_ms"),
            trace.get("model"),
            trace.get("prompt"),
            trace.get("response"),
            trace.get("input_tokens"),
            trace.get("output_tokens"),
            trace.get("cache_read_tokens"),
            trace.get("cache_write_tokens"),
            trace.get("cache_creation_input_tokens"),
            trace.get("cache_read_input_tokens"),
            trace.get("cost_usd"),
            json.dumps(trace.get("tool_calls", []), ensure_ascii=False),
            json.dumps(trace.get("llm_calls", []), ensure_ascii=False),
            trace.get("status"),
            trace.get("error_message"),
            trace.get("project_path"),
            trace.get("session_file_path"),
            trace.get("role"),
            json.dumps(trace.get("metadata", {}), ensure_ascii=False),
        )

    def _normalize_trace(self, trace: Dict[str, Any]) -> Dict[str, Any]:
        normalized = dict(trace)
        normalized["platform"] = self._validate_platform(normalized.get("platform"))
        normalized["trace_id"] = str(
            normalized.get("trace_id")
            or normalized.get("session_id")
            or normalized.get("id")
            or f"trace_{datetime.now(timezone.utc).timestamp()}"
        )
        normalized["session_id"] = str(
            normalized.get("session_id") or normalized["trace_id"]
        )
        normalized["start_time"] = self._coerce_iso_datetime(normalized.get("start_time"))
        normalized["end_time"] = self._coerce_iso_datetime(normalized.get("end_time"))
        normalized["duration_ms"] = int(normalized.get("duration_ms") or 0)
        normalized["input_tokens"] = int(normalized.get("input_tokens") or 0)
        normalized["output_tokens"] = int(normalized.get("output_tokens") or 0)
        normalized["cache_read_tokens"] = int(normalized.get("cache_read_tokens") or 0)
        normalized["cache_write_tokens"] = int(normalized.get("cache_write_tokens") or 0)
        normalized["cache_creation_input_tokens"] = int(
            normalized.get("cache_creation_input_tokens") or 0
        )
        normalized["cache_read_input_tokens"] = int(
            normalized.get("cache_read_input_tokens") or 0
        )
        normalized["cost_usd"] = float(normalized.get("cost_usd") or 0.0)
        normalized["tool_calls"] = self._normalize_event_list(normalized.get("tool_calls", []))
        normalized["llm_calls"] = self._normalize_llm_calls(normalized.get("llm_calls", []))
        normalized["status"] = self._normalize_status(normalized.get("status"))
        normalized["error_message"] = normalized.get("error_message") or ""
        normalized["project_path"] = normalized.get("project_path") or ""
        normalized["session_file_path"] = normalized.get("session_file_path") or ""
        normalized["role"] = normalized.get("role") or ""
        normalized["metadata"] = normalized.get("metadata") or {}
        return normalized

    def _normalize_event_list(self, events: Any) -> List[Dict[str, Any]]:
        if isinstance(events, str):
            try:
                events = json.loads(events)
            except json.JSONDecodeError:
                return []
        if not isinstance(events, list):
            return []

        normalized: List[Dict[str, Any]] = []
        for event in events:
            if not isinstance(event, dict):
                continue
            item = dict(event)
            if "timestamp" in item and item["timestamp"] is not None:
                item["timestamp"] = self._coerce_iso_datetime(item["timestamp"])
            normalized.append(item)
        return normalized

    def _normalize_llm_calls(self, llm_calls: Any) -> List[Dict[str, Any]]:
        calls = self._normalize_event_list(llm_calls)
        for call in calls:
            if "start_time" in call and call["start_time"] is not None:
                call["start_time"] = self._coerce_iso_datetime(call["start_time"])
            elif "timestamp" in call and call["timestamp"] is not None:
                call["start_time"] = self._coerce_iso_datetime(call["timestamp"])
        return calls

    def _normalize_status(self, status: Any) -> str:
        value = str(status or "").strip().lower()
        if value in {"success", "completed", "ok"}:
            return "completed"
        if value in {"error", "failed", "timeout"}:
            return "failed"
        if value in {"cancelled", "canceled"}:
            return "cancelled"
        if value in {"running", "pending"}:
            return "running"
        return "completed"

    def _coerce_iso_datetime(self, value: Any) -> Optional[str]:
        if value in (None, ""):
            return None
        if isinstance(value, (int, float)):
            timestamp = float(value)
            if timestamp > 10_000_000_000:
                timestamp = timestamp / 1000.0
            return datetime.fromtimestamp(timestamp, tz=timezone.utc).isoformat()

        text = str(value).strip()
        if not text:
            return None
        if text.isdigit():
            return self._coerce_iso_datetime(float(text))
        try:
            parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed.isoformat()
        except ValueError:
            return text

    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        row_dict = dict(row)
        for field in ["tool_calls", "llm_calls", "metadata"]:
            value = row_dict.get(field)
            if not value:
                row_dict[field] = [] if field != "metadata" else {}
                continue
            try:
                row_dict[field] = json.loads(value)
            except (TypeError, json.JSONDecodeError):
                row_dict[field] = [] if field != "metadata" else {}
        row_dict["status"] = self._normalize_status(row_dict.get("status"))
        row_dict["error_message"] = row_dict.get("error_message") or ""
        row_dict["duration_ms"] = int(row_dict.get("duration_ms") or 0)
        return row_dict

    def get_traces(
        self,
        platform: Optional[str] = None,
        session_id: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: Optional[int] = 100,
    ) -> List[Dict[str, Any]]:
        query = "SELECT * FROM traces WHERE platform = ?"
        params: List[Any] = [CLAUDE_CODE_PLATFORM]

        if platform:
            query += " AND platform = ?"
            params.append(self._validate_platform(platform))
        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        if start_time:
            query += (
                " AND (COALESCE(end_time, start_time) >= ?"
                " OR (end_time IS NULL AND lower(coalesce(status, '')) IN ('running', 'pending')))"
            )
            params.append(self._coerce_iso_datetime(start_time))
        if end_time:
            query += " AND start_time <= ?"
            params.append(self._coerce_iso_datetime(end_time))

        query += " ORDER BY start_time DESC"
        if limit is not None:
            query += " LIMIT ?"
            params.append(limit)

        with self._connect(row_factory=True) as conn:
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
            return [self._row_to_dict(row) for row in rows]

    def _collapse_sessions(self, traces: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for trace in traces:
            key = str(trace.get("session_id") or trace.get("trace_id") or trace.get("id"))
            grouped[key].append(trace)

        sessions: List[Dict[str, Any]] = []
        for session_id, items in grouped.items():
            items.sort(key=lambda item: item.get("start_time") or "")
            first = items[0]
            last = items[-1]

            tool_calls: List[Dict[str, Any]] = []
            llm_calls: List[Dict[str, Any]] = []
            models: List[str] = []
            total_input = 0
            total_output = 0
            total_cost = 0.0
            statuses: List[str] = []
            prompts: List[str] = []
            responses: List[str] = []
            project_paths: List[str] = []
            file_paths: List[str] = []
            metadata_items: List[Dict[str, Any]] = []
            error_messages: List[str] = []
            search_parts: List[str] = []

            for item in items:
                tool_calls.extend(item.get("tool_calls", []))
                llm_calls.extend(item.get("llm_calls", []))
                search_parts.append(
                    json.dumps(
                        {
                            "prompt": item.get("prompt"),
                            "response": item.get("response"),
                            "tool_calls": item.get("tool_calls", []),
                            "llm_calls": item.get("llm_calls", []),
                            "metadata": item.get("metadata", {}),
                        },
                        ensure_ascii=False,
                        default=str,
                    ).lower()
                )
                if item.get("model"):
                    models.append(item["model"])
                total_input += int(item.get("input_tokens") or 0)
                total_output += int(item.get("output_tokens") or 0)
                total_cost += float(item.get("cost_usd") or 0.0)
                statuses.append(self._normalize_status(item.get("status")))
                if item.get("prompt"):
                    prompts.append(item["prompt"])
                if item.get("response"):
                    responses.append(item["response"])
                if item.get("project_path"):
                    project_paths.append(item["project_path"])
                if item.get("session_file_path"):
                    file_paths.append(item["session_file_path"])
                if item.get("metadata"):
                    metadata_items.append(item["metadata"])
                if item.get("error_message"):
                    error_messages.append(item["error_message"])

            start_time = first.get("start_time")
            end_time = last.get("end_time") or last.get("start_time")
            duration_ms = self._duration_from_times(start_time, end_time)
            if duration_ms == 0:
                duration_ms = sum(int(item.get("duration_ms") or 0) for item in items)

            status = "completed"
            if any(value == "failed" for value in statuses):
                status = "failed"
            elif any(value == "running" for value in statuses):
                status = "running"
            elif any(value == "cancelled" for value in statuses):
                status = "cancelled"

            unique_models = list(dict.fromkeys(model for model in models if model))
            metadata = {
                "trace_count": len(items),
                "tool_call_count": len(tool_calls),
                "llm_call_count": len(llm_calls),
                "models": unique_models,
            }
            for meta in metadata_items:
                for key, value in meta.items():
                    metadata.setdefault(key, value)

            major_cwd = next(
                (
                    meta.get("major_cwd")
                    for meta in metadata_items
                    if isinstance(meta.get("major_cwd"), str) and meta.get("major_cwd")
                ),
                project_paths[-1] if project_paths else "",
            )
            project_group = next(
                (
                    meta.get("project_group")
                    for meta in metadata_items
                    if isinstance(meta.get("project_group"), str) and meta.get("project_group")
                ),
                major_cwd,
            )
            metadata["project_group"] = project_group
            metadata["major_cwd"] = major_cwd

            sessions.append(
                {
                    "id": session_id,
                    "trace_id": first.get("trace_id") or session_id,
                    "session_id": session_id,
                    "platform": last.get("platform") or first.get("platform"),
                    "agent_name": last.get("agent_name") or first.get("agent_name") or "unknown",
                    "start_time": start_time,
                    "end_time": end_time,
                    "duration_ms": duration_ms,
                    "model": unique_models[-1] if unique_models else (last.get("model") or "unknown"),
                    "prompt": prompts[0] if prompts else "",
                    "response": responses[-1] if responses else "",
                    "input_tokens": total_input,
                    "output_tokens": total_output,
                    "total_tokens": total_input + total_output,
                    "cost_usd": round(total_cost, 6),
                    "tool_calls": tool_calls,
                    "llm_calls": llm_calls,
                    "status": status,
                    "error_message": error_messages[-1] if error_messages else "",
                    "project_path": major_cwd,
                    "session_file_path": file_paths[-1] if file_paths else "",
                    "metadata": metadata,
                    "created_at": last.get("created_at") or first.get("created_at"),
                    "last_updated": end_time or start_time,
                    "_search_text": "\n".join(search_parts),
                }
            )

        sessions.sort(key=lambda session: session.get("last_updated") or session.get("start_time") or "", reverse=True)
        return sessions

    def _to_light_session(self, session: Dict[str, Any]) -> Dict[str, Any]:
        metadata = session.get("metadata") or {}
        subagent_logs = metadata.get("subagent_logs") or []
        task_summary = metadata.get("task_summary") or {}
        tasks = task_summary.get("tasks") or [] if isinstance(task_summary, dict) else []
        vision_references = metadata.get("vision_references") or []

        light_metadata = {
            "trace_count": metadata.get("trace_count"),
            "tool_call_count": metadata.get("tool_call_count", len(session.get("tool_calls") or [])),
            "llm_call_count": metadata.get("llm_call_count", len(session.get("llm_calls") or [])),
            "models": metadata.get("models"),
            "project_group": metadata.get("project_group"),
            "major_cwd": metadata.get("major_cwd"),
            "recap_text": metadata.get("recap_text"),
            "subagent_count": metadata.get(
                "subagent_count",
                len(subagent_logs) if isinstance(subagent_logs, list) else 0,
            ),
            "task_count": metadata.get(
                "task_count", len(tasks) if isinstance(tasks, list) else 0
            ),
            "vision_count": metadata.get(
                "vision_count",
                len(vision_references) if isinstance(vision_references, list) else 0,
            ),
        }

        return {
            "id": session.get("id"),
            "trace_id": session.get("trace_id"),
            "session_id": session.get("session_id"),
            "platform": session.get("platform"),
            "agent_name": session.get("agent_name"),
            "start_time": session.get("start_time"),
            "end_time": session.get("end_time"),
            "duration_ms": session.get("duration_ms"),
            "model": session.get("model"),
            "prompt": session.get("prompt"),
            "response": session.get("response"),
            "input_tokens": session.get("input_tokens"),
            "output_tokens": session.get("output_tokens"),
            "total_tokens": session.get("total_tokens"),
            "cost_usd": session.get("cost_usd"),
            "tool_calls": [],
            "llm_calls": [],
            "status": session.get("status"),
            "error_message": session.get("error_message"),
            "project_path": session.get("project_path"),
            "session_file_path": session.get("session_file_path"),
            "metadata": light_metadata,
            "created_at": session.get("created_at"),
            "last_updated": session.get("last_updated"),
        }

    def _resolve_time_range(
        self,
        period_hours: Optional[int] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
    ) -> tuple[Optional[str], Optional[str]]:
        normalized_start = self._coerce_iso_datetime(start_time)
        normalized_end = self._coerce_iso_datetime(end_time)
        if normalized_start or normalized_end:
            return normalized_start, normalized_end
        if period_hours:
            return (
                (datetime.now(timezone.utc) - timedelta(hours=period_hours)).isoformat(),
                None,
            )
        return None, None

    def _duration_from_times(self, start_time: Optional[str], end_time: Optional[str]) -> int:
        if not start_time or not end_time:
            return 0
        try:
            start = datetime.fromisoformat(start_time.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_time.replace("Z", "+00:00"))
            return max(0, int((end - start).total_seconds() * 1000))
        except ValueError:
            return 0

    def _get_session_summary_rows(
        self,
        platform: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        include_search_text: bool = False,
    ) -> List[Dict[str, Any]]:
        """Read session-list fields without materializing legacy detail JSON."""
        metadata_value = "CASE WHEN json_valid(metadata) THEN metadata ELSE '{}' END"
        columns = [
            "trace_id",
            "session_id",
            "platform",
            "agent_name",
            "start_time",
            "end_time",
            "duration_ms",
            "model",
            "prompt",
            "response",
            "input_tokens",
            "output_tokens",
            "cost_usd",
            "status",
            "error_message",
            "project_path",
            "session_file_path",
            "created_at",
            f"json_extract({metadata_value}, '$.major_cwd') AS metadata_major_cwd",
            f"json_extract({metadata_value}, '$.project_group') AS metadata_project_group",
            f"json_extract({metadata_value}, '$.recap_text') AS metadata_recap_text",
            f"json_array_length(json_extract({metadata_value}, "
            "'$.subagent_logs')) AS subagent_count",
            f"json_array_length(json_extract({metadata_value}, "
            "'$.task_summary.tasks')) AS task_count",
            f"json_array_length(json_extract({metadata_value}, "
            "'$.vision_references')) AS vision_count",
            "CASE WHEN json_valid(tool_calls) THEN json_array_length(tool_calls) "
            "ELSE 0 END AS tool_call_count",
            "CASE WHEN json_valid(llm_calls) THEN json_array_length(llm_calls) "
            "ELSE 0 END AS llm_call_count",
        ]
        if include_search_text:
            columns.append(
                "lower(coalesce(prompt, '') || char(10) || coalesce(response, '') || "
                "char(10) || coalesce(tool_calls, '') || char(10) || "
                "coalesce(llm_calls, '') || char(10) || coalesce(metadata, '')) AS _search_text"
            )

        query = f"SELECT {', '.join(columns)} FROM traces WHERE platform = ?"
        params: List[Any] = [CLAUDE_CODE_PLATFORM]
        if platform:
            query += " AND platform = ?"
            params.append(self._validate_platform(platform))
        if start_time:
            query += (
                " AND (COALESCE(end_time, start_time) >= ?"
                " OR (end_time IS NULL AND lower(coalesce(status, '')) IN ('running', 'pending')))"
            )
            params.append(self._coerce_iso_datetime(start_time))
        if end_time:
            query += " AND start_time <= ?"
            params.append(self._coerce_iso_datetime(end_time))
        query += " ORDER BY start_time"

        with self._connect(row_factory=True) as conn:
            return [dict(row) for row in conn.execute(query, params).fetchall()]

    def _collapse_session_summaries(
        self, rows: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for row in rows:
            key = str(row.get("session_id") or row.get("trace_id"))
            grouped[key].append(row)

        sessions: List[Dict[str, Any]] = []
        for session_id, items in grouped.items():
            first = items[0]
            last = items[-1]
            models = list(dict.fromkeys(item["model"] for item in items if item.get("model")))
            prompts = [item["prompt"] for item in items if item.get("prompt")]
            responses = [item["response"] for item in items if item.get("response")]
            project_paths = [item["project_path"] for item in items if item.get("project_path")]
            file_paths = [
                item["session_file_path"]
                for item in items
                if item.get("session_file_path")
            ]
            statuses = [self._normalize_status(item.get("status")) for item in items]
            errors = [item["error_message"] for item in items if item.get("error_message")]
            start = first.get("start_time")
            end = last.get("end_time") or last.get("start_time")
            duration_ms = self._duration_from_times(start, end)
            if duration_ms == 0:
                duration_ms = sum(int(item.get("duration_ms") or 0) for item in items)

            status = "completed"
            if "failed" in statuses:
                status = "failed"
            elif "running" in statuses:
                status = "running"
            elif "cancelled" in statuses:
                status = "cancelled"

            major_cwd = next(
                (item["metadata_major_cwd"] for item in items if item.get("metadata_major_cwd")),
                project_paths[-1] if project_paths else "",
            )
            project_group = next(
                (
                    item["metadata_project_group"]
                    for item in items
                    if item.get("metadata_project_group")
                ),
                major_cwd,
            )
            recap_text = next(
                (item["metadata_recap_text"] for item in items if item.get("metadata_recap_text")),
                None,
            )
            total_input = sum(int(item.get("input_tokens") or 0) for item in items)
            total_output = sum(int(item.get("output_tokens") or 0) for item in items)
            sessions.append(
                {
                    "id": session_id,
                    "trace_id": first.get("trace_id") or session_id,
                    "session_id": session_id,
                    "platform": last.get("platform") or first.get("platform"),
                    "agent_name": last.get("agent_name") or first.get("agent_name") or "unknown",
                    "start_time": start,
                    "end_time": end,
                    "duration_ms": duration_ms,
                    "model": models[-1] if models else (last.get("model") or "unknown"),
                    "prompt": prompts[0] if prompts else "",
                    "response": responses[-1] if responses else "",
                    "input_tokens": total_input,
                    "output_tokens": total_output,
                    "total_tokens": total_input + total_output,
                    "cost_usd": round(sum(float(item.get("cost_usd") or 0) for item in items), 6),
                    "tool_calls": [],
                    "llm_calls": [],
                    "status": status,
                    "error_message": errors[-1] if errors else "",
                    "project_path": major_cwd,
                    "session_file_path": file_paths[-1] if file_paths else "",
                    "metadata": {
                        "trace_count": len(items),
                        "tool_call_count": sum(
                            int(item.get("tool_call_count") or 0) for item in items
                        ),
                        "llm_call_count": sum(
                            int(item.get("llm_call_count") or 0) for item in items
                        ),
                        "models": models,
                        "project_group": project_group,
                        "major_cwd": major_cwd,
                        "recap_text": recap_text,
                        "subagent_count": int(first.get("subagent_count") or 0),
                        "task_count": int(first.get("task_count") or 0),
                        "vision_count": int(first.get("vision_count") or 0),
                    },
                    "created_at": last.get("created_at") or first.get("created_at"),
                    "last_updated": end or start,
                    "_search_text": "\n".join(
                        str(item.get("_search_text") or "") for item in items
                    ),
                }
            )
        sessions.sort(
            key=lambda session: session.get("last_updated") or session.get("start_time") or "",
            reverse=True,
        )
        return sessions

    def list_sessions(
        self,
        platform: Optional[str] = None,
        project: Optional[str] = None,
        model: Optional[str] = None,
        status: Optional[str] = None,
        query: Optional[str] = None,
        period_hours: Optional[int] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 100,
        offset: int = 0,
        light: bool = False,
    ) -> Dict[str, Any]:
        effective_start_time, effective_end_time = self._resolve_time_range(
            period_hours=period_hours,
            start_time=start_time,
            end_time=end_time,
        )

        if light:
            summary_rows = self._get_session_summary_rows(
                platform=platform,
                start_time=effective_start_time,
                end_time=effective_end_time,
                include_search_text=bool(query),
            )
            sessions = self._collapse_session_summaries(summary_rows)
        else:
            raw_traces = self.get_traces(
                platform=platform,
                start_time=effective_start_time,
                end_time=effective_end_time,
                limit=None,
            )
            sessions = self._collapse_sessions(raw_traces)

        if project:
            sessions = [s for s in sessions if project.lower() in (s.get("project_path") or "").lower()]
        if model:
            sessions = [s for s in sessions if model.lower() in (s.get("model") or "").lower()]
        if status:
            wanted = self._normalize_status(status)
            sessions = [s for s in sessions if s.get("status") == wanted]
        if query:
            needle = query.lower()
            sessions = [
                s
                for s in sessions
                if needle in (s.get("session_id") or "").lower()
                or needle in (s.get("agent_name") or "").lower()
                or needle in (s.get("platform") or "").lower()
                or needle in (s.get("model") or "").lower()
                or needle in (s.get("project_path") or "").lower()
                or needle in (s.get("prompt") or "").lower()
                or needle in (s.get("response") or "").lower()
                or needle in (s.get("_search_text") or "")
            ]

        total = len(sessions)
        page = sessions[offset : offset + limit]
        for session in page:
            session.pop("_search_text", None)
        if light:
            page = [self._to_light_session(session) for session in page]
        return {
            "sessions": page,
            "count": min(limit, max(total - offset, 0)),
            "total": total,
        }

    def get_session(
        self, session_id: str, detail: str = "full"
    ) -> Optional[Dict[str, Any]]:
        if detail not in {"summary", "full"}:
            raise ValueError(f"Unsupported session detail level: {detail}")
        traces = self.get_traces(session_id=session_id, limit=None)
        sessions = self._collapse_sessions(traces)
        if not sessions:
            return None
        session = sessions[0]
        session.pop("_search_text", None)
        if detail == "full":
            try:
                projection = self.get_activity_session_projection(session_id)
            except (KeyError, TypeError, ValueError, json.JSONDecodeError):
                projection = None
            # Older or partially written graphs may not contain enough canonical
            # evidence to replace compatibility data safely.
            if (
                projection is not None
                and session.get("llm_calls")
                and not projection.get("llm_calls")
            ):
                projection = None
            if projection is not None:
                session["llm_calls"] = projection["llm_calls"]
                session["tool_calls"] = projection["tool_calls"]
                metadata = dict(session.get("metadata") or {})
                metadata["subagent_logs"] = self._project_subagent_details(
                    session_id, metadata.get("subagent_logs")
                )
                metadata["detail_source"] = "activity-v1"
                metadata["llm_call_count"] = sum(
                    int(turn.get("child_record_count") or 0)
                    for turn in projection["llm_calls"]
                    if isinstance(turn, dict)
                )
                metadata["tool_call_count"] = len(projection["tool_calls"])
                session["metadata"] = metadata
        if detail == "summary":
            metadata = dict(session.get("metadata") or {})
            subagent_logs = metadata.get("subagent_logs")
            if isinstance(subagent_logs, list):
                metadata["subagent_logs"] = [
                    {
                        key: value
                        for key, value in item.items()
                        if key not in {"llm_calls", "tool_calls"}
                    }
                    for item in subagent_logs
                    if isinstance(item, dict)
                ]
            metadata["detail_level"] = "summary"
            metadata["has_full_detail"] = bool(
                session.get("llm_calls") or session.get("tool_calls")
            )
            session["metadata"] = metadata
            session["llm_calls"] = []
            session["tool_calls"] = []
        else:
            metadata = dict(session.get("metadata") or {})
            metadata["detail_level"] = "full"
            session["metadata"] = metadata
        return session

    def _get_light_trace_rows(
        self,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        query = (
            "SELECT trace_id, session_id, platform, agent_name, start_time, end_time, "
            "duration_ms, model, input_tokens, output_tokens, cost_usd, status, "
            "project_path, metadata FROM traces WHERE platform = ?"
        )
        params: List[Any] = [CLAUDE_CODE_PLATFORM]
        if start_time:
            query += (
                " AND (COALESCE(end_time, start_time) >= ?"
                " OR (end_time IS NULL AND lower(coalesce(status, '')) IN ('running', 'pending')))"
            )
            params.append(self._coerce_iso_datetime(start_time))
        if end_time:
            query += " AND start_time <= ?"
            params.append(self._coerce_iso_datetime(end_time))
        query += " ORDER BY start_time DESC"
        if limit is not None:
            query += " LIMIT ?"
            params.append(limit)

        with self._connect(row_factory=True) as conn:
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()

        result: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            metadata = item.get("metadata")
            if metadata:
                try:
                    item["metadata"] = json.loads(metadata)
                except (TypeError, json.JSONDecodeError):
                    item["metadata"] = {}
            else:
                item["metadata"] = {}
            result.append(item)
        return result

    def get_overview_stats(
        self,
        period_hours: int = 24,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
    ) -> Dict[str, Any]:
        effective_start_time, effective_end_time = self._resolve_time_range(
            period_hours=period_hours,
            start_time=start_time,
            end_time=end_time,
        )
        rows = self._get_light_trace_rows(
            start_time=effective_start_time,
            end_time=effective_end_time,
            limit=None,
        )

        grouped: Dict[str, List[Dict[str, Any]]] = defaultdict(list)
        for row in rows:
            key = str(row.get("session_id") or row.get("trace_id"))
            grouped[key].append(row)

        sessions: List[Dict[str, Any]] = []
        for items in grouped.values():
            items.sort(key=lambda item: item.get("start_time") or "")
            first = items[0]
            last = items[-1]
            total_input = sum(int(item.get("input_tokens") or 0) for item in items)
            total_output = sum(int(item.get("output_tokens") or 0) for item in items)
            total_cost = sum(float(item.get("cost_usd") or 0.0) for item in items)
            statuses = [self._normalize_status(item.get("status")) for item in items]
            status = "completed"
            if any(value == "failed" for value in statuses):
                status = "failed"
            elif any(value == "running" for value in statuses):
                status = "running"
            elif any(value == "cancelled" for value in statuses):
                status = "cancelled"
            metadata_items = [item.get("metadata") or {} for item in items]
            llm_call_count = sum(int(meta.get("llm_call_count") or 0) for meta in metadata_items)
            tool_call_count = sum(int(meta.get("tool_call_count") or 0) for meta in metadata_items)
            top_tools_counter: Counter = Counter()
            for meta in metadata_items:
                counts = meta.get("tool_name_counts")
                if isinstance(counts, dict):
                    for name, count in counts.items():
                        top_tools_counter[name] += int(count or 0)
            start = first.get("start_time")
            end = last.get("end_time") or last.get("start_time")
            duration_ms = self._duration_from_times(start, end)
            if duration_ms == 0:
                duration_ms = sum(int(item.get("duration_ms") or 0) for item in items)
            models = [item.get("model") for item in items if item.get("model")]
            unique_models = list(dict.fromkeys(models))
            sessions.append(
                {
                    "platform": last.get("platform") or first.get("platform"),
                    "model": unique_models[-1] if unique_models else (last.get("model") or "unknown"),
                    "status": status,
                    "start_time": start,
                    "duration_ms": duration_ms,
                    "total_tokens": total_input + total_output,
                    "cost_usd": round(total_cost, 6),
                    "llm_call_count": llm_call_count,
                    "tool_call_count": tool_call_count,
                    "tool_name_counts": top_tools_counter,
                    "project_path": next(
                        (
                            meta.get("major_cwd") or meta.get("project_group")
                            for meta in reversed(metadata_items)
                            if meta.get("major_cwd") or meta.get("project_group")
                        ),
                        last.get("project_path") or first.get("project_path") or "(unknown project)",
                    ),
                }
            )

        total_tokens = sum(session["total_tokens"] for session in sessions)
        total_cost = round(sum(session["cost_usd"] for session in sessions), 4)
        avg_duration_ms = round(
            sum(session["duration_ms"] for session in sessions) / len(sessions), 2
        ) if sessions else 0.0
        total_llm_calls = sum(session["llm_call_count"] for session in sessions)
        total_tool_calls = sum(session["tool_call_count"] for session in sessions)

        platform_counter = Counter(session.get("platform") or "unknown" for session in sessions)
        model_counter = Counter(session.get("model") or "unknown" for session in sessions)
        status_counter = Counter(session.get("status") or "unknown" for session in sessions)
        tool_counter: Counter = Counter()
        for session in sessions:
            tool_counter.update(session.get("tool_name_counts") or {})
        active_days = sorted(
            {
                (session.get("start_time") or "")[:10]
                for session in sessions
                if session.get("start_time")
            }
        )

        platforms = []
        for platform, count in platform_counter.most_common():
            platform_cost = round(
                sum(session["cost_usd"] for session in sessions if session.get("platform") == platform), 4
            )
            platforms.append({"platform": platform, "count": count, "cost": platform_cost})

        models = []
        for model_name, count in model_counter.most_common():
            model_cost = round(
                sum(session["cost_usd"] for session in sessions if session.get("model") == model_name), 4
            )
            models.append({"model": model_name, "count": count, "cost": model_cost})

        top_tools = [
            {"name": name, "count": count}
            for name, count in tool_counter.most_common(10)
        ]

        return {
            "period_hours": period_hours,
            "total_sessions": len(sessions),
            "total_projects": len({session["project_path"] for session in sessions}),
            "total_traces": len(rows),
            "total_llm_calls": total_llm_calls,
            "total_tool_calls": total_tool_calls,
            "total_tokens": total_tokens,
            "total_cost": total_cost,
            "avg_duration_ms": avg_duration_ms,
            "platforms": platforms,
            "platform_counts": dict(platform_counter),
            "models": models,
            "status_counts": dict(status_counter),
            "top_tools": top_tools,
            "active_days": active_days,
        }

    def get_project_stats(
        self,
        period_hours: int = 24,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        effective_start_time, effective_end_time = self._resolve_time_range(
            period_hours=period_hours,
            start_time=start_time,
            end_time=end_time,
        )
        traces = self.get_traces(
            start_time=effective_start_time,
            end_time=effective_end_time,
            limit=None,
        )
        sessions = self._collapse_sessions(traces)

        grouped: Dict[str, Dict[str, Any]] = {}
        for session in sessions:
            project_path = session.get("project_path") or "(unknown project)"
            project = grouped.setdefault(
                project_path,
                {
                    "project_path": project_path,
                    "session_count": 0,
                    "total_cost": 0.0,
                    "total_tokens": 0,
                    "avg_duration_ms": 0.0,
                    "platforms": Counter(),
                    "models": Counter(),
                    "last_updated": session.get("last_updated") or session.get("start_time"),
                },
            )
            project["session_count"] += 1
            project["total_cost"] += session.get("cost_usd", 0.0)
            project["total_tokens"] += session.get("total_tokens", 0)
            project["avg_duration_ms"] += session.get("duration_ms", 0)
            project["platforms"][session.get("platform") or "unknown"] += 1
            project["models"][session.get("model") or "unknown"] += 1
            if (session.get("last_updated") or "") > (project.get("last_updated") or ""):
                project["last_updated"] = session.get("last_updated")

        results: List[Dict[str, Any]] = []
        for project in grouped.values():
            session_count = project["session_count"] or 1
            results.append(
                {
                    "project_path": project["project_path"],
                    "session_count": project["session_count"],
                    "total_cost": round(project["total_cost"], 4),
                    "total_tokens": project["total_tokens"],
                    "avg_duration_ms": round(project["avg_duration_ms"] / session_count, 2),
                    "platforms": dict(project["platforms"]),
                    "models": dict(project["models"]),
                    "last_updated": project["last_updated"],
                }
            )

        results.sort(key=lambda item: (item["total_cost"], item["session_count"]), reverse=True)
        return results

    def get_stats(
        self,
        period_hours: int = 24,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
    ) -> Dict[str, Any]:
        return self.get_overview_stats(
            period_hours=period_hours,
            start_time=start_time,
            end_time=end_time,
        )


class JSONLStorage(Storage):
    """Simple JSONL storage implementation kept for compatibility.

    .. deprecated::
        Nothing in the product uses this backend; ``SQLiteStorage`` is the
        canonical store. This class will be removed in a future release.
    """

    def __init__(self, file_path: str = "~/.agentlens/traces.jsonl"):
        warnings.warn(
            "JSONLStorage is deprecated and will be removed; use SQLiteStorage",
            DeprecationWarning,
            stacklevel=2,
        )
        self.file_path = Path(file_path).expanduser()
        self.file_path.parent.mkdir(parents=True, exist_ok=True)

    def _validate_platform(self, platform: Any) -> str:
        value = str(platform or CLAUDE_CODE_PLATFORM).strip().lower()
        if value != CLAUDE_CODE_PLATFORM:
            raise ValueError(f"Unsupported platform: {platform}")
        return CLAUDE_CODE_PLATFORM

    def save_trace(self, trace: Dict[str, Any]):
        trace_to_save = dict(trace)
        trace_to_save["platform"] = self._validate_platform(trace_to_save.get("platform"))
        with open(self.file_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(trace_to_save, ensure_ascii=False) + "\n")

    def save_traces(self, traces: List[Dict[str, Any]]):
        traces_to_save = []
        for trace in traces:
            trace_to_save = dict(trace)
            trace_to_save["platform"] = self._validate_platform(trace_to_save.get("platform"))
            traces_to_save.append(trace_to_save)
        with open(self.file_path, "a", encoding="utf-8") as f:
            for trace in traces_to_save:
                f.write(json.dumps(trace, ensure_ascii=False) + "\n")

    def get_traces(
        self,
        platform: Optional[str] = None,
        session_id: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: Optional[int] = 100,
    ) -> List[Dict[str, Any]]:
        traces: List[Dict[str, Any]] = []
        if not self.file_path.exists():
            return traces

        requested_platform = self._validate_platform(platform)

        with open(self.file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        for line in reversed(lines):
            if limit is not None and len(traces) >= limit:
                break
            try:
                trace = json.loads(line.strip())
            except json.JSONDecodeError:
                continue

            if str(trace.get("platform") or "").strip().lower() != requested_platform:
                continue
            if session_id and trace.get("session_id") != session_id:
                continue
            if start_time and trace.get("start_time", "") < start_time:
                continue
            if end_time and trace.get("start_time", "") > end_time:
                continue
            traces.append(trace)
        return traces

    def get_stats(
        self,
        period_hours: int = 24,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
    ) -> Dict[str, Any]:
        traces = self.get_traces(
            start_time=start_time,
            end_time=end_time,
            limit=10000,
        )
        total_cost = sum(float(t.get("cost_usd", 0) or 0) for t in traces)
        total_tokens = sum(
            int(t.get("input_tokens", 0) or 0) + int(t.get("output_tokens", 0) or 0)
            for t in traces
        )
        return {
            "period_hours": period_hours,
            "total_sessions": len(traces),
            "total_traces": len(traces),
            "total_tokens": total_tokens,
            "total_cost": round(total_cost, 4),
            "avg_duration_ms": 0,
            "platforms": [],
            "models": [],
            "status_counts": {},
            "top_tools": [],
            "active_days": [],
        }
