"""AgentLens storage layer.

The product is session-centric, but the current on-disk schema keeps a
backward-compatible `traces` table so existing ingestion paths keep working.
This module provides the compatibility trace APIs plus richer session/query
helpers used by the dashboard.
"""

from __future__ import annotations

import json
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

CLAUDE_CODE_PLATFORM = "claude-code"


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
        limit: int = 100,
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

    def _validate_platform(self, platform: Any) -> str:
        value = str(platform or CLAUDE_CODE_PLATFORM).strip().lower()
        if value != CLAUDE_CODE_PLATFORM:
            raise ValueError(f"Unsupported platform: {platform}")
        return CLAUDE_CODE_PLATFORM

    def purge_non_claude_rows(self) -> int:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "DELETE FROM traces WHERE lower(coalesce(platform, '')) != ?",
                (CLAUDE_CODE_PLATFORM,),
            )
            return int(cursor.rowcount or 0)

    def count_non_claude_rows(self) -> int:
        with sqlite3.connect(self.db_path) as conn:
            cursor = conn.execute(
                "SELECT COUNT(*) FROM traces WHERE lower(coalesce(platform, '')) != ?",
                (CLAUDE_CODE_PLATFORM,),
            )
            row = cursor.fetchone()
            return int(row[0] if row else 0)

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
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

    def save_trace(self, trace: Dict[str, Any]):
        normalized = self._normalize_trace(trace)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """
                INSERT OR REPLACE INTO traces (
                    trace_id, platform, agent_name, session_id,
                    start_time, end_time, duration_ms, model,
                    prompt, response, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens,
                    cache_creation_input_tokens, cache_read_input_tokens,
                    cost_usd, tool_calls, llm_calls,
                    status, error_message,
                    project_path, session_file_path, role, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                self._trace_row_values(normalized),
            )

    def save_traces(self, traces: List[Dict[str, Any]]):
        normalized = [self._normalize_trace(trace) for trace in traces]
        with sqlite3.connect(self.db_path) as conn:
            for trace in normalized:
                conn.execute(
                    """
                    INSERT OR REPLACE INTO traces (
                        trace_id, platform, agent_name, session_id,
                        start_time, end_time, duration_ms, model,
                        prompt, response, input_tokens, output_tokens,
                        cache_read_tokens, cache_write_tokens,
                        cache_creation_input_tokens, cache_read_input_tokens,
                        cost_usd, tool_calls, llm_calls,
                        status, error_message,
                        project_path, session_file_path, role, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    self._trace_row_values(trace),
                )

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
        limit: int = 100,
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
            query += " AND start_time >= ?"
            params.append(self._coerce_iso_datetime(start_time))
        if end_time:
            query += " AND start_time <= ?"
            params.append(self._coerce_iso_datetime(end_time))

        query += " ORDER BY start_time DESC LIMIT ?"
        params.append(limit)

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
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

            for item in items:
                tool_calls.extend(item.get("tool_calls", []))
                llm_calls.extend(item.get("llm_calls", []))
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
            "subagent_count": len(subagent_logs) if isinstance(subagent_logs, list) else 0,
            "task_count": len(tasks) if isinstance(tasks, list) else 0,
            "vision_count": len(vision_references) if isinstance(vision_references, list) else 0,
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

        raw_traces = self.get_traces(
            platform=platform,
            start_time=effective_start_time,
            end_time=effective_end_time,
            limit=max(limit + offset, 5000),
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
            ]

        total = len(sessions)
        page = sessions[offset : offset + limit]
        if light:
            page = [self._to_light_session(session) for session in page]
        return {
            "sessions": page,
            "count": min(limit, max(total - offset, 0)),
            "total": total,
        }

    def get_session(self, session_id: str) -> Optional[Dict[str, Any]]:
        traces = self.get_traces(session_id=session_id, limit=5000)
        sessions = self._collapse_sessions(traces)
        return sessions[0] if sessions else None

    def _get_light_trace_rows(
        self,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 50000,
    ) -> List[Dict[str, Any]]:
        query = (
            "SELECT trace_id, session_id, platform, agent_name, start_time, end_time, "
            "duration_ms, model, input_tokens, output_tokens, cost_usd, status, "
            "project_path, metadata FROM traces WHERE platform = ?"
        )
        params: List[Any] = [CLAUDE_CODE_PLATFORM]
        if start_time:
            query += " AND start_time >= ?"
            params.append(self._coerce_iso_datetime(start_time))
        if end_time:
            query += " AND start_time <= ?"
            params.append(self._coerce_iso_datetime(end_time))
        query += " ORDER BY start_time DESC LIMIT ?"
        params.append(limit)

        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
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
            limit=50000,
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
            limit=50000,
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
    """Simple JSONL storage implementation kept for compatibility."""

    def __init__(self, file_path: str = "~/.agentlens/traces.jsonl"):
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
        limit: int = 100,
    ) -> List[Dict[str, Any]]:
        traces: List[Dict[str, Any]] = []
        if not self.file_path.exists():
            return traces

        requested_platform = self._validate_platform(platform)

        with open(self.file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()

        for line in reversed(lines):
            if len(traces) >= limit:
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
