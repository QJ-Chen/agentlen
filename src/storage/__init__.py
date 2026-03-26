"""
AgentLens Storage - 数据存储层

提供 SQLite 存储后端，支持异步操作和批量写入。
"""

from __future__ import annotations

import asyncio
import json
import sqlite3
from contextlib import asynccontextmanager
from dataclasses import asdict
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Protocol, Union

from agentlens.models import AgentSpan, ToolCall


class StorageBackend(Protocol):
    """存储后端协议"""
    
    async def store_span(self, span: AgentSpan) -> None:
        """存储 Span"""
        ...
    
    async def store_tool_call(self, span_id: str, tool_call: ToolCall) -> None:
        """存储工具调用"""
        ...
    
    async def get_span(self, span_id: str) -> Optional[AgentSpan]:
        """获取 Span"""
        ...
    
    async def get_spans_by_trace(self, trace_id: str) -> List[AgentSpan]:
        """获取 Trace 下的所有 Span"""
        ...
    
    async def get_spans_by_agent(
        self,
        agent_name: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[AgentSpan]:
        """获取指定 Agent 的 Span 列表"""
        ...
    
    async def flush(self) -> None:
        """强制刷新缓冲区"""
        ...
    
    async def close(self) -> None:
        """关闭存储连接"""
        ...


class SQLiteStorage:
    """
    SQLite 存储后端
    
    特性：
    - 异步操作（通过线程池）
    - 连接池管理
    - 自动建表
    - 批量写入优化
    - WAL 模式提升并发性能
    """
    
    def __init__(
        self,
        db_path: Union[str, Path],
        pool_size: int = 5,
        batch_size: int = 50,
    ):
        self.db_path = Path(db_path)
        self.pool_size = pool_size
        self.batch_size = batch_size
        
        # 连接池
        self._pool: asyncio.Queue[sqlite3.Connection] = asyncio.Queue(maxsize=pool_size)
        self._pool_lock = asyncio.Lock()
        self._initialized = False
        
        # 批量写入缓冲区
        self._span_batch: List[AgentSpan] = []
        self._tool_batch: List[tuple] = []
        self._batch_lock = asyncio.Lock()
    
    async def initialize(self) -> None:
        """初始化数据库连接和表结构"""
        if self._initialized:
            return
        
        # 确保目录存在
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        
        # 创建连接池
        for _ in range(self.pool_size):
            conn = await self._create_connection()
            await self._pool.put(conn)
        
        # 创建表
        await self._create_tables()
        
        self._initialized = True
    
    async def _create_connection(self) -> sqlite3.Connection:
        """创建数据库连接"""
        def _connect():
            conn = sqlite3.connect(
                str(self.db_path),
                check_same_thread=False,
                isolation_level=None,  # 自动提交模式
            )
            # 启用 WAL 模式，提升读写并发性能
            conn.execute("PRAGMA journal_mode=WAL")
            conn.execute("PRAGMA synchronous=NORMAL")
            conn.row_factory = sqlite3.Row
            return conn
        
        loop = asyncio.get_event_loop()
        return await loop.run_in_executor(None, _connect)
    
    @asynccontextmanager
    async def _get_connection(self):
        """获取连接上下文"""
        conn = await self._pool.get()
        try:
            yield conn
        finally:
            await self._pool.put(conn)
    
    async def _create_tables(self) -> None:
        """创建数据表"""
        create_spans_table = """
        CREATE TABLE IF NOT EXISTS spans (
            span_id TEXT PRIMARY KEY,
            trace_id TEXT NOT NULL,
            agent_name TEXT NOT NULL,
            agent_role TEXT NOT NULL,
            model TEXT,
            start_time TEXT NOT NULL,
            end_time TEXT,
            task_description TEXT,
            input_context TEXT,  -- JSON
            output_result TEXT,  -- JSON
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            cost_usd REAL DEFAULT 0.0,
            latency_ms INTEGER DEFAULT 0,
            parent_span_id TEXT,
            child_span_ids TEXT,  -- JSON array
            task_id TEXT,
            project TEXT,
            status TEXT DEFAULT 'running',
            blocked_by TEXT,
            block_reason TEXT,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """
        
        create_tool_calls_table = """
        CREATE TABLE IF NOT EXISTS tool_calls (
            call_id INTEGER PRIMARY KEY AUTOINCREMENT,
            span_id TEXT NOT NULL,
            tool_name TEXT NOT NULL,
            input_args TEXT,  -- JSON
            output_result TEXT,  -- JSON
            duration_ms INTEGER DEFAULT 0,
            success INTEGER DEFAULT 1,
            error_message TEXT,
            timestamp TEXT DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (span_id) REFERENCES spans(span_id)
        );
        """
        
        create_llm_requests_table = """
        CREATE TABLE IF NOT EXISTS llm_requests (
            request_id TEXT PRIMARY KEY,
            span_id TEXT NOT NULL,
            model TEXT,
            messages TEXT,  -- JSON
            temperature REAL DEFAULT 0.7,
            max_tokens INTEGER,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (span_id) REFERENCES spans(span_id)
        );
        """
        
        create_llm_responses_table = """
        CREATE TABLE IF NOT EXISTS llm_responses (
            response_id TEXT PRIMARY KEY,
            request_id TEXT NOT NULL,
            span_id TEXT NOT NULL,
            content TEXT,
            finish_reason TEXT,
            input_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            latency_ms INTEGER DEFAULT 0,
            timestamp TEXT NOT NULL,
            FOREIGN KEY (request_id) REFERENCES llm_requests(request_id),
            FOREIGN KEY (span_id) REFERENCES spans(span_id)
        );
        """
        
        create_indexes = """
        CREATE INDEX IF NOT EXISTS idx_spans_trace ON spans(trace_id);
        CREATE INDEX IF NOT EXISTS idx_spans_agent ON spans(agent_name);
        CREATE INDEX IF NOT EXISTS idx_spans_time ON spans(start_time);
        CREATE INDEX IF NOT EXISTS idx_tool_calls_span ON tool_calls(span_id);
        CREATE INDEX IF NOT EXISTS idx_llm_span ON llm_requests(span_id);
        """
        
        async with self._get_connection() as conn:
            def _execute():
                conn.execute(create_spans_table)
                conn.execute(create_tool_calls_table)
                conn.execute(create_llm_requests_table)
                conn.execute(create_llm_responses_table)
                conn.executescript(create_indexes)
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _execute)
    
    async def store_span(self, span: AgentSpan) -> None:
        """存储 Span"""
        async with self._batch_lock:
            self._span_batch.append(span)
            
            if len(self._span_batch) >= self.batch_size:
                batch = self._span_batch.copy()
                self._span_batch.clear()
                await self._flush_spans(batch)
    
    async def _flush_spans(self, spans: List[AgentSpan]) -> None:
        """批量写入 Span"""
        if not spans:
            return
        
        sql = """
        INSERT OR REPLACE INTO spans (
            span_id, trace_id, agent_name, agent_role, model,
            start_time, end_time, task_description, input_context,
            output_result, input_tokens, output_tokens, cost_usd,
            latency_ms, parent_span_id, child_span_ids, task_id,
            project, status, blocked_by, block_reason
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        
        def _to_json(obj):
            if obj is None:
                return None
            try:
                return json.dumps(obj, default=str)
            except:
                return str(obj)
        
        params = [
            (
                s.span_id,
                s.trace_id,
                s.agent_name,
                s.agent_role.value if hasattr(s.agent_role, 'value') else str(s.agent_role),
                s.model,
                s.start_time.isoformat(),
                s.end_time.isoformat() if s.end_time else None,
                s.task_description,
                _to_json(s.input_context),
                _to_json(s.output_result),
                s.input_tokens,
                s.output_tokens,
                s.cost_usd,
                s.latency_ms,
                s.parent_span_id,
                _to_json(s.child_span_ids),
                s.task_id,
                s.project,
                s.status.value if hasattr(s.status, 'value') else str(s.status),
                s.blocked_by,
                s.block_reason,
            )
            for s in spans
        ]
        
        async with self._get_connection() as conn:
            def _execute():
                conn.executemany(sql, params)
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _execute)
    
    async def store_tool_call(self, span_id: str, tool_call: ToolCall) -> None:
        """存储工具调用"""
        async with self._batch_lock:
            self._tool_batch.append((span_id, tool_call))
            
            if len(self._tool_batch) >= self.batch_size:
                batch = self._tool_batch.copy()
                self._tool_batch.clear()
                await self._flush_tool_calls(batch)
    
    async def _flush_tool_calls(self, calls: List[tuple]) -> None:
        """批量写入工具调用"""
        if not calls:
            return
        
        sql = """
        INSERT INTO tool_calls (
            span_id, tool_name, input_args, output_result,
            duration_ms, success, error_message
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        
        def _to_json(obj):
            try:
                return json.dumps(obj, default=str)
            except:
                return str(obj)
        
        params = [
            (
                span_id,
                call.tool_name,
                _to_json(call.input_args),
                _to_json(call.output_result),
                call.duration_ms,
                1 if call.success else 0,
                call.error_message,
            )
            for span_id, call in calls
        ]
        
        async with self._get_connection() as conn:
            def _execute():
                conn.executemany(sql, params)
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _execute)
    
    async def store_llm_request(self, request: Any) -> None:
        """存储 LLM 请求"""
        sql = """
        INSERT OR REPLACE INTO llm_requests (
            request_id, span_id, model, messages,
            temperature, max_tokens, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """
        
        def _to_json(obj):
            try:
                return json.dumps(obj, default=str)
            except:
                return str(obj)
        
        params = (
            request.request_id,
            request.span_id,
            request.model,
            _to_json(request.messages),
            request.temperature,
            request.max_tokens,
            request.timestamp.isoformat(),
        )
        
        async with self._get_connection() as conn:
            def _execute():
                conn.execute(sql, params)
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _execute)
    
    async def store_llm_response(self, response: Any) -> None:
        """存储 LLM 响应"""
        sql = """
        INSERT OR REPLACE INTO llm_responses (
            response_id, request_id, span_id, content,
            finish_reason, input_tokens, output_tokens,
            latency_ms, timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """
        
        params = (
            response.response_id,
            response.request_id,
            response.span_id,
            response.content,
            response.finish_reason,
            response.input_tokens,
            response.output_tokens,
            response.latency_ms,
            response.timestamp.isoformat(),
        )
        
        async with self._get_connection() as conn:
            def _execute():
                conn.execute(sql, params)
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _execute)
    
    async def get_span(self, span_id: str) -> Optional[AgentSpan]:
        """获取 Span"""
        sql = "SELECT * FROM spans WHERE span_id = ?"
        
        async with self._get_connection() as conn:
            def _execute():
                row = conn.execute(sql, (span_id,)).fetchone()
                return dict(row) if row else None
            
            loop = asyncio.get_event_loop()
            row_dict = await loop.run_in_executor(None, _execute)
            
            if row_dict:
                return self._row_to_span(row_dict)
            return None
    
    async def get_spans_by_trace(self, trace_id: str) -> List[AgentSpan]:
        """获取 Trace 下的所有 Span"""
        sql = "SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time"
        
        async with self._get_connection() as conn:
            def _execute():
                rows = conn.execute(sql, (trace_id,)).fetchall()
                return [dict(row) for row in rows]
            
            loop = asyncio.get_event_loop()
            rows = await loop.run_in_executor(None, _execute)
            
            return [self._row_to_span(row) for row in rows]
    
    async def get_spans_by_agent(
        self,
        agent_name: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[AgentSpan]:
        """获取指定 Agent 的 Span 列表"""
        conditions = ["agent_name = ?"]
        params = [agent_name]
        
        if start_time:
            conditions.append("start_time >= ?")
            params.append(start_time.isoformat())
        
        if end_time:
            conditions.append("start_time <= ?")
            params.append(end_time.isoformat())
        
        where_clause = " AND ".join(conditions)
        sql = f"SELECT * FROM spans WHERE {where_clause} ORDER BY start_time DESC LIMIT ?"
        params.append(limit)
        
        async with self._get_connection() as conn:
            def _execute():
                rows = conn.execute(sql, params).fetchall()
                return [dict(row) for row in rows]
            
            loop = asyncio.get_event_loop()
            rows = await loop.run_in_executor(None, _execute)
            
            return [self._row_to_span(row) for row in rows]
    
    def _row_to_span(self, row: Dict[str, Any]) -> AgentSpan:
        """将数据库行转换为 AgentSpan"""
        from agentlens.models import AgentRole, SpanStatus
        
        def _from_json(s):
            if s is None:
                return None
            try:
                return json.loads(s)
            except:
                return s
        
        return AgentSpan(
            span_id=row["span_id"],
            trace_id=row["trace_id"],
            agent_name=row["agent_name"],
            agent_role=AgentRole(row["agent_role"]),
            model=row["model"] or "",
            start_time=datetime.fromisoformat(row["start_time"]),
            end_time=datetime.fromisoformat(row["end_time"]) if row["end_time"] else None,
            task_description=row["task_description"] or "",
            input_context=_from_json(row["input_context"]) or {},
            output_result=_from_json(row["output_result"]),
            input_tokens=row["input_tokens"] or 0,
            output_tokens=row["output_tokens"] or 0,
            cost_usd=row["cost_usd"] or 0.0,
            latency_ms=row["latency_ms"] or 0,
            tool_calls=[],  # 工具调用单独查询
            parent_span_id=row["parent_span_id"],
            child_span_ids=_from_json(row["child_span_ids"]) or [],
            task_id=row["task_id"] or "",
            project=row["project"] or "",
            status=SpanStatus(row["status"]),
            blocked_by=row["blocked_by"],
            block_reason=row["block_reason"],
        )
    
    async def get_tool_calls_by_span(self, span_id: str) -> List[ToolCall]:
        """获取 Span 下的所有工具调用"""
        sql = "SELECT * FROM tool_calls WHERE span_id = ? ORDER BY timestamp"
        
        async with self._get_connection() as conn:
            def _execute():
                rows = conn.execute(sql, (span_id,)).fetchall()
                return [dict(row) for row in rows]
            
            loop = asyncio.get_event_loop()
            rows = await loop.run_in_executor(None, _execute)
            
            def _from_json(s):
                try:
                    return json.loads(s)
                except:
                    return s
            
            return [
                ToolCall(
                    tool_name=row["tool_name"],
                    input_args=_from_json(row["input_args"]) or {},
                    output_result=_from_json(row["output_result"]),
                    duration_ms=row["duration_ms"] or 0,
                    success=bool(row["success"]),
                    error_message=row["error_message"],
                )
                for row in rows
            ]
    
    async def get_stats(self) -> Dict[str, Any]:
        """获取存储统计"""
        queries = {
            "total_spans": "SELECT COUNT(*) FROM spans",
            "total_tool_calls": "SELECT COUNT(*) FROM tool_calls",
            "total_llm_requests": "SELECT COUNT(*) FROM llm_requests",
            "total_tokens": "SELECT SUM(input_tokens + output_tokens) FROM spans",
            "total_cost": "SELECT SUM(cost_usd) FROM spans",
            "avg_latency": "SELECT AVG(latency_ms) FROM spans WHERE latency_ms > 0",
        }
        
        stats = {}
        async with self._get_connection() as conn:
            def _execute():
                result = {}
                for key, sql in queries.items():
                    value = conn.execute(sql).fetchone()[0]
                    result[key] = value or 0
                return result
            
            loop = asyncio.get_event_loop()
            stats = await loop.run_in_executor(None, _execute)
        
        return stats
    
    async def flush(self) -> None:
        """强制刷新缓冲区"""
        async with self._batch_lock:
            if self._span_batch:
                batch = self._span_batch.copy()
                self._span_batch.clear()
                await self._flush_spans(batch)
            
            if self._tool_batch:
                batch = self._tool_batch.copy()
                self._tool_batch.clear()
                await self._flush_tool_calls(batch)
    
    async def close(self) -> None:
        """关闭存储连接"""
        await self.flush()
        
        while not self._pool.empty():
            conn = await self._pool.get()
            
            def _close():
                conn.close()
            
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, _close)


