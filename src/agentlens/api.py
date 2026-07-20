"""AgentLens API server.

The product is session-centric: the API exposes session list/detail and
analytics endpoints, while keeping the older trace ingestion/query routes
for compatibility with existing Claude Code collectors and SDK-style integrations.
"""

from __future__ import annotations

import logging
import os
import json
import re
import shutil
import subprocess
import sys
import time
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional, Tuple

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agentlens.realtime import RealtimeUpdater
from agentlens.storage import CLAUDE_CODE_PLATFORM, SUPPORTED_PLATFORMS, SQLiteStorage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    """Start background ingestion on boot and stop it on shutdown."""
    global realtime_updater
    realtime_updater = RealtimeUpdater(storage, interval=5.0)
    realtime_updater.start()
    logger.info("Scheduled background Claude Code ingestion warmup")
    yield
    if realtime_updater:
        realtime_updater.stop()
        realtime_updater = None
        logger.info("Stopped Claude Code session log watching")


app = FastAPI(title="AgentLens API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage = SQLiteStorage()
realtime_updater: Optional[RealtimeUpdater] = None
CLAUDE_ROOT = Path.home() / ".claude"
PROJECTS_ROOT = CLAUDE_ROOT / "projects"
TASKS_ROOT = CLAUDE_ROOT / "tasks"

_CACHE_TTL_SECONDS = 5.0
_response_cache: Dict[str, Tuple[float, Any]] = {}


def _cached(key: str, builder):
    now = time.monotonic()
    cached = _response_cache.get(key)
    if cached and (now - cached[0]) < _CACHE_TTL_SECONDS:
        return cached[1]
    value = builder()
    _response_cache[key] = (now, value)
    return value


def _encode_project_path(project_path: str) -> str:
    return re.sub(r"[/\\]+", "-", project_path.strip())


def _safe_read_text(path: Path, max_chars: int = 4000) -> str:
    try:
        return path.read_text(encoding="utf-8")[:max_chars]
    except OSError:
        return ""


def _safe_read_full_text(path: Path, max_chars: int = 200_000) -> str:
    try:
        return path.read_text(encoding="utf-8")[:max_chars]
    except OSError:
        return ""


def _safe_json_load(path: Path) -> Optional[Dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    return payload if isinstance(payload, dict) else None


def _summarize_settings_local(path: Path) -> Dict[str, Any]:
    payload = _safe_json_load(path) or {}
    permissions = payload.get("permissions") if isinstance(payload.get("permissions"), dict) else {}
    allow_rules = permissions.get("allow") if isinstance(permissions.get("allow"), list) else []
    string_rules = [rule for rule in allow_rules if isinstance(rule, str)]
    return {
        "exists": path.exists(),
        "path": str(path),
        "modified_at": path.stat().st_mtime if path.exists() else None,
        "allow_rule_count": len(string_rules),
        "allow_rules_preview": string_rules[:12],
        "content": _safe_read_full_text(path) if path.exists() else "",
    }


def _summarize_claude_md(path: Path) -> Dict[str, Any]:
    text = _safe_read_text(path, max_chars=200_000)
    lines = [line.rstrip() for line in text.splitlines()]
    preview = "\n".join(lines)
    return {
        "exists": path.exists(),
        "path": str(path),
        "modified_at": path.stat().st_mtime if path.exists() else None,
        "preview": preview,
    }


def _summarize_memory(memory_dir: Path) -> Dict[str, Any]:
    memory_index = memory_dir / "MEMORY.md"
    notes = []
    if memory_dir.exists():
        for note_path in sorted(memory_dir.glob("*.md")):
            if note_path.name == "MEMORY.md":
                continue
            text = _safe_read_text(note_path, max_chars=1200)
            full_text = _safe_read_full_text(note_path)
            lines = [line.strip() for line in text.splitlines() if line.strip()]
            description = ""
            for line in lines:
                if line.startswith("description:"):
                    description = line.split(":", 1)[1].strip().strip('"')
                    break
            preview = "\n".join(lines[:8])
            notes.append(
                {
                    "name": note_path.stem,
                    "path": str(note_path),
                    "modified_at": note_path.stat().st_mtime,
                    "description": description,
                    "preview": preview,
                    "content": full_text,
                }
            )
    return {
        "exists": memory_dir.exists(),
        "path": str(memory_dir),
        "index_exists": memory_index.exists(),
        "index_path": str(memory_index),
        "index_preview": _safe_read_text(memory_index, max_chars=2000),
        "note_count": len(notes),
        "notes": notes,
    }


def _read_skill_summaries(skills_dir: Path) -> List[Dict[str, Any]]:
    if not skills_dir.exists() or not skills_dir.is_dir():
        return []

    skills: List[Dict[str, Any]] = []
    for skill_dir in sorted(skills_dir.iterdir()):
        if not skill_dir.is_dir():
            continue
        skill_doc = skill_dir / "SKILL.md"
        content = _safe_read_text(skill_doc, max_chars=4000) if skill_doc.exists() else ""
        description = ""
        for line in content.splitlines()[:24]:
            if line.startswith("description:"):
                description = line.split(":", 1)[1].strip().strip('"')
                break
        skills.append(
            {
                "name": skill_dir.name,
                "path": str(skill_doc if skill_doc.exists() else skill_dir),
                "description": description,
                "content": content,
            }
        )
    return skills


def _summarize_skills(skills_dir: Path) -> Dict[str, Any]:
    skills = _read_skill_summaries(skills_dir)
    return {
        "exists": skills_dir.exists(),
        "path": str(skills_dir),
        "count": len(skills),
        "items": skills,
    }


def _summarize_worktrees(worktrees_dir: Path) -> Dict[str, Any]:
    worktrees = []
    if worktrees_dir.exists():
        for child in sorted(worktrees_dir.iterdir()):
            if not child.is_dir():
                continue
            git_head = child / ".git" / "HEAD"
            branch = ""
            if git_head.exists():
                head_text = _safe_read_text(git_head, max_chars=200)
                if head_text.startswith("ref:"):
                    branch = head_text.rsplit("/", 1)[-1].strip()
            local_settings = child / ".claude" / "settings.local.json"
            worktrees.append(
                {
                    "name": child.name,
                    "path": str(child),
                    "branch": branch,
                    "has_local_settings": local_settings.exists(),
                    "modified_at": child.stat().st_mtime,
                }
            )
    return {
        "exists": worktrees_dir.exists(),
        "path": str(worktrees_dir),
        "count": len(worktrees),
        "items": worktrees,
    }


def _summarize_project_artifacts(project_dir: Path) -> Dict[str, Any]:
    session_logs = sorted(project_dir.glob("*.jsonl")) if project_dir.exists() else []
    subagent_logs = sorted(project_dir.glob("*/subagents/agent-*.jsonl")) if project_dir.exists() else []
    subagent_meta = sorted(project_dir.glob("*/subagents/*.meta.json")) if project_dir.exists() else []
    tool_results = sorted(project_dir.glob("*/tool-results/*")) if project_dir.exists() else []
    recent_sessions = [path.stem for path in session_logs[-8:]]
    return {
        "exists": project_dir.exists(),
        "path": str(project_dir),
        "session_count": len(session_logs),
        "subagent_log_count": len(subagent_logs),
        "subagent_meta_count": len(subagent_meta),
        "tool_result_count": len(tool_results),
        "recent_sessions": recent_sessions,
    }


def _summarize_task_artifacts(session_ids: List[str]) -> Dict[str, Any]:
    directories = []
    total_task_files = 0
    for session_id in session_ids:
        task_dir = TASKS_ROOT / session_id
        if not task_dir.exists() or not task_dir.is_dir():
            continue
        task_files = sorted(task_dir.glob("*.json"))
        total_task_files += len(task_files)
        directories.append(
            {
                "session_id": session_id,
                "path": str(task_dir),
                "task_file_count": len(task_files),
            }
        )
    return {
        "directory_count": len(directories),
        "task_file_count": total_task_files,
        "directories": directories[:12],
    }


def _build_project_metadata(project_path: str) -> Dict[str, Any]:
    normalized_project_path = str(Path(project_path).expanduser().resolve()) if project_path else ""
    project_key = _encode_project_path(normalized_project_path)
    project_dir = PROJECTS_ROOT / project_key
    repo_claude_dir = Path(normalized_project_path) / ".claude"
    repo_settings_path = repo_claude_dir / "settings.local.json"
    repo_claude_md = Path(normalized_project_path) / "CLAUDE.md"
    repo_skills_dir = repo_claude_dir / "skills"
    repo_skills = (
        {
            "exists": False,
            "path": str(repo_skills_dir),
            "count": 0,
            "items": [],
        }
        if repo_claude_dir.resolve() == CLAUDE_ROOT.resolve()
        else _summarize_skills(repo_skills_dir)
    )
    memory_dir = project_dir / "memory"
    worktrees_dir = repo_claude_dir / "worktrees"
    session_logs = sorted(project_dir.glob("*.jsonl")) if project_dir.exists() else []
    session_ids = [path.stem for path in session_logs]

    return {
        "identity": {
            "project_path": normalized_project_path,
            "project_key": project_key,
            "project_dir": str(project_dir),
        },
        "instructions": _summarize_claude_md(repo_claude_md),
        "memory": _summarize_memory(memory_dir),
        "local_config": _summarize_settings_local(repo_settings_path),
        "skills": repo_skills,
        "worktrees": _summarize_worktrees(worktrees_dir),
        "session_artifacts": _summarize_project_artifacts(project_dir),
        "task_artifacts": _summarize_task_artifacts(session_ids),
    }


def _build_global_metadata() -> Dict[str, Any]:
    global_claude_md = CLAUDE_ROOT / "CLAUDE.md"
    global_settings = CLAUDE_ROOT / "settings.json"
    global_skills_dir = CLAUDE_ROOT / "skills"
    return {
        "instructions": _summarize_claude_md(global_claude_md),
        "config": _summarize_settings_local(global_settings),
        "skills": _summarize_skills(global_skills_dir),
    }


def _node_file_detail(title: str, summary: Dict[str, Any], description: str) -> Dict[str, Any]:
    path = str(summary.get("path") or "")
    return {
        "kind": "file",
        "title": title,
        "description": description,
        "path": path,
        "content": summary.get("content") or summary.get("preview") or "",
    }


def _node_skills_detail(title: str, skills_summary: Dict[str, Any], description: str) -> Dict[str, Any]:
    return {
        "kind": "skills",
        "title": title,
        "description": description,
        "path": str(skills_summary.get("path") or ""),
        "items": [
            {
                "label": str(item.get("name") or "skill"),
                "description": str(item.get("description") or ""),
                "path": str(item.get("path") or ""),
                "content": str(item.get("content") or "")[:4000],
            }
            for item in (skills_summary.get("items") or [])
            if isinstance(item, dict)
        ],
    }


def _build_session_overview_node(session: Dict[str, Any], project_path: str) -> Dict[str, Any]:
    session_id = str(session.get("session_id") or "")
    return {
        "id": f"session-overview:{session_id}",
        "type": "session-overview",
        "label": "Overview",
        "sessionId": session_id,
        "projectPath": project_path,
        "hasChildren": False,
    }


def _build_session_shallow_node(session: Dict[str, Any], project_path: str) -> Dict[str, Any]:
    session_id = str(session.get("session_id") or "")
    metadata = session.get("metadata") or {}
    recap_text = str(metadata.get("recap_text") or "").strip()
    return {
        "id": f"session:{session_id}",
        "type": "session",
        "label": recap_text or session_id or "unknown-session",
        "subtitle": str(session.get("agent_name") or "claude-code"),
        "sessionId": session_id,
        "status": str(session.get("status") or "completed"),
        "projectPath": project_path,
        "hasChildren": True,
        "children": [],
    }


def _build_hierarchy_root(
    *,
    status: Optional[str] = None,
    query: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
) -> Dict[str, Any]:
    sessions_payload = storage.list_sessions(
        status=status,
        query=query,
        period_hours=720,
        start_time=start_time,
        end_time=end_time,
        limit=5000,
        offset=0,
        light=True,
    )
    sessions = sessions_payload.get("sessions", []) if isinstance(sessions_payload, dict) else []
    global_metadata = _build_global_metadata()

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for session in sessions:
        project_path = str(session.get("project_path") or "")
        grouped.setdefault(project_path, []).append(session)

    project_nodes = []
    for project_path, project_sessions in sorted(grouped.items(), key=lambda item: item[0]):
        if not project_path:
            continue
        project_metadata = _build_project_metadata(project_path)
        session_nodes = [
            _build_session_shallow_node(session, project_path)
            for session in sorted(
                project_sessions,
                key=lambda item: item.get("last_updated") or item.get("start_time") or "",
                reverse=True,
            )
        ]

        project_key = project_metadata["identity"]["project_key"]
        project_nodes.append(
            {
                "id": f"project:{project_key}",
                "type": "project",
                "label": project_path,
                "projectPath": project_path,
                "hasChildren": True,
                "children": [
                    {
                        "id": f"project-instructions:{project_key}",
                        "type": "project-instructions",
                        "label": "Instruction",
                        "projectPath": project_path,
                        "hasChildren": False,
                    },
                    {
                        "id": f"project-memory:{project_key}",
                        "type": "project-memory",
                        "label": "Memory",
                        "projectPath": project_path,
                        "count": int(project_metadata.get("memory", {}).get("note_count") or 0),
                        "hasChildren": False,
                    },
                    {
                        "id": f"project-config:{project_key}",
                        "type": "project-config",
                        "label": "Config",
                        "projectPath": project_path,
                        "hasChildren": False,
                    },
                    {
                        "id": f"project-skills:{project_key}",
                        "type": "project-skills",
                        "label": "Skills",
                        "projectPath": project_path,
                        "count": int(project_metadata.get("skills", {}).get("count") or 0),
                        "hasChildren": False,
                    },
                    {
                        "id": f"project-sessions:{project_key}",
                        "type": "project-sessions",
                        "label": "Sessions",
                        "projectPath": project_path,
                        "count": len(session_nodes),
                        "hasChildren": True,
                        "children": session_nodes,
                    },
                ],
            }
        )

    global_skill_count = int(global_metadata.get("skills", {}).get("count") or 0)
    return {
        "id": "global-root",
        "type": "global-root",
        "label": "global",
        "hasChildren": True,
        "children": [
            {
                "id": "global-instruction",
                "type": "global-instruction",
                "label": "Global instruction",
                "hasChildren": False,
                "detail": _node_file_detail(
                    "Global instruction",
                    global_metadata.get("instructions") or {},
                    "Global ~/.claude/CLAUDE.md",
                ),
            },
            {
                "id": "global-skills",
                "type": "global-skills",
                "label": "Global skills",
                "count": global_skill_count,
                "hasChildren": False,
                "detail": _node_skills_detail(
                    "Global skills",
                    global_metadata.get("skills") or {},
                    "Installed global Claude skills",
                ),
            },
            {
                "id": "global-config",
                "type": "global-config",
                "label": "Global config",
                "hasChildren": False,
                "detail": _node_file_detail(
                    "Global config",
                    global_metadata.get("config") or {},
                    "Global ~/.claude/settings.json",
                ),
            },
            {
                "id": "projects-root",
                "type": "projects-root",
                "label": "Projects",
                "count": len(project_nodes),
                "hasChildren": True,
                "children": project_nodes,
            },
        ],
    }


def _build_node_children(node_id: str) -> List[Dict[str, Any]]:
    if not node_id.startswith("session:"):
        raise HTTPException(status_code=404, detail="Node children not available")

    session_id = node_id.split(":", 1)[1]
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    project_path = str(session.get("project_path") or "")
    llm_calls = session.get("llm_calls") or []
    assistant_turns = [turn for turn in llm_calls if isinstance(turn, dict) and turn.get("is_assistant_turn")]
    subagent_logs = ((session.get("metadata") or {}).get("subagent_logs") or [])
    vision_references = ((session.get("metadata") or {}).get("vision_references") or [])
    task_summary = (session.get("metadata") or {}).get("task_summary") or {}
    task_count = len(task_summary.get("tasks") or []) if isinstance(task_summary, dict) else 0

    return [
        {
            "id": f"session-llm:{session_id}",
            "type": "session-llm",
            "label": "LLM",
            "sessionId": session_id,
            "projectPath": project_path,
            "count": len(assistant_turns),
            "hasChildren": False,
        },
        {
            "id": f"session-subagents:{session_id}",
            "type": "session-subagents",
            "label": "Subagents",
            "sessionId": session_id,
            "projectPath": project_path,
            "count": len(subagent_logs) if isinstance(subagent_logs, list) else 0,
            "hasChildren": False,
        },
        {
            "id": f"session-vision:{session_id}",
            "type": "session-vision",
            "label": "Vision",
            "sessionId": session_id,
            "projectPath": project_path,
            "count": len(vision_references),
            "hasChildren": False,
        },
        {
            "id": f"session-tasks:{session_id}",
            "type": "session-tasks",
            "label": "Tasks",
            "sessionId": session_id,
            "projectPath": project_path,
            "count": task_count,
            "hasChildren": False,
        },
    ]

class TraceIn(BaseModel):
    trace_id: str
    platform: Literal["claude-code", "codex"] = CLAUDE_CODE_PLATFORM
    agent_name: str
    session_id: str
    start_time: str
    end_time: Optional[str] = None
    duration_ms: int = 0
    model: str = ""
    prompt: str = ""
    response: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0
    cache_write_tokens: int = 0
    cache_creation_input_tokens: int = 0
    cache_read_input_tokens: int = 0
    cost_usd: float = 0.0
    tool_calls: List[Dict[str, Any]] = Field(default_factory=list)
    llm_calls: List[Dict[str, Any]] = Field(default_factory=list)
    status: str = "success"
    error_message: str = ""
    project_path: Optional[str] = None
    session_file_path: Optional[str] = None
    role: Optional[str] = None
    metadata: Dict[str, Any] = Field(default_factory=dict)


class TraceBatchIn(BaseModel):
    traces: List[TraceIn]
    session_id: str


@app.get("/")
def root():
    return {
        "message": "AgentLens API",
        "version": "0.2.0",
        "product": "local-first coding-agent session intelligence",
    }


@app.post("/api/v1/traces")
def create_trace(trace: TraceIn):
    """Compatibility endpoint for Claude Code trace ingestion."""
    trace_data = trace.model_dump()
    trace_data["platform"] = CLAUDE_CODE_PLATFORM
    storage.save_trace(trace_data)
    return {"status": "ok", "trace_id": trace.trace_id}


@app.post("/api/v1/traces/batch")
def create_traces_batch(batch: TraceBatchIn):
    traces = []
    for trace in batch.traces:
        trace_data = trace.model_dump()
        trace_data["platform"] = CLAUDE_CODE_PLATFORM
        traces.append(trace_data)
    storage.save_traces(traces)
    return {"status": "ok", "count": len(traces)}


@app.get("/api/v1/traces")
def get_traces(
    platform: Optional[str] = None,
    session_id: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    limit: int = Query(100, ge=1, le=5000),
):
    if platform and platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail="Unsupported platform")

    traces = storage.get_traces(
        platform=platform,
        session_id=session_id,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
    )
    return {"traces": traces, "count": len(traces)}


@app.get("/api/v1/sessions")
def get_sessions(
    platform: Optional[str] = None,
    project: Optional[str] = None,
    model: Optional[str] = None,
    status: Optional[str] = None,
    query: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    period_hours: Optional[int] = Query(default=720, ge=1, le=8760),
    limit: int = Query(100, ge=1, le=1000),
    offset: int = Query(0, ge=0, le=100000),
):
    if platform and platform not in SUPPORTED_PLATFORMS:
        raise HTTPException(status_code=400, detail="Unsupported platform")

    return storage.list_sessions(
        platform=platform,
        project=project,
        model=model,
        status=status,
        query=query,
        period_hours=period_hours,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=offset,
        light=True,
    )


@app.get("/api/v1/sessions/{session_id}")
def get_session(
    session_id: str,
    detail: Literal["summary", "full"] = "full",
):
    session = storage.get_session(session_id, detail=detail)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/v1/sessions/{session_id}/conversation")
def get_session_conversation(
    session_id: str,
    cursor: Optional[str] = Query(default=None, pattern=r"^\d+$"),
    limit: int = Query(default=50, ge=1, le=200),
):
    """Return a bounded page of assistant turns and their tool calls."""
    before = int(cursor) if cursor is not None else None
    conversation = storage.get_session_conversation(
        session_id, limit=limit, before=before
    )
    if conversation is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"session_id": session_id, **conversation}


