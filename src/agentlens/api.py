"""AgentLens API Server - FastAPI 实现"""

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import uvicorn
import json
import logging

from agentlens.storage import SQLiteStorage, JSONLStorage
from agentlens.collectors import CollectorManager

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="AgentLens API", version="0.1.0")

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 存储（默认 SQLite）
storage = SQLiteStorage()

# 收集器管理器（用于实时监听）
collector_manager = None

@app.on_event("startup")
async def startup_event():
    """启动时收集历史数据并启用实时监听"""
    global collector_manager
    
    # 收集历史数据
    collector_manager = CollectorManager(storage)
    count = collector_manager.collect_all_historical()
    logger.info(f"Collected {count} historical traces")
    
    # 启动实时监听
    collector_manager.start_all(interval=5.0)  # 每 5 秒检查一次
    logger.info("Started real-time log watching")

@app.on_event("shutdown")
async def shutdown_event():
    """关闭时停止监听"""
    global collector_manager
    if collector_manager:
        collector_manager.stop_all()
        logger.info("Stopped log watching")


# 数据模型
class TraceIn(BaseModel):
    trace_id: str
    platform: str
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
    cache_read_tokens: Optional[int] = 0
    cache_write_tokens: Optional[int] = 0
    cache_creation_input_tokens: Optional[int] = 0
    cache_read_input_tokens: Optional[int] = 0
    cost_usd: float = 0.0
    tool_calls: List[Dict[str, Any]] = []
    llm_calls: List[Dict[str, Any]] = []
    status: str = "success"
    error_message: Optional[str] = ""
    project_path: Optional[str] = None
    role: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class TraceBatchIn(BaseModel):
    traces: List[TraceIn]
    session_id: str


class TraceOut(BaseModel):
    id: Optional[int] = None
    trace_id: str
    platform: str
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
    cache_read_tokens: Optional[int] = 0
    cache_write_tokens: Optional[int] = 0
    cache_creation_input_tokens: Optional[int] = 0
    cache_read_input_tokens: Optional[int] = 0
    cost_usd: float = 0.0
    tool_calls: List[Dict[str, Any]] = []
    llm_calls: List[Dict[str, Any]] = []
    status: str = "success"
    error_message: Optional[str] = ""
    project_path: Optional[str] = None
    role: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    created_at: Optional[str] = None


# API 路由
@app.get("/")
def root():
    return {"message": "AgentLens API", "version": "0.1.0"}


@app.post("/api/v1/traces")
def create_trace(trace: TraceIn):
    """创建单个 Trace"""
    storage.save_trace(trace.model_dump())
    return {"status": "ok", "trace_id": trace.trace_id}


@app.post("/api/v1/traces/batch")
def create_traces_batch(batch: TraceBatchIn):
    """批量创建 Traces"""
    traces = [t.model_dump() for t in batch.traces]
    storage.save_traces(traces)
    return {"status": "ok", "count": len(traces)}


@app.get("/api/v1/traces")
def get_traces(
    platform: Optional[str] = None,
    session_id: Optional[str] = None,
    start_time: Optional[str] = None,
    end_time: Optional[str] = None,
    limit: int = Query(100, ge=1, le=1000)
):
    """查询 Traces"""
    traces = storage.get_traces(
        platform=platform,
        session_id=session_id,
        start_time=start_time,
        end_time=end_time,
        limit=limit
    )
    # 确保 llm_calls 是列表，并清理 None 值
    for trace in traces:
        if isinstance(trace.get("llm_calls"), str):
            try:
                trace["llm_calls"] = json.loads(trace["llm_calls"])
            except:
                trace["llm_calls"] = []
        # 清理 None 值
        for key in ["cache_read_tokens", "cache_write_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"]:
            if trace.get(key) is None:
                trace[key] = 0
        if trace.get("error_message") is None:
            trace["error_message"] = ""
        if trace.get("duration_ms") is None:
            trace["duration_ms"] = 0
    return {"traces": traces, "count": len(traces)}


@app.get("/api/v1/stats")
def get_stats(period_hours: int = Query(720, ge=1, le=8760)):
    """获取统计信息"""
    stats = storage.get_stats(period_hours)
    return stats


@app.get("/api/v1/platforms")
def get_platforms():
    """获取所有平台"""
    # 从存储中查询
    traces = storage.get_traces(limit=10000)
    platforms = list(set(t.get("platform") for t in traces if t.get("platform")))
    return {"platforms": platforms}


@app.get("/api/v1/sessions")
def get_sessions():
    """获取所有会话"""
    traces = storage.get_traces(limit=10000)
    sessions = {}
    
    for trace in traces:
        sid = trace.get("session_id")
        if sid and sid not in sessions:
            sessions[sid] = {
                "session_id": sid,
                "platform": trace.get("platform"),
                "agent_name": trace.get("agent_name"),
                "start_time": trace.get("start_time")
            }
    
    return {"sessions": list(sessions.values())}


def start_server(host: str = "0.0.0.0", port: int = 8080):
    """启动服务器"""
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    start_server()
