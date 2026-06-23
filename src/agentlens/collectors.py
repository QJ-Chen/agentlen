"""AgentLens collectors.

This module powers the canonical Claude Code local-log ingestion pipeline. It
supports a historical full backfill and a lighter-weight watch mode that
incrementally processes appended log lines for active session files.
"""

from __future__ import annotations

import json
import logging
import os
import re
import threading
import time
from abc import ABC, abstractmethod
from collections import Counter
from datetime import datetime
from pathlib import Path, PureWindowsPath
from typing import Any, Dict, List, Optional

CLAUDE_TASKS_DIR = Path.home() / ".claude" / "tasks"

CLAUDE_CODE_PLATFORM = "claude-code"
CLAUDE_CODE_PRICING = {"input_per_1m": 3.0, "output_per_1m": 15.0}

logger = logging.getLogger(__name__)


def merge_content_blocks(existing: List[Dict[str, Any]], new_blocks: Any) -> List[Dict[str, Any]]:
    merged = [dict(block) for block in existing if isinstance(block, dict)]
    if not isinstance(new_blocks, list):
        return merged

    seen_keys = set()

    def block_key(block: Dict[str, Any]) -> Any:
        block_type = block.get("type")
        if block_type == "tool_use":
            return (block_type, block.get("id"))
        if block_type == "tool_result":
            return (block_type, block.get("tool_use_id"), json.dumps(block.get("content", ""), ensure_ascii=False, sort_keys=True))
        if block_type == "thinking":
            return (block_type, block.get("thinking", ""))
        if block_type == "text":
            return (block_type, block.get("text", ""))
        return (block_type, json.dumps(block, ensure_ascii=False, sort_keys=True))

    for index, block in enumerate(merged):
        seen_keys.add(block_key(block))
        if block.get("type") == "tool_use" and block.get("id"):
            seen_keys.add(("tool_use", block.get("id")))
            merged[index] = dict(block)

    for item in new_blocks:
        if not isinstance(item, dict):
            continue
        key = block_key(item)
        if key in seen_keys:
            if item.get("type") == "tool_use" and item.get("id"):
                tool_key = ("tool_use", item.get("id"))
                for idx, existing_block in enumerate(merged):
                    if (
                        isinstance(existing_block, dict)
                        and existing_block.get("type") == "tool_use"
                        and existing_block.get("id") == item.get("id")
                    ):
                        merged[idx] = dict(item)
                        break
                seen_keys.add(tool_key)
            continue
        merged.append(dict(item))
        seen_keys.add(key)
        if item.get("type") == "tool_use" and item.get("id"):
            seen_keys.add(("tool_use", item.get("id")))

    return merged


