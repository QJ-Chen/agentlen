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
from pathlib import Path
from typing import Any, Dict, List, Literal, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agentlens.realtime import RealtimeUpdater
from agentlens.storage import CLAUDE_CODE_PLATFORM, SQLiteStorage

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AgentLens API", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage = SQLiteStorage()
realtime_updater: Optional[RealtimeUpdater] = None
PROJECTS_ROOT = Path.home() / ".claude" / "projects"
TASKS_ROOT = Path.home() / ".claude" / "tasks"


def _encode_project_path(project_path: str) -> str:
    return re.sub(r"[/\\]+", "-", project_path.strip())


def _safe_read_text(path: Path, max_chars: int = 4000) -> str:
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
        "worktrees": _summarize_worktrees(worktrees_dir),
        "session_artifacts": _summarize_project_artifacts(project_dir),
        "task_artifacts": _summarize_task_artifacts(session_ids),
    }


def _build_hierarchy_root() -> Dict[str, Any]:
    sessions_payload = storage.list_sessions(platform=CLAUDE_CODE_PLATFORM, period_hours=720, limit=5000, offset=0)
    sessions = sessions_payload.get("sessions", []) if isinstance(sessions_payload, dict) else []

    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for session in sessions:
        project_path = str(session.get("project_path") or "")
        grouped.setdefault(project_path, []).append(session)

    project_nodes = []
    for project_path, project_sessions in sorted(grouped.items(), key=lambda item: item[0]):
        if not project_path:
            continue
        project_metadata = _build_project_metadata(project_path)
        session_nodes = []
        for session in sorted(project_sessions, key=lambda item: item.get("last_updated") or item.get("start_time") or "", reverse=True):
            llm_count = len(session.get("llm_calls") or [])
            subagent_count = len(((session.get("metadata") or {}).get("subagent_logs") or []))
            task_summary = (session.get("metadata") or {}).get("task_summary") or {}
            task_count = len(task_summary.get("tasks") or []) if isinstance(task_summary, dict) else 0
            session_nodes.append(
                {
                    "id": f"session:{session.get('session_id')}",
                    "type": "session",
                    "label": str(session.get("session_id") or "unknown-session"),
                    "subtitle": str(session.get("agent_name") or "claude-code"),
                    "sessionId": str(session.get("session_id") or ""),
                    "status": str(session.get("status") or "completed"),
                    "projectPath": project_path,
                    "children": [
                        {
                            "id": f"session-overview:{session.get('session_id')}",
                            "type": "session-overview",
                            "label": "Overview",
                            "sessionId": str(session.get("session_id") or ""),
                            "projectPath": project_path,
                        },
                        {
                            "id": f"session-llm:{session.get('session_id')}",
                            "type": "session-llm",
                            "label": "LLM calls",
                            "count": llm_count,
                            "sessionId": str(session.get("session_id") or ""),
                            "projectPath": project_path,
                        },
                        {
                            "id": f"session-subagents:{session.get('session_id')}",
                            "type": "session-subagents",
                            "label": "Subagents",
                            "count": subagent_count,
                            "sessionId": str(session.get("session_id") or ""),
                            "projectPath": project_path,
                        },
                        {
                            "id": f"session-tasks:{session.get('session_id')}",
                            "type": "session-tasks",
                            "label": "Tasks",
                            "count": task_count,
                            "sessionId": str(session.get("session_id") or ""),
                            "projectPath": project_path,
                        },
                    ],
                }
            )

        project_nodes.append(
            {
                "id": f"project:{project_metadata['identity']['project_key']}",
                "type": "project",
                "label": project_path,
                "projectPath": project_path,
                "children": [
                    {
                        "id": f"project-instructions:{project_metadata['identity']['project_key']}",
                        "type": "project-instructions",
                        "label": "Instruction",
                        "projectPath": project_path,
                    },
                    {
                        "id": f"project-memory:{project_metadata['identity']['project_key']}",
                        "type": "project-memory",
                        "label": "Memory",
                        "projectPath": project_path,
                        "count": int(project_metadata.get("memory", {}).get("note_count") or 0),
                    },
                    {
                        "id": f"project-config:{project_metadata['identity']['project_key']}",
                        "type": "project-config",
                        "label": "Config",
                        "projectPath": project_path,
                    },
                    {
                        "id": f"project-sessions:{project_metadata['identity']['project_key']}",
                        "type": "project-sessions",
                        "label": "Sessions",
                        "projectPath": project_path,
                        "count": len(session_nodes),
                        "children": session_nodes,
                    },
                ],
            }
        )

    return {
        "id": "global-root",
        "type": "global-root",
        "label": "global",
        "children": [
            {
                "id": "projects-root",
                "type": "project",
                "label": "Projects",
                "count": len(project_nodes),
                "children": project_nodes,
            }
        ],
    }



class TraceIn(BaseModel):
    trace_id: str
    platform: Literal["claude-code"] = CLAUDE_CODE_PLATFORM
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


@app.on_event("startup")
async def startup_event():
    """Start the API immediately and warm ingestion in the background."""
    global realtime_updater
    realtime_updater = RealtimeUpdater(storage, interval=5.0)
    realtime_updater.start()
    logger.info("Scheduled background Claude Code ingestion warmup")


@app.on_event("shutdown")
async def shutdown_event():
    global realtime_updater
    if realtime_updater:
        realtime_updater.stop()
        realtime_updater = None
        logger.info("Stopped Claude Code session log watching")


@app.get("/")
def root():
    return {
        "message": "AgentLens API",
        "version": "0.2.0",
        "product": "local-first Claude Code session intelligence",
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
    if platform and platform != CLAUDE_CODE_PLATFORM:
        raise HTTPException(status_code=400, detail="Only Claude Code traces are supported")

    traces = storage.get_traces(
        platform=CLAUDE_CODE_PLATFORM,
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
    if platform and platform != CLAUDE_CODE_PLATFORM:
        raise HTTPException(status_code=400, detail="Only Claude Code sessions are supported")

    return storage.list_sessions(
        platform=CLAUDE_CODE_PLATFORM,
        project=project,
        model=model,
        status=status,
        query=query,
        period_hours=period_hours,
        start_time=start_time,
        end_time=end_time,
        limit=limit,
        offset=offset,
    )


@app.get("/api/v1/sessions/{session_id}")
def get_session(session_id: str):
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/v1/projects/by-path")
def get_project_metadata(project_path: str = Query(..., min_length=1)):
    metadata = _build_project_metadata(project_path)
    return metadata


@app.get("/api/v1/hierarchy")
def get_hierarchy():
    return {"root": _build_hierarchy_root()}


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
    return storage.get_overview_stats(period_hours, start_time=start_time, end_time=end_time)


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
    return {
        "platforms": [CLAUDE_CODE_PLATFORM],
        "counts": {
            CLAUDE_CODE_PLATFORM: storage.get_overview_stats(
                period_hours,
                start_time=start_time,
                end_time=end_time,
            ).get("total_sessions", 0)
        },
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
