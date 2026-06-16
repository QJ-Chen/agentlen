"""AgentLens API server.

The product is session-centric: the API exposes session list/detail and
analytics endpoints, while keeping the older trace ingestion/query routes
for compatibility with existing Claude Code collectors and SDK-style integrations.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Literal, Optional

import uvicorn
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from agentlens.collectors import CollectorManager
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
collector_manager: Optional[CollectorManager] = None


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
    """Collect historical data and enable Claude Code watch mode on boot."""
    global collector_manager
    purged = storage.purge_non_claude_rows()
    if purged:
        logger.info("Purged %s non-Claude trace rows", purged)
    collector_manager = CollectorManager(storage)
    count = collector_manager.collect_all_historical()
    logger.info("Collected %s historical Claude Code session records", count)
    collector_manager.start_all(interval=5.0)
    logger.info("Started Claude Code session log watching")


@app.on_event("shutdown")
async def shutdown_event():
    global collector_manager
    if collector_manager:
        collector_manager.stop_all()
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
        limit=limit,
        offset=offset,
    )


@app.get("/api/v1/sessions/{session_id}")
def get_session(session_id: str):
    session = storage.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/api/v1/stats")
def get_stats(period_hours: int = Query(720, ge=1, le=8760)):
    """Backward-compatible overview stats endpoint."""
    return storage.get_overview_stats(period_hours)


@app.get("/api/v1/stats/overview")
def get_overview_stats(period_hours: int = Query(720, ge=1, le=8760)):
    return storage.get_overview_stats(period_hours)


@app.get("/api/v1/stats/projects")
def get_project_stats(period_hours: int = Query(720, ge=1, le=8760)):
    return {
        "period_hours": period_hours,
        "projects": storage.get_project_stats(period_hours),
    }


@app.get("/api/v1/platforms")
def get_platforms(period_hours: int = Query(720, ge=1, le=8760)):
    return {
        "platforms": [CLAUDE_CODE_PLATFORM],
        "counts": {CLAUDE_CODE_PLATFORM: storage.get_overview_stats(period_hours).get("total_sessions", 0)},
    }


@app.post("/api/v1/ingest/rescan")
def rescan_ingestion():
    global collector_manager
    purged = storage.purge_non_claude_rows()
    if collector_manager is None:
        collector_manager = CollectorManager(storage)
    count = collector_manager.collect_all_historical()
    return {"status": "ok", "rescanned": count, "purged_non_claude": purged}


@app.get("/api/v1/ingest/status")
def get_ingest_status():
    if collector_manager is None:
        return {"watching": False, "collectors": []}
    return {
        "watching": any(c.watching for c in collector_manager.collectors),
        "collectors": collector_manager.get_collector_status(),
        "legacy_non_claude_rows": storage.count_non_claude_rows(),
    }


def start_server(host: str = "0.0.0.0", port: int = 8080):
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    start_server()
