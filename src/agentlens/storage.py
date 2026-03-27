"""AgentLens Storage - 数据存储层"""

import json
import sqlite3
from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path


class Storage:
    """存储基类"""
    
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
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        raise NotImplementedError
    
    def get_stats(self, period_hours: int = 24) -> Dict[str, Any]:
        raise NotImplementedError


class SQLiteStorage(Storage):
    """SQLite 存储实现"""
    
    def __init__(self, db_path: str = "~/.agentlens/agentlens.db"):
        self.db_path = Path(db_path).expanduser()
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()
    
    def _init_db(self):
        """初始化数据库"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
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
                    role TEXT,
                    metadata TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_traces_session 
                ON traces(session_id)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_traces_platform 
                ON traces(platform)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_traces_time 
                ON traces(start_time)
            """)
            
            conn.execute("""
                CREATE TABLE IF NOT EXISTS sessions (
                    session_id TEXT PRIMARY KEY,
                    platform TEXT,
                    agent_name TEXT,
                    start_time TEXT,
                    end_time TEXT,
                    total_traces INTEGER DEFAULT 0,
                    total_tokens INTEGER DEFAULT 0,
                    total_cost REAL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
    
    def save_trace(self, trace: Dict[str, Any]):
        """保存单个 Trace"""
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT OR REPLACE INTO traces (
                    trace_id, platform, agent_name, session_id,
                    start_time, end_time, duration_ms, model,
                    prompt, response, input_tokens, output_tokens,
                    cache_read_tokens, cache_write_tokens,
                    cache_creation_input_tokens, cache_read_input_tokens,
                    cost_usd, tool_calls, status, error_message,
                    project_path, role, metadata
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
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
                json.dumps(trace.get("tool_calls", [])),
                json.dumps(trace.get("llm_calls", [])),
                trace.get("status"),
                trace.get("error_message"),
                trace.get("project_path"),
                trace.get("role"),
                json.dumps(trace.get("metadata", {}))
            ))
    
    def save_traces(self, traces: List[Dict[str, Any]]):
        """批量保存 Traces"""
        with sqlite3.connect(self.db_path) as conn:
            for trace in traces:
                conn.execute("""
                    INSERT OR REPLACE INTO traces (
                        trace_id, platform, agent_name, session_id,
                        start_time, end_time, duration_ms, model,
                        prompt, response, input_tokens, output_tokens,
                        cache_read_tokens, cache_write_tokens,
                        cache_creation_input_tokens, cache_read_input_tokens,
                        cost_usd, tool_calls, llm_calls, status, error_message,
                        project_path, role, metadata
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
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
                    json.dumps(trace.get("tool_calls", [])),
                    json.dumps(trace.get("llm_calls", [])),
                    trace.get("status"),
                    trace.get("error_message"),
                    trace.get("project_path"),
                    trace.get("role"),
                    json.dumps(trace.get("metadata", {}))
                ))
    
    def get_traces(
        self,
        platform: Optional[str] = None,
        session_id: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """查询 Traces"""
        query = "SELECT * FROM traces WHERE 1=1"
        params = []
        
        if platform:
            query += " AND platform = ?"
            params.append(platform)
        
        if session_id:
            query += " AND session_id = ?"
            params.append(session_id)
        
        if start_time:
            query += " AND start_time >= ?"
            params.append(start_time)
        
        if end_time:
            query += " AND start_time <= ?"
            params.append(end_time)
        
        query += " ORDER BY start_time DESC LIMIT ?"
        params.append(limit)
        
        with sqlite3.connect(self.db_path) as conn:
            conn.row_factory = sqlite3.Row
            cursor = conn.execute(query, params)
            rows = cursor.fetchall()
            
            results = []
            for row in rows:
                row_dict = dict(row)
                # Parse JSON fields
                for field in ['tool_calls', 'llm_calls', 'metadata']:
                    if row_dict.get(field):
                        try:
                            row_dict[field] = json.loads(row_dict[field])
                        except:
                            row_dict[field] = [] if field in ['tool_calls', 'llm_calls'] else {}
                results.append(row_dict)
            return results
    
    def get_stats(self, period_hours: int = 24) -> Dict[str, Any]:
        """获取统计信息"""
        with sqlite3.connect(self.db_path) as conn:
            # 基础统计
            cursor = conn.execute("""
                SELECT 
                    COUNT(*) as total_traces,
                    SUM(input_tokens + output_tokens) as total_tokens,
                    SUM(cost_usd) as total_cost,
                    AVG(duration_ms) as avg_duration_ms
                FROM traces
                WHERE start_time >= datetime('now', '-{} hours')
            """.format(period_hours))
            
            row = cursor.fetchone()
            
            # 按平台统计
            cursor = conn.execute("""
                SELECT 
                    platform,
                    COUNT(*) as count,
                    SUM(cost_usd) as cost
                FROM traces
                WHERE start_time >= datetime('now', '-{} hours')
                GROUP BY platform
            """.format(period_hours))
            
            platform_stats = [
                {"platform": r[0], "count": r[1], "cost": round(r[2], 4)}
                for r in cursor.fetchall()
            ]
            
            # 按模型统计
            cursor = conn.execute("""
                SELECT 
                    model,
                    COUNT(*) as count,
                    SUM(cost_usd) as cost
                FROM traces
                WHERE start_time >= datetime('now', '-{} hours')
                GROUP BY model
            """.format(period_hours))
            
            model_stats = [
                {"model": r[0], "count": r[1], "cost": round(r[2], 4)}
                for r in cursor.fetchall()
            ]
            
            return {
                "period_hours": period_hours,
                "total_traces": row[0] or 0,
                "total_tokens": row[1] or 0,
                "total_cost": round(row[2] or 0, 4),
                "avg_duration_ms": round(row[3] or 0, 2),
                "platforms": platform_stats,
                "models": model_stats,
            }


class JSONLStorage(Storage):
    """JSON Lines 存储实现"""
    
    def __init__(self, file_path: str = "~/.agentlens/traces.jsonl"):
        self.file_path = Path(file_path).expanduser()
        self.file_path.parent.mkdir(parents=True, exist_ok=True)
    
    def save_trace(self, trace: Dict[str, Any]):
        """追加写入"""
        with open(self.file_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(trace, ensure_ascii=False) + "\n")
    
    def save_traces(self, traces: List[Dict[str, Any]]):
        """批量写入"""
        with open(self.file_path, "a", encoding="utf-8") as f:
            for trace in traces:
                f.write(json.dumps(trace, ensure_ascii=False) + "\n")
    
    def get_traces(
        self,
        platform: Optional[str] = None,
        session_id: Optional[str] = None,
        start_time: Optional[str] = None,
        end_time: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """读取 Traces（从后向前）"""
        traces = []
        
        if not self.file_path.exists():
            return traces
        
        with open(self.file_path, "r", encoding="utf-8") as f:
            lines = f.readlines()
        
        # 从后向前读取
        for line in reversed(lines):
            if len(traces) >= limit:
                break
            
            try:
                trace = json.loads(line.strip())
                
                # 过滤条件
                if platform and trace.get("platform") != platform:
                    continue
                if session_id and trace.get("session_id") != session_id:
                    continue
                if start_time and trace.get("start_time", "") < start_time:
                    continue
                if end_time and trace.get("start_time", "") > end_time:
                    continue
                
                traces.append(trace)
            except json.JSONDecodeError:
                continue
        
        return traces
    
    def get_stats(self, period_hours: int = 24) -> Dict[str, Any]:
        """简单统计"""
        traces = self.get_traces(limit=10000)
        
        total_cost = sum(t.get("cost_usd", 0) for t in traces)
        total_tokens = sum(t.get("input_tokens", 0) + t.get("output_tokens", 0) for t in traces)
        
        return {
            "period_hours": period_hours,
            "total_traces": len(traces),
            "total_tokens": total_tokens,
            "total_cost": round(total_cost, 4),
            "avg_duration_ms": 0,
            "platforms": [],
            "models": [],
        }