def _decode_activity_cursor(cursor: Optional[str]) -> tuple[Optional[int], Optional[str]]:
    if not cursor:
        return None, None
    sequence_text, separator, node_id = cursor.partition(":")
    if not separator or not node_id:
        raise HTTPException(status_code=400, detail="Invalid activity cursor")
    try:
        sequence = int(sequence_text)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid activity cursor") from exc
    if sequence < 0:
        raise HTTPException(status_code=400, detail="Invalid activity cursor")
    return sequence, node_id


@app.get("/api/v1/sessions/{session_id}/activities")
def get_session_activities(
    session_id: str,
    kind: Optional[str] = Query(default=None, min_length=1),
    cursor: Optional[str] = Query(default=None, min_length=1),
    limit: int = Query(default=100, ge=1, le=500),
):
    """Return a bounded, stable page of canonical session activities."""
    if not storage.get_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    after_sequence, after_node_id = _decode_activity_cursor(cursor)
    page = storage.get_activity_nodes(
        session_id,
        kind=kind,
        after_sequence=after_sequence,
        after_node_id=after_node_id,
        limit=limit,
    )
    return {"session_id": session_id, **page}


@app.get("/api/v1/sessions/{session_id}/activities/{node_id}")
def get_session_activity(session_id: str, node_id: str):
    """Return one canonical activity with its immediate relationships."""
    if not storage.get_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    activity = storage.get_activity_node(session_id, node_id)
    if not activity:
        raise HTTPException(status_code=404, detail="Activity not found")
    return {"session_id": session_id, **activity}