class MemoryStorage:
    """
    内存存储后端（用于测试）
    """
    
    def __init__(self):
        self._spans: Dict[str, AgentSpan] = {}
        self._tool_calls: Dict[str, List[ToolCall]] = {}
        self._llm_requests: Dict[str, Any] = {}
        self._llm_responses: Dict[str, Any] = {}
    
    async def store_span(self, span: AgentSpan) -> None:
        self._spans[span.span_id] = span
    
    async def store_tool_call(self, span_id: str, tool_call: ToolCall) -> None:
        if span_id not in self._tool_calls:
            self._tool_calls[span_id] = []
        self._tool_calls[span_id].append(tool_call)
    
    async def get_span(self, span_id: str) -> Optional[AgentSpan]:
        return self._spans.get(span_id)
    
    async def get_spans_by_trace(self, trace_id: str) -> List[AgentSpan]:
        return [s for s in self._spans.values() if s.trace_id == trace_id]
    
    async def get_spans_by_agent(
        self,
        agent_name: str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        limit: int = 100,
    ) -> List[AgentSpan]:
        spans = [s for s in self._spans.values() if s.agent_name == agent_name]
        
        if start_time:
            spans = [s for s in spans if s.start_time >= start_time]
        if end_time:
            spans = [s for s in spans if s.start_time <= end_time]
        
        spans.sort(key=lambda s: s.start_time, reverse=True)
        return spans[:limit]
    
    async def flush(self) -> None:
        pass
    
    async def close(self) -> None:
        pass
    
    def clear(self) -> None:
        """清空所有数据"""
        self._spans.clear()
        self._tool_calls.clear()
        self._llm_requests.clear()
        self._llm_responses.clear()
