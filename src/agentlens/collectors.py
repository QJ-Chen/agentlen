"""AgentLens collectors.

This module powers the canonical Claude Code local-log ingestion pipeline. It
supports a historical full backfill and a lighter-weight watch mode that
incrementally processes appended log lines for active session files.
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Any, Dict, List, Optional
from collections import Counter

CLAUDE_CODE_PLATFORM = "claude-code"
CLAUDE_CODE_PRICING = {"input_per_1m": 3.0, "output_per_1m": 15.0}

logger = logging.getLogger(__name__)


def calc_cost(platform: str, input_tokens: int, output_tokens: int) -> float:
    if platform != CLAUDE_CODE_PLATFORM:
        raise ValueError(f"Unsupported platform: {platform}")
    return (input_tokens / 1_000_000) * CLAUDE_CODE_PRICING["input_per_1m"] + (
        output_tokens / 1_000_000
    ) * CLAUDE_CODE_PRICING["output_per_1m"]


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
            }
        return self.sessions[session_id]

    def add_tool_outputs(self, session_id: str, tool_outputs: Dict[str, str]):
        session = self._ensure_session(session_id)
        session["tool_outputs"].update(tool_outputs)

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

        session["total_input_tokens"] += int(message.get("input_tokens") or 0)
        session["total_output_tokens"] += int(message.get("output_tokens") or 0)
        session["total_cost"] += float(message.get("cost_usd") or 0.0)

        if message.get("tool_calls"):
            session["tool_calls"].extend(message["tool_calls"])

        if message.get("role") == "user" and message.get("prompt"):
            prompt = message["prompt"]
            if not session["first_prompt"]:
                session["first_prompt"] = prompt
            session["last_user_prompt"] = prompt

        if message.get("role") == "assistant" and message.get("response"):
            session["last_response"] = message["response"]

        if message.get("role") == "assistant" and message.get("model"):
            last_user_prompt = session.get("last_user_prompt")
            session["llm_calls"].append(
                {
                    "id": message.get("trace_id"),
                    "model": message.get("model"),
                    "start_time": message.get("start_time"),
                    "input_tokens": int(message.get("input_tokens") or 0),
                    "output_tokens": int(message.get("output_tokens") or 0),
                    "prompt": last_user_prompt[:500] if last_user_prompt else None,
                    "response": (
                        message.get("response")[:1000]
                        if isinstance(message.get("response"), str)
                        else None
                    ),
                }
            )
            if len(session["llm_calls"]) > 500:
                session["llm_calls"] = session["llm_calls"][-500:]

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
            "model": session["llm_calls"][-1]["model"] if session["llm_calls"] else "unknown",
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
            "llm_calls": session["llm_calls"],
            "status": "success",
            "project_path": project_path,
            "metadata": {
                "message_count": session["message_count"],
                "llm_call_count": len(session["llm_calls"]),
                "project_group": session.get("project_group") or "",
                "major_cwd": project_path,
            },
        }

    def get_traces(self) -> List[Dict[str, Any]]:
        traces = []
        for session_id, session in self.sessions.items():
            if session["message_count"] == 0 and not session["tool_calls"]:
                continue
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
        return state["aggregator"].get_traces()

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

    def get_log_paths(self) -> List[Path]:
        base_path = Path.home() / ".claude" / "projects"
        paths: List[Path] = []
        if base_path.exists():
            for project_dir in base_path.iterdir():
                if project_dir.is_dir():
                    for session_file in project_dir.glob("*.jsonl"):
                        paths.append(session_file)
        return paths

    def _decode_path(self, encoded_name: str) -> str:
        decoded = encoded_name.replace("-", "/")
        if decoded.startswith("/"):
            decoded = decoded[1:]
        return decoded

    def create_incremental_state(self, log_path: Path) -> Dict[str, Any]:
        session_id = log_path.stem
        aggregator = SessionAggregator()
        aggregator.set_session_file_path(session_id, str(log_path))
        project_path = ""
        try:
            project_path = self._decode_path(log_path.parent.name)
        except Exception:
            project_path = ""
        return {
            "session_id": session_id,
            "project_path": project_path,
            "project_group": log_path.parent.name,
            "pending_command": {},
            "aggregator": aggregator,
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

        if isinstance(content, list):
            for item in content:
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
            if isinstance(content, str):
                response = content
            elif isinstance(content, list):
                response = "\n".join(
                    item.get("text", "") for item in content if item.get("type") == "text"
                )
                if not response:
                    tool_uses = [item for item in content if item.get("type") == "tool_use"]
                    if tool_uses:
                        response = "\n".join(
                            f"[{tool_use.get('name', 'Unknown')}] {json.dumps(tool_use.get('input', {}), ensure_ascii=False)[:200]}"
                            for tool_use in tool_uses
                        )
                if not response:
                    thinking_items = [
                        item.get("thinking", "")
                        for item in content
                        if item.get("type") == "thinking"
                    ]
                    if thinking_items:
                        response = "[thinking] " + "\n".join(thinking_items)

        if is_command_only:
            return

        cwd = data.get("cwd", "")
        msg_data = {
            "trace_id": data.get("uuid"),
            "platform": CLAUDE_CODE_PLATFORM,
            "agent_name": CLAUDE_CODE_PLATFORM,
            "session_id": state["session_id"],
            "start_time": data.get("timestamp"),
            "model": message.get("model", "unknown"),
            "role": role,
            "prompt": prompt,
            "response": response,
            "input_tokens": usage.get("input_tokens", 0),
            "output_tokens": usage.get("output_tokens", 0),
            "cost_usd": 0,
            "tool_calls": tool_calls,
            "project_path": cwd or state["project_path"],
            "major_cwd": cwd or state["project_path"],
            "project_group": state["project_group"],
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