@app.get("/api/v1/sessions/{session_id}/activities/{node_id}/neighborhood")
def get_session_activity_neighborhood(
    session_id: str,
    node_id: str,
    depth: int = Query(default=1, ge=0, le=3),
    direction: Literal["inbound", "outbound", "both"] = "both",
    node_limit: int = Query(default=100, ge=1, le=500),
    edge_limit: int = Query(default=500, ge=1, le=1000),
):
    """Return a bounded subgraph centered on one canonical activity."""
    if not storage.get_session(session_id):
        raise HTTPException(status_code=404, detail="Session not found")
    neighborhood = storage.get_activity_neighborhood(
        session_id,
        node_id,
        depth=depth,
        direction=direction,
        node_limit=node_limit,
        edge_limit=edge_limit,
    )
    if not neighborhood:
        raise HTTPException(status_code=404, detail="Activity not found")
    return {"session_id": session_id, **neighborhood}


_MAX_EVENT_IDS = 50


@app.get("/api/v1/sessions/{session_id}/events")
def get_session_events(session_id: str, ids: str = Query(..., min_length=1)):
    """Return raw JSONL log records for the given event UUIDs (provenance view)."""
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    session_file_path = session.get("session_file_path") or ""
    if not session_file_path:
        raise HTTPException(status_code=400, detail="Session has no source log file")

    log_path = Path(session_file_path).expanduser()
    if not log_path.exists():
        raise HTTPException(status_code=404, detail=f"Session log not found: {log_path}")

    wanted = {item.strip() for item in ids.split(",") if item.strip()}
    if not wanted:
        raise HTTPException(status_code=400, detail="No event ids provided")
    if len(wanted) > _MAX_EVENT_IDS:
        raise HTTPException(status_code=400, detail=f"At most {_MAX_EVENT_IDS} event ids per request")

    # Main session log first, then subagent transcripts under <session>/subagents/.
    candidate_logs = [log_path]
    subagents_dir = log_path.parent / log_path.stem / "subagents"
    if subagents_dir.exists():
        candidate_logs.extend(sorted(subagents_dir.glob("agent-*.jsonl")))

    events: Dict[str, Dict[str, Any]] = {}
    for candidate in candidate_logs:
        if len(events) == len(wanted):
            break
        try:
            with open(candidate, "r", encoding="utf-8") as handle:
                for line in handle:
                    if len(events) == len(wanted):
                        break
                    stripped = line.strip()
                    if not stripped:
                        continue
                    try:
                        record = json.loads(stripped)
                    except json.JSONDecodeError:
                        continue
                    # Claude records use a top-level UUID. Codex response items
                    # keep their stable provenance ID in payload.id instead;
                    # call_id links a call to its output and is only a fallback
                    # for call records that do not have an item ID.
                    record_ids = [record.get("uuid")]
                    payload = record.get("payload")
                    if isinstance(payload, dict):
                        record_ids.append(payload.get("id"))
                        item_type = str(payload.get("type") or "")
                        if item_type.endswith("_call"):
                            record_ids.append(payload.get("call_id"))
                    matched_ids = {
                        str(record_id)
                        for record_id in record_ids
                        if record_id is not None and str(record_id) in wanted
                    }
                    for matched_id in matched_ids - set(events):
                        events[matched_id] = {
                            "uuid": matched_id,
                            "source_file": str(candidate),
                            "record": record,
                        }
        except OSError:
            continue

    return {
        "session_id": session_id,
        "events": [events[uuid] for uuid in wanted if uuid in events],
        "missing": sorted(wanted - set(events)),
    }