def build_assistant_response(content: Any) -> Optional[str]:
    if isinstance(content, str):
        text = content.strip()
        return text or None
    if not isinstance(content, list):
        return None

    text_parts = [
        item.get("text", "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "text" and item.get("text")
    ]
    response = "\n".join(text_parts).strip()
    if response:
        return response

    tool_uses = [
        item for item in content if isinstance(item, dict) and item.get("type") == "tool_use"
    ]
    if tool_uses:
        return "\n".join(
            f"[{tool_use.get('name', 'Unknown')}] {json.dumps(tool_use.get('input', {}), ensure_ascii=False)[:200]}"
            for tool_use in tool_uses
        )

    thinking_items = [
        item.get("thinking", "")
        for item in content
        if isinstance(item, dict) and item.get("type") == "thinking" and item.get("thinking")
    ]
    if thinking_items:
        return "[thinking] " + "\n".join(thinking_items)
    return None


def merge_tool_calls(existing: List[Dict[str, Any]], new_calls: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    merged = [dict(call) for call in existing if isinstance(call, dict)]
    seen = {}
    for idx, call in enumerate(merged):
        tool_use_id = call.get("tool_use_id")
        name = call.get("name") or call.get("tool_name")
        key = (tool_use_id, name, "input" if call.get("input") or call.get("input_args") else "output")
        seen[key] = idx

    for call in new_calls:
        if not isinstance(call, dict):
            continue
        tool_use_id = call.get("tool_use_id")
        name = call.get("name") or call.get("tool_name")
        key = (tool_use_id, name, "input" if call.get("input") or call.get("input_args") else "output")
        if key in seen:
            merged[seen[key]] = {**merged[seen[key]], **dict(call)}
        else:
            seen[key] = len(merged)
            merged.append(dict(call))
    return merged


def calc_cost(platform: str, input_tokens: int, output_tokens: int) -> float:
    if platform != CLAUDE_CODE_PLATFORM:
        raise ValueError(f"Unsupported platform: {platform}")
    return (input_tokens / 1_000_000) * CLAUDE_CODE_PRICING["input_per_1m"] + (
        output_tokens / 1_000_000
    ) * CLAUDE_CODE_PRICING["output_per_1m"]


def parse_iso_timestamp(value: Any) -> Optional[datetime]:
    if value in (None, ""):
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None


def duration_ms_from_times(start_time: Any, end_time: Any) -> int:
    start = parse_iso_timestamp(start_time)
    end = parse_iso_timestamp(end_time)
    if not start or not end:
        return 0
    return max(0, int((end - start).total_seconds() * 1000))


def normalize_subagent_status(status: Any, has_end_time: bool) -> str:
    value = str(status or "").strip().lower()
    if value in {"completed", "success", "ok"}:
        return "completed"
    if value in {"failed", "error", "timeout"}:
        return "failed"
    if value in {"cancelled", "canceled"}:
        return "cancelled"
    return "completed" if has_end_time else "running"


def extract_user_prompt_text(content: Any) -> Optional[str]:
    if isinstance(content, str):
        text = content.strip()
        return text or None
    if isinstance(content, list):
        text_parts = [
            item.get("text", "")
            for item in content
            if isinstance(item, dict) and item.get("type") == "text" and item.get("text")
        ]
        prompt = "\n".join(text_parts).strip()
        return prompt or None
    return None


def summarize_task_tools(session_id: str, tool_calls: List[Dict[str, Any]]) -> Dict[str, Any]:
    task_dir = CLAUDE_TASKS_DIR / session_id
    summary = {
        "created": 0,
        "updated": 0,
        "listed": 0,
        "got": 0,
        "latest_statuses": [],
        "latest": None,
        "tasks": [],
        "task_source": "tool_calls",
    }

    if task_dir.exists() and task_dir.is_dir():
        tasks = []
        for task_file in sorted(task_dir.glob('*.json'), key=lambda p: int(p.stem) if p.stem.isdigit() else 10**9):
            try:
                payload = json.loads(task_file.read_text())
            except Exception:
                continue
            if not isinstance(payload, dict):
                continue
            task_id = str(payload.get('id') or task_file.stem)
            tasks.append({
                'taskId': task_id,
                'status': payload.get('status') or 'unknown',
                'subject': payload.get('subject') or '',
                'description': payload.get('description') or '',
                'activeForm': payload.get('activeForm') or '',
                'blocks': payload.get('blocks') or [],
                'blockedBy': payload.get('blockedBy') or [],
            })

        if tasks:
            summary['task_source'] = 'claude_tasks'
            summary['tasks'] = tasks
            summary['created'] = len(tasks)
            summary['updated'] = len([task for task in tasks if task.get('status') not in {'created', 'unknown'}])
            summary['latest_statuses'] = [
                {'taskId': task['taskId'], 'status': task.get('status', 'unknown')}
                for task in tasks
            ]
            summary['latest'] = tasks[-1]
            return summary

    latest_statuses: Dict[str, str] = {}
    latest_status_timestamps: Dict[str, Any] = {}
    latest_status_prompt_idxs: Dict[str, int] = {}
    latest_create: Dict[str, Dict[str, Any]] = {}
    pending_create_without_id: List[Dict[str, Any]] = []

    for tool_call in tool_calls:
        name = tool_call.get("name")
        input_data = tool_call.get("input") or {}
        if not isinstance(input_data, dict):
            input_data = {}
        if name == "TaskCreate":
            summary["created"] += 1
            output_value = tool_call.get("output")
            output_data = output_value or {}
            if not isinstance(output_data, dict):
                output_data = {}
            task_id = str(output_data.get("id") or input_data.get("taskId") or "")
            if not task_id and isinstance(output_value, str):
                match = re.search(r"Task\s+#?(\d+)\s+created successfully", output_value)
                if match:
                    task_id = match.group(1)
            subject = input_data.get("subject") or ""
            description = input_data.get("description") or ""
            create_payload = {
                "taskId": task_id,
                "subject": subject,
                "description": description,
                "created_prompt_idx": tool_call.get("prompt_idx"),
            }
            if task_id:
                latest_create[task_id] = create_payload
            elif subject or description:
                pending_create_without_id.append(create_payload)
        elif name == "TaskUpdate":
            summary["updated"] += 1
            task_id = str(input_data.get("taskId") or "")
            status = input_data.get("status")
            if task_id and isinstance(status, str):
                latest_statuses[task_id] = status
                latest_status_timestamps[task_id] = tool_call.get("timestamp")
                if tool_call.get("prompt_idx") is not None:
                    latest_status_prompt_idxs[task_id] = tool_call.get("prompt_idx")
        elif name == "TaskList":
            summary["listed"] += 1
        elif name == "TaskGet":
            summary["got"] += 1

    summary["latest_statuses"] = [
        {"taskId": task_id, "status": status}
        for task_id, status in latest_statuses.items()
    ]

    ordered_task_ids = list(dict.fromkeys([*latest_create.keys(), *latest_statuses.keys()]))
    tasks = []
    pending_create_iter = iter(pending_create_without_id)
    for task_id in ordered_task_ids:
        task = {"taskId": task_id, "status": latest_statuses.get(task_id, "created")}
        task.update(latest_create.get(task_id, {}))
        if task_id not in latest_create:
            fallback_create = next(pending_create_iter, None)
            if fallback_create:
                task.update({
                    "subject": fallback_create.get("subject", ""),
                    "description": fallback_create.get("description", ""),
                    "created_prompt_idx": fallback_create.get("created_prompt_idx"),
                })
        if task_id in latest_status_prompt_idxs:
            task["latest_status_prompt_idx"] = latest_status_prompt_idxs[task_id]
        tasks.append(task)
    summary["tasks"] = tasks

    if tasks:
        latest_task = max(
            tasks,
            key=lambda task: (
                str(latest_status_timestamps.get(task.get("taskId"), "")),
                int(task.get("taskId") or 0) if str(task.get("taskId") or "").isdigit() else -1,
            ),
        )
        summary["latest"] = latest_task

    return summary


class SessionAggregator:
    """Lightweight session aggregator.

    Keeps only the fields required to build session-centric records instead of
    holding every raw message forever. This makes watch-mode incremental state
    much cheaper to retain in memory.
    """

    def __init__(self):
        self.sessions: Dict[str, Dict[str, Any]] = {}
        self.session_file_paths: Dict[str, str] = {}

    def set_session_file_path(self, session_id: str, file_path: str):
        self.session_file_paths[session_id] = file_path

    def _ensure_session(self, session_id: str) -> Dict[str, Any]:
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                "session_id": session_id,
                "tool_calls": [],
                "tool_outputs": {},
                "llm_calls": [],
                "start_time": None,
                "end_time": None,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cost": 0.0,
                "project_path": "",
                "project_group": "",
                "cwd_counts": Counter(),
                "platform": CLAUDE_CODE_PLATFORM,
                "agent_name": CLAUDE_CODE_PLATFORM,
                "first_prompt": None,
                "last_user_prompt": None,
                "last_response": None,
                "message_count": 0,
                "assistant_turns": [],
                "current_assistant_turn": None,
                "last_role": None,
            }
        return self.sessions[session_id]

    def add_tool_outputs(self, session_id: str, tool_outputs: Dict[str, str]):
        session = self._ensure_session(session_id)
        session["tool_outputs"].update(tool_outputs)

    def _assistant_turn_tool_call_count(self, session: Dict[str, Any], turn: Dict[str, Any]) -> int:
        message_id = turn.get("message_id")
        turn_record_ids = set(turn.get("record_ids") or [])
        if message_id:
            return len(
                [
                    tool
                    for tool in session.get("tool_calls", [])
                    if isinstance(tool, dict) and tool.get("assistant_message_id") == message_id
                ]
            )
        if turn_record_ids:
            return len(
                [
                    tool
                    for tool in session.get("tool_calls", [])
                    if isinstance(tool, dict)
                    and tool.get("assistant_record_id") in turn_record_ids
                ]
            )
        return len(session.get("tool_calls", []))

    def _append_assistant_turn(self, session: Dict[str, Any], turn: Dict[str, Any]) -> None:
        child_records = [dict(record) for record in turn.get("records", []) if isinstance(record, dict)]
        if not child_records:
            session["current_assistant_turn"] = None
            return

        turn_data = {
            "id": turn.get("id"),
            "message_id": turn.get("message_id"),
            "prompt": turn.get("prompt"),
            "prompt_id": turn.get("prompt_id") or "",
            "start_time": turn.get("start_time"),
            "end_time": turn.get("end_time") or turn.get("start_time"),
            "input_tokens": int(turn.get("input_tokens") or 0),
            "output_tokens": int(turn.get("output_tokens") or 0),
            "cost_usd": float(turn.get("cost_usd") or 0.0),
            "tool_call_count": self._assistant_turn_tool_call_count(session, turn),
            "source_event_ids": list(turn.get("source_event_ids") or []),
            "record_ids": list(turn.get("record_ids") or []),
            "child_records": child_records,
            "child_record_count": len(child_records),
            "response": build_assistant_response(turn.get("content_blocks", [])),
            "is_assistant_turn": True,
        }
        if isinstance(turn_data.get("response"), str):
            turn_data["response"] = turn_data["response"][:1000]
        session["assistant_turns"].append(turn_data)
        session["total_input_tokens"] += int(turn_data.get("input_tokens") or 0)
        session["total_output_tokens"] += int(turn_data.get("output_tokens") or 0)
        session["total_cost"] += float(turn_data.get("cost_usd") or 0.0)
        session["current_assistant_turn"] = None
        if len(session["assistant_turns"]) > 500:
            session["assistant_turns"] = session["assistant_turns"][-500:]

    def _flush_assistant_turn(self, session: Dict[str, Any]) -> None:
        current_turn = session.get("current_assistant_turn")
        if current_turn:
            self._append_assistant_turn(session, current_turn)

    def add_message(self, session_id: str, message: Dict[str, Any]):
        session = self._ensure_session(session_id)
        session["message_count"] += 1

        if message.get("start_time"):
            if not session["start_time"]:
                session["start_time"] = message["start_time"]
            session["end_time"] = message["start_time"]

        major_cwd = message.get("major_cwd") or message.get("project_path") or ""
        if major_cwd:
            session["cwd_counts"][major_cwd] += 1
            session["project_path"] = major_cwd
        if message.get("project_group") and not session.get("project_group"):
            session["project_group"] = message["project_group"]
        session["platform"] = CLAUDE_CODE_PLATFORM
        session["agent_name"] = CLAUDE_CODE_PLATFORM

        role = message.get("role")
        current_turn = session.get("current_assistant_turn")
        can_merge_assistant = (
            role == "assistant"
            and current_turn is not None
            and session.get("last_role") == "assistant"
            and current_turn.get("message_id")
            and current_turn.get("message_id") == message.get("message_id")
        )

        if role != "assistant" or not can_merge_assistant:
            self._flush_assistant_turn(session)

        if role == "assistant" and message.get("model"):
            last_user_prompt = session.get("last_user_prompt")
            if can_merge_assistant:
                current_turn["source_event_ids"].append(message.get("trace_id"))
                current_turn["record_ids"].append(message.get("trace_id"))
                current_turn["content_blocks"] = merge_content_blocks(
                    current_turn.get("content_blocks", []),
                    message.get("content_blocks", []),
                )
                current_turn["input_tokens"] = int(message.get("input_tokens") or 0)
                current_turn["output_tokens"] = int(message.get("output_tokens") or 0)
                current_turn["cost_usd"] = float(message.get("cost_usd") or 0.0)
                current_turn["model"] = message.get("model") or current_turn.get("model")
                current_turn["end_time"] = message.get("start_time") or current_turn.get("end_time")
                if message.get("prompt_id"):
                    current_turn["prompt_id"] = message.get("prompt_id")
            else:
                current_turn = {
                    "id": message.get("message_id") or message.get("trace_id"),
                    "message_id": message.get("message_id"),
                    "source_event_ids": [message.get("trace_id")],
                    "record_ids": [message.get("trace_id")],
                    "model": message.get("model"),
                    "start_time": message.get("start_time"),
                    "end_time": message.get("start_time"),
                    "input_tokens": int(message.get("input_tokens") or 0),
                    "output_tokens": int(message.get("output_tokens") or 0),
                    "cost_usd": float(message.get("cost_usd") or 0.0),
                    "prompt": last_user_prompt[:500] if last_user_prompt else None,
                    "prompt_id": message.get("prompt_id") or message.get("promptId"),
                    "content_blocks": merge_content_blocks([], message.get("content_blocks", [])),
                    "records": [],
                }
                session["current_assistant_turn"] = current_turn

            response = build_assistant_response(message.get("content_blocks", []))
            if isinstance(response, str):
                response = response[:1000]
            child_record = {
                "id": message.get("trace_id"),
                "message_id": message.get("message_id") or "",
                "assistant_turn_id": current_turn.get("id"),
                "source_event_ids": [message.get("trace_id")],
                "content_blocks": merge_content_blocks([], message.get("content_blocks", [])),
                "model": message.get("model"),
                "start_time": message.get("start_time"),
                "end_time": message.get("start_time"),
                "input_tokens": int(message.get("input_tokens") or 0),
                "output_tokens": int(message.get("output_tokens") or 0),
                "cost_usd": float(message.get("cost_usd") or 0.0),
                "prompt": last_user_prompt[:500] if last_user_prompt else None,
                "response": response,
                "prompt_id": message.get("prompt_id") or message.get("promptId") or "",
                "is_assistant_turn": False,
            }
            current_turn.setdefault("records", []).append(child_record)
            session["last_response"] = response or session.get("last_response")
        else:
            session["total_input_tokens"] += int(message.get("input_tokens") or 0)
            session["total_output_tokens"] += int(message.get("output_tokens") or 0)
            session["total_cost"] += float(message.get("cost_usd") or 0.0)

        if message.get("tool_calls"):
            prompt_idx = len(session.get("assistant_turns", [])) + 1 if session.get("last_user_prompt") else None
            if role == "assistant" and current_turn is not None:
                prompt_idx = len(session.get("assistant_turns", [])) + 1 if session.get("last_user_prompt") else None
            enriched_tool_calls = []
            for tool_call in message["tool_calls"]:
                item = dict(tool_call)
                if item.get("prompt_idx") is None and prompt_idx is not None:
                    item["prompt_idx"] = prompt_idx
                if role == "assistant" and current_turn is not None:
                    item["assistant_message_id"] = current_turn.get("message_id")
                    item["assistant_turn_id"] = current_turn.get("id")
                    item["assistant_record_id"] = message.get("trace_id")
                enriched_tool_calls.append(item)
            session["tool_calls"] = merge_tool_calls(session["tool_calls"], enriched_tool_calls)

        if message.get("role") == "user" and message.get("prompt"):
            prompt = message["prompt"]
            if not session["first_prompt"]:
                session["first_prompt"] = prompt
            session["last_user_prompt"] = prompt

        session["last_role"] = role

    def _build_trace(self, session_id: str, session: Dict[str, Any]) -> Dict[str, Any]:
        tool_outputs = session.get("tool_outputs", {})
        merged_tool_calls: List[Dict[str, Any]] = []
        for tool_call in session["tool_calls"]:
            tool_call_with_output = dict(tool_call)
            tool_use_id = tool_call.get("tool_use_id")
            if tool_use_id and tool_use_id in tool_outputs and "output" not in tool_call_with_output:
                tool_call_with_output["output"] = tool_outputs[tool_use_id]
            merged_tool_calls.append(tool_call_with_output)

        cwd_counts = session.get("cwd_counts") or Counter()
        project_path = session.get("project_path") or ""
        if cwd_counts:
            project_path = cwd_counts.most_common(1)[0][0]

        return {
            "trace_id": f"session_{session_id[:20]}",
            "platform": CLAUDE_CODE_PLATFORM,
            "agent_name": CLAUDE_CODE_PLATFORM,
            "session_id": session_id,
            "session_file_path": self.session_file_paths.get(session_id, ""),
            "start_time": session["start_time"],
            "end_time": session["end_time"],
            "duration_ms": 0,
            "model": session["assistant_turns"][-1]["records"][-1]["model"] if session["assistant_turns"] and session["assistant_turns"][-1].get("records") else "unknown",
            "prompt": session.get("first_prompt"),
            "response": session.get("last_response"),
            "input_tokens": session["total_input_tokens"],
            "output_tokens": session["total_output_tokens"],
            "cost_usd": calc_cost(
                CLAUDE_CODE_PLATFORM,
                session["total_input_tokens"],
                session["total_output_tokens"],
            ),
            "tool_calls": merged_tool_calls,
            "llm_calls": session["assistant_turns"],
            "status": "success",
            "project_path": project_path,
            "metadata": {
                "message_count": session["message_count"],
                "llm_call_count": sum(turn.get("child_record_count", 0) for turn in session["assistant_turns"]),
                "project_group": session.get("project_group") or project_path,
                "major_cwd": project_path,
                "task_summary": summarize_task_tools(session_id, merged_tool_calls),
            },
        }

    def get_traces(self) -> List[Dict[str, Any]]:
        traces = []
        for session_id, session in self.sessions.items():
            if session["message_count"] == 0 and not session["tool_calls"]:
                continue
            self._flush_assistant_turn(session)
            traces.append(self._build_trace(session_id, session))
        return traces


class LogCollector(ABC):
    """Base class for local session-log collectors."""

    def __init__(self, storage):
        self.storage = storage
        self.watching = False
        self.watch_thread: Optional[threading.Thread] = None
        self.file_positions: Dict[Path, int] = {}
        self.file_states: Dict[Path, Dict[str, Any]] = {}

    @abstractmethod
    def get_name(self) -> str:
        pass

    @abstractmethod
    def get_log_paths(self) -> List[Path]:
        pass

    @abstractmethod
    def create_incremental_state(self, log_path: Path) -> Dict[str, Any]:
        pass

    @abstractmethod
    def process_line(self, state: Dict[str, Any], line: str) -> None:
        pass

    def finalize_state(self, state: Dict[str, Any]) -> List[Dict[str, Any]]:
        traces = state["aggregator"].get_traces()
        source_path = state.get("source_log_path")
        if not source_path:
            return traces
        if self._is_subagent_log(source_path):
            parent_log_path = source_path.parent.parent.with_suffix(".jsonl")
            if parent_log_path.exists():
                return self.parse_session_file(parent_log_path)
            return traces
        return self._inject_subagent_metadata(traces, source_path)

    def _consume_file(self, log_path: Path, state: Dict[str, Any], start_offset: int = 0) -> None:
        with open(log_path, "r", encoding="utf-8") as handle:
            if start_offset:
                handle.seek(start_offset)
            for line in handle:
                self.process_line(state, line)

    def parse_session_file(self, log_path: Path) -> List[Dict[str, Any]]:
        state = self.create_incremental_state(log_path)
        self._consume_file(log_path, state)
        return self.finalize_state(state)

    def _rebuild_state(self, log_path: Path) -> List[Dict[str, Any]]:
        state = self.create_incremental_state(log_path)
        self._consume_file(log_path, state)
        self.file_states[log_path] = state
        self.file_positions[log_path] = log_path.stat().st_size
        return self.finalize_state(state)

    def start_watching(self, interval: float = 1.0):
        if self.watching:
            return

        self.watching = True
        for log_path in self.get_log_paths():
            if log_path.exists():
                self.file_positions[log_path] = log_path.stat().st_size
        self.watch_thread = threading.Thread(
            target=self._watch_loop,
            args=(interval,),
            daemon=True,
        )
        self.watch_thread.start()
        logger.info("%s collector started watching", self.get_name())

    def stop_watching(self):
        self.watching = False
        if self.watch_thread:
            self.watch_thread.join(timeout=5)
            self.watch_thread = None

    def _watch_loop(self, interval: float):
        while self.watching:
            try:
                self._check_files()
            except Exception as exc:  # pragma: no cover - defensive logging path
                logger.error("Error in %s watch loop: %s", self.get_name(), exc)
            time.sleep(interval)

    def _check_files(self):
        updated_files = 0
        appended_lines_total = 0

        for log_path in self.get_log_paths():
            if not log_path.exists():
                continue

            current_size = log_path.stat().st_size
            last_position = self.file_positions.get(log_path)

            if last_position is None:
                traces = self._rebuild_state(log_path)
                if traces and self.storage:
                    self.storage.save_traces(traces)
                updated_files += 1
                continue

            if current_size < last_position:
                logger.info(
                    "%s: %s was truncated or rotated; rebuilding state",
                    self.get_name(),
                    log_path.name,
                )
                traces = self._rebuild_state(log_path)
                if traces and self.storage:
                    self.storage.save_traces(traces)
                updated_files += 1
                continue

            if current_size == last_position:
                continue

            try:
                with open(log_path, "r", encoding="utf-8") as handle:
                    handle.seek(last_position)
                    new_lines = handle.readlines()

                if not new_lines:
                    self.file_positions[log_path] = current_size
                    continue

                state = self.file_states.get(log_path)
                if state is None:
                    traces = self._rebuild_state(log_path)
                else:
                    for line in new_lines:
                        self.process_line(state, line)
                    self.file_positions[log_path] = current_size
                    traces = self.finalize_state(state)

                if traces and self.storage:
                    self.storage.save_traces(traces)
                updated_files += 1
                appended_lines_total += len(new_lines)
            except Exception as exc:
                logger.warning(
                    "%s: incremental parse failed for %s (%s); rebuilding full state",
                    self.get_name(),
                    log_path.name,
                    exc,
                )
                traces = self._rebuild_state(log_path)
                if traces and self.storage:
                    self.storage.save_traces(traces)
                updated_files += 1

        if updated_files:
            logger.info(
                "%s: incrementally updated %s files (%s appended lines)",
                self.get_name(),
                updated_files,
                appended_lines_total,
            )

    def collect_historical(self) -> List[Dict[str, Any]]:
        all_traces = []
        for log_path in self.get_log_paths():
            if not log_path.exists():
                continue
            try:
                traces = self._rebuild_state(log_path)
                all_traces.extend(traces)
            except Exception as exc:
                logger.error("Error reading %s: %s", log_path, exc)
        return all_traces


class ClaudeCodeCollector(LogCollector):
    def get_name(self) -> str:
        return CLAUDE_CODE_PLATFORM

    def _is_subagent_log(self, log_path: Path) -> bool:
        return log_path.parent.name == "subagents"

    def _parent_session_id_for_log(self, log_path: Path) -> str:
        if self._is_subagent_log(log_path):
            return log_path.parent.parent.name
        return log_path.stem

    def _encoded_project_dir_for_log(self, log_path: Path) -> Optional[Path]:
        if self._is_subagent_log(log_path):
            project_dir = log_path.parent.parent.parent
        else:
            project_dir = log_path.parent
        return project_dir if project_dir.is_dir() else None

    def _subagent_dir_for_log(self, log_path: Path) -> Optional[Path]:
        if self._is_subagent_log(log_path):
            return log_path.parent
        session_dir = log_path.with_suffix("")
        subagent_dir = session_dir / "subagents"
        if subagent_dir.exists() and subagent_dir.is_dir():
            return subagent_dir
        return None

    def _subagent_meta_path(self, log_path: Path) -> Path:
        return log_path.with_suffix("").with_suffix(".meta.json")

    def _parse_log_traces(self, log_path: Path) -> List[Dict[str, Any]]:
        state = self.create_incremental_state(log_path)
        self._consume_file(log_path, state)
        return state["aggregator"].get_traces()

    def _collect_subagent_launch_metadata(self, parent_log_path: Path) -> Dict[str, Dict[str, Any]]:
        launches: Dict[str, Dict[str, Any]] = {}
        launch_orders: Dict[str, int] = {}
        latest_user_prompt: Optional[str] = None

        try:
            with open(parent_log_path, "r", encoding="utf-8") as handle:
                for line in handle:
                    try:
                        data = json.loads(line.strip())
                    except json.JSONDecodeError:
                        continue

                    record_type = data.get("type")
                    message = data.get("message") or {}
                    if not isinstance(message, dict):
                        continue

                    if record_type == "user" and message.get("role") == "user":
                        extracted_prompt = extract_user_prompt_text(message.get("content"))
                        if extracted_prompt:
                            latest_user_prompt = extracted_prompt
                        continue

                    if record_type != "assistant":
                        continue

                    content = message.get("content") or []
                    if not isinstance(content, list):
                        continue

                    batch_id = str(message.get("id") or "")
                    launch_prompt_id = str(data.get("promptId") or "")
                    launch_timestamp = data.get("timestamp")
                    launch_order = launch_orders.get(batch_id, 0)

                    for item in content:
                        if not isinstance(item, dict):
                            continue
                        if item.get("type") != "tool_use" or item.get("name") != "Agent":
                            continue

                        tool_use_id = str(item.get("id") or "")
                        if not tool_use_id:
                            continue

                        launches[tool_use_id] = {
                            "launch_batch_id": batch_id or tool_use_id,
                            "launch_timestamp": launch_timestamp,
                            "launch_order": launch_order,
                            "launch_prompt_id": launch_prompt_id,
                            "launch_user_prompt": latest_user_prompt or "",
                        }
                        launch_order += 1

                    if batch_id:
                        launch_orders[batch_id] = launch_order
        except OSError:
            return {}

        return launches

    def _build_subagent_summary(
        self,
        parent_session_id: str,
        log_path: Path,
        launch_lookup: Dict[str, Dict[str, Any]],
    ) -> Optional[Dict[str, Any]]:
        traces = self._parse_log_traces(log_path)
        if not traces:
            return None

        trace = traces[0]
        meta_path = self._subagent_meta_path(log_path)
        meta: Dict[str, Any] = {}
        if meta_path.exists():
            try:
                payload = json.loads(meta_path.read_text())
                if isinstance(payload, dict):
                    meta = payload
            except Exception:
                meta = {}

        end_time = trace.get("end_time")
        status = normalize_subagent_status(trace.get("status"), bool(end_time))
        start_time = trace.get("start_time")
        tool_use_id = str(meta.get("toolUseId") or "")
        launch_meta = launch_lookup.get(tool_use_id, {})
        return {
            "id": log_path.stem,
            "agent_id": log_path.stem.replace("agent-", "", 1),
            "parent_session_id": parent_session_id,
            "agent_type": meta.get("agentType") or "unknown",
            "description": meta.get("description") or "",
            "tool_use_id": tool_use_id,
            "launch_batch_id": launch_meta.get("launch_batch_id") or tool_use_id,
            "launch_timestamp": launch_meta.get("launch_timestamp"),
            "launch_order": launch_meta.get("launch_order"),
            "launch_prompt_id": launch_meta.get("launch_prompt_id") or "",
            "launch_user_prompt": launch_meta.get("launch_user_prompt") or "",
            "session_file_path": str(log_path),
            "start_time": start_time,
            "end_time": end_time,
            "duration_ms": duration_ms_from_times(start_time, end_time),
            "status": status,
            "model": trace.get("model") or "unknown",
            "prompt": trace.get("prompt") or "",
            "response": trace.get("response") or "",
            "input_tokens": int(trace.get("input_tokens") or 0),
            "output_tokens": int(trace.get("output_tokens") or 0),
            "cost_usd": float(trace.get("cost_usd") or 0.0),
            "tool_calls": trace.get("tool_calls") or [],
            "llm_calls": trace.get("llm_calls") or [],
            "meta": meta,
        }

    def _collect_subagent_summaries(self, parent_log_path: Path) -> List[Dict[str, Any]]:
        parent_session_id = parent_log_path.stem
        subagent_dir = self._subagent_dir_for_log(parent_log_path)
        if not subagent_dir:
            return []

        launch_lookup = self._collect_subagent_launch_metadata(parent_log_path)
        summaries = []
        for subagent_log in sorted(subagent_dir.glob("agent-*.jsonl")):
            summary = self._build_subagent_summary(parent_session_id, subagent_log, launch_lookup)
            if summary:
                summaries.append(summary)
        return summaries

    def _inject_subagent_metadata(self, traces: List[Dict[str, Any]], parent_log_path: Path) -> List[Dict[str, Any]]:
        if self._is_subagent_log(parent_log_path):
            return traces

        subagent_logs = self._collect_subagent_summaries(parent_log_path)
        if not subagent_logs:
            return traces

        updated_traces = []
        for trace in traces:
            metadata = dict(trace.get("metadata") or {})
            metadata["subagent_logs"] = subagent_logs
            trace_with_subagents = dict(trace)
            trace_with_subagents["metadata"] = metadata
            updated_traces.append(trace_with_subagents)
        return updated_traces

    def get_log_paths(self) -> List[Path]:
        base_path = Path.home() / ".claude" / "projects"
        paths: List[Path] = []
        if base_path.exists():
            for project_dir in base_path.iterdir():
                if project_dir.is_dir():
                    for session_file in project_dir.glob("*.jsonl"):
                        paths.append(session_file)
                    for subagent_log in project_dir.glob("*/subagents/agent-*.jsonl"):
                        paths.append(subagent_log)
        return paths

    def _decode_path(self, encoded_name: str) -> str:
        parts = [part for part in encoded_name.split("-") if part]
        if not parts:
            return ""

        drive_match = re.fullmatch(r"([A-Za-z]):?", parts[0])
        if drive_match:
            drive = drive_match.group(1).upper()
            return str(PureWindowsPath(f"{drive}:/", *parts[1:]))

        if os.name == "nt":
            return str(PureWindowsPath("/", *parts))
        return "/" + "/".join(parts)

    def create_incremental_state(self, log_path: Path) -> Dict[str, Any]:
        session_id = self._parent_session_id_for_log(log_path)
        aggregator = SessionAggregator()
        session_file_path = log_path
        if self._is_subagent_log(log_path):
            session_file_path = log_path.parent.parent.with_suffix(".jsonl")
        aggregator.set_session_file_path(session_id, str(session_file_path))
        project_path = ""
        project_group = ""
        project_dir = self._encoded_project_dir_for_log(log_path)
        if project_dir is not None:
            project_group = project_dir.name
            try:
                project_path = self._decode_path(project_dir.name)
            except Exception:
                project_path = ""
        return {
            "session_id": session_id,
            "project_path": project_path,
            "project_group": project_group,
            "pending_command": {},
            "aggregator": aggregator,
            "source_log_path": log_path,
        }

    def process_line(self, state: Dict[str, Any], line: str) -> None:
        try:
            data = json.loads(line.strip())
        except json.JSONDecodeError:
            return

        msg_type = data.get("type")
        if msg_type not in ["user", "assistant"]:
            return

        message = data.get("message", {})
        role = message.get("role")
        content = message.get("content", [])
        tool_calls = []
        content_blocks = []

        if isinstance(content, list):
            content_blocks = [dict(item) for item in content if isinstance(item, dict)]
            for item in content:
                if not isinstance(item, dict):
                    continue
                if item.get("type") == "tool_use":
                    tool_calls.append(
                        {
                            "tool_use_id": item.get("id"),
                            "name": item.get("name"),
                            "input": item.get("input", {}),
                            "timestamp": data.get("timestamp"),
                        }
                    )
                elif item.get("type") == "tool_result":
                    tool_calls.append(
                        {
                            "tool_use_id": item.get("tool_use_id"),
                            "output": item.get("content"),
                            "timestamp": data.get("timestamp"),
                        }
                    )

        usage = message.get("usage", {})
        prompt = None
        response = None
        is_command_only = False
        pending_command: Dict[str, str] = state["pending_command"]

        if role == "user" and content:
            if isinstance(content, str):
                cmd_match = re.search(r"<command-name>(.*?)</command-name>", content)
                args_match = re.search(
                    r"<command-args>(.*?)</command-args>", content, re.DOTALL
                )
                if cmd_match:
                    pending_command["name"] = cmd_match.group(1).strip()
                    pending_command["args"] = (
                        args_match.group(1).strip() if args_match else ""
                    )
                    remaining = content
                    for pattern in [
                        r"<command-name>.*?</command-name>",
                        r"<command-message>.*?</command-message>",
                        r"<command-args>.*?</command-args>",
                    ]:
                        remaining = re.sub(pattern, "", remaining, flags=re.DOTALL)
                    remaining = remaining.strip()
                    if remaining:
                        prompt = remaining
                    else:
                        is_command_only = True
                else:
                    prompt = content
            elif isinstance(content, list):
                prompt = "\n".join(
                    item.get("text", "") for item in content if item.get("type") == "text"
                )

                if not prompt:
                    has_text_content = any(
                        item.get("type") == "text" for item in content
                    )
                    if not has_text_content:
                        tool_results = [
                            item for item in content if item.get("type") == "tool_result"
                        ]
                        tool_outputs = {}
                        for tool_result in tool_results:
                            tool_use_id = tool_result.get("tool_use_id")
                            output_content = tool_result.get("content", "")
                            if tool_use_id:
                                tool_outputs[tool_use_id] = output_content
                        if tool_outputs:
                            state["aggregator"].add_tool_outputs(
                                state["session_id"], tool_outputs
                            )
                        return

                if pending_command and prompt:
                    cmd_str = f"[/{pending_command.get('name', '')}"
                    if pending_command.get("args"):
                        cmd_str += f" {pending_command['args']}"
                    cmd_str += "]"
                    prompt = f"{cmd_str}\n{prompt}"
                    pending_command.clear()
        elif role == "assistant" and content:
            response = build_assistant_response(content)

        if is_command_only:
            return

        cwd = data.get("cwd", "")
        msg_data = {
            "trace_id": data.get("uuid"),
            "message_id": message.get("id"),
            "platform": CLAUDE_CODE_PLATFORM,
            "agent_name": CLAUDE_CODE_PLATFORM,
            "session_id": state["session_id"],
            "start_time": data.get("timestamp"),
            "model": message.get("model", "unknown"),
            "role": role,
            "prompt": prompt,
            "response": response,
            "content_blocks": content_blocks,
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "cost_usd": 0,
            "tool_calls": tool_calls,
            "project_path": cwd or state["project_path"],
            "major_cwd": cwd or state["project_path"],
            "project_group": state["project_group"],
            "prompt_id": data.get("promptId") or message.get("prompt_id") or message.get("promptId"),
        }
        state["aggregator"].add_message(state["session_id"], msg_data)


class CollectorManager:
    """Coordinates the Claude Code collector."""

    def __init__(self, storage):
        self.storage = storage
        self.collectors: List[LogCollector] = [ClaudeCodeCollector(storage)]

    def start_all(self, interval: float = 1.0):
        for collector in self.collectors:
            collector.start_watching(interval)

    def stop_all(self):
        for collector in self.collectors:
            collector.stop_watching()

    def collect_all_historical(self) -> int:
        all_traces = []
        for collector in self.collectors:
            traces = collector.collect_historical()
            all_traces.extend(traces)
            logger.info("%s: collected %s session traces", collector.get_name(), len(traces))

        all_traces.sort(key=lambda item: item.get("start_time", ""), reverse=True)
        if all_traces:
            self.storage.save_traces(all_traces)
        return len(all_traces)

    def get_collector_status(self) -> List[Dict[str, Any]]:
        return [
            {
                "name": collector.get_name(),
                "log_paths": [str(path) for path in collector.get_log_paths()],
                "is_watching": collector.watching,
            }
            for collector in self.collectors
        ]