@app.get("/api/v1/projects/by-path")
def get_project_metadata(project_path: str = Query(..., min_length=1)):
    metadata = _build_project_metadata(project_path)
    return metadata


@app.get("/api/v1/hierarchy")
def get_hierarchy(
    status: Optional[str] = None,
    query: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
):
    cache_key = f"hierarchy:{status}:{query}:{start_time}:{end_time}"
    return {
        "root": _cached(
            cache_key,
            lambda: _build_hierarchy_root(
                status=status,
                query=query,
                start_time=start_time,
                end_time=end_time,
            ),
        )
    }


@app.get("/api/v1/hierarchy/children")
def get_hierarchy_children(node_id: str = Query(..., min_length=1)):
    return {"node_id": node_id, "children": _build_node_children(node_id)}


def _open_local_path(path: Path) -> None:
    if sys.platform.startswith("win"):
        os.startfile(str(path))
        return

    if shutil.which("open"):
        subprocess.Popen(["open", str(path)])
        return

    if shutil.which("xdg-open"):
        subprocess.Popen(["xdg-open", str(path)])
        return

    raise HTTPException(status_code=501, detail="Opening paths is not supported on this platform")


@app.post("/api/v1/sessions/{session_id}/open")
def open_session_path(session_id: str, target: Literal["project", "session_folder"] = Query(...)):
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if target == "project":
        raw_path = session.get("project_path") or ""
    else:
        session_file_path = session.get("session_file_path") or ""
        raw_path = str(Path(session_file_path).parent) if session_file_path else ""

    if not raw_path:
        raise HTTPException(status_code=400, detail="Requested path is unavailable for this session")

    path = Path(raw_path).expanduser()
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Path does not exist: {path}")

    _open_local_path(path)

    return {"status": "ok", "target": target, "opened_path": str(path)}


@app.get("/api/v1/stats")
def get_stats(
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    period_hours: int = Query(720, ge=1, le=8760),
):
    """Backward-compatible overview stats endpoint."""
    return storage.get_overview_stats(period_hours, start_time=start_time, end_time=end_time)


@app.get("/api/v1/stats/overview")
def get_overview_stats(
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    period_hours: int = Query(720, ge=1, le=8760),
):
    cache_key = f"overview:{period_hours}:{start_time}:{end_time}"
    return _cached(
        cache_key,
        lambda: storage.get_overview_stats(period_hours, start_time=start_time, end_time=end_time),
    )


@app.get("/api/v1/stats/projects")
def get_project_stats(
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    period_hours: int = Query(720, ge=1, le=8760),
):
    return {
        "period_hours": period_hours,
        "projects": storage.get_project_stats(period_hours, start_time=start_time, end_time=end_time),
    }


@app.get("/api/v1/platforms")
def get_platforms(
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    period_hours: int = Query(720, ge=1, le=8760),
):
    stats = storage.get_overview_stats(
        period_hours,
        start_time=start_time,
        end_time=end_time,
    )
    platform_counts = stats.get("platform_counts") or {}
    return {
        "platforms": list(SUPPORTED_PLATFORMS),
        "counts": {platform: platform_counts.get(platform, 0) for platform in SUPPORTED_PLATFORMS},
    }


@app.post("/api/v1/ingest/rescan")
def rescan_ingestion():
    global realtime_updater
    if realtime_updater is None:
        realtime_updater = RealtimeUpdater(storage, interval=5.0)
        realtime_updater.start()
    result = realtime_updater.request_rescan()
    return result


@app.get("/api/v1/ingest/status")
def get_ingest_status():
    if realtime_updater is None:
        return {
            "running": False,
            "watching": False,
            "job_type": None,
            "job_state": None,
            "startup_backfill_completed": False,
            "collectors": [],
        }
    return realtime_updater.get_status()


def start_server(host: str = "0.0.0.0", port: int = 8080):
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    start_server()
