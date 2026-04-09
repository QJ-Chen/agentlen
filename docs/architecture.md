# AgentLens 架构设计文档

## 1. 系统概述

AgentLens 是一个轻量级 Agent 执行观测平台，专注于多平台 Agent 的 Trace 收集、成本监控和执行可视化。

### 1.1 设计原则
- **轻量级**：适合中小团队快速部署
- **成本敏感**：Token 优化，采样策略
- **多平台**：支持 OpenClaw、Claude Code、Kimi Code 等
- **可扩展**：插件化架构，易于添加新平台

---

## 2. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│                        Agent 执行环境                            │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  OpenClaw    │  │ Claude Code  │  │  Kimi Code   │  ...      │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘           │
│         │                 │                 │                   │
│         └─────────────────┼─────────────────┘                   │
│                           │                                     │
│                    ┌──────▼───────┐                             │
│                    │   SDK/Hook   │  ← 平台适配层                │
│                    └──────┬───────┘                             │
└───────────────────────────┼─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      AgentLens Core                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │  Collector   │  │   Storage    │  │     API      │           │
│  │  (数据收集)   │  │  (数据存储)   │  │   (REST)     │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Dashboard (React)                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐           │
│  │ Trace 视图   │  │  成本分析    │  │  实时监控    │           │
│  └──────────────┘  └──────────────┘  └──────────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 数据收集器设计 (Collector)

### 3.1 核心抽象

```python
# collector/base.py
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Dict, List, Optional, Any
from enum import Enum
import time
import uuid

class PlatformType(Enum):
    OPENCLAW = "openclaw"
    CLAUDE_CODE = "claude_code"
    KIMI_CODE = "kimi_code"
    CURSOR = "cursor"
    CUSTOM = "custom"

@dataclass
class TraceContext:
    """Trace 上下文，贯穿整个 Agent 执行周期"""
    trace_id: str
    session_id: str
    platform: PlatformType
    start_time: float
    metadata: Dict[str, Any]
    
    @classmethod
    def create(cls, platform: PlatformType, metadata: Dict = None) -> "TraceContext":
        return cls(
            trace_id=str(uuid.uuid4()),
            session_id=str(uuid.uuid4()),
            platform=platform,
            start_time=time.time(),
            metadata=metadata or {}
        )

@dataclass
class Span:
    """执行单元（工具调用、LLM 请求等）"""
    span_id: str
    trace_id: str
    parent_id: Optional[str]
    name: str
    span_type: str  # "tool", "llm", "agent", "custom"
    start_time: float
    end_time: Optional[float]
    duration_ms: Optional[float]
    status: str  # "running", "success", "error"
    input_data: Dict[str, Any]
    output_data: Dict[str, Any]
    token_usage: Optional["TokenUsage"]
    error: Optional[str]
    metadata: Dict[str, Any]

@dataclass
class TokenUsage:
    """Token 消耗统计"""
    prompt_tokens: int
    completion_tokens: int
    total_tokens: int
    model: str
    cost_usd: Optional[float] = None

class BaseCollector(ABC):
    """数据收集器基类"""
    
    def __init__(self, config: Dict[str, Any]):
        self.config = config
        self.sampler = Sampler(config.get("sampling", {}))
        self.exporter = self._create_exporter()
    
    @abstractmethod
    def _create_exporter(self) -> "BaseExporter":
        """创建数据导出器"""
        pass
    
    def start_trace(self, metadata: Dict = None) -> TraceContext:
        """开始一个新的 Trace"""
        if not self.sampler.should_sample():
            return None
        context = TraceContext.create(self.platform, metadata)
        self.exporter.export_trace_start(context)
        return context
    
    def start_span(self, context: TraceContext, name: str, 
                   span_type: str, parent_id: str = None) -> Span:
        """开始一个新的 Span"""
        span = Span(
            span_id=str(uuid.uuid4()),
            trace_id=context.trace_id,
            parent_id=parent_id,
            name=name,
            span_type=span_type,
            start_time=time.time(),
            end_time=None,
            duration_ms=None,
            status="running",
            input_data={},
            output_data={},
            token_usage=None,
            error=None,
            metadata={}
        )
        return span
    
    def end_span(self, span: Span, output_data: Dict = None, 
                 token_usage: TokenUsage = None, error: str = None):
        """结束 Span"""
        span.end_time = time.time()
        span.duration_ms = (span.end_time - span.start_time) * 1000
        span.status = "error" if error else "success"
        span.output_data = output_data or {}
        span.token_usage = token_usage
        span.error = error
        self.exporter.export_span(span)
    
    def end_trace(self, context: TraceContext):
        """结束 Trace"""
        self.exporter.export_trace_end(context)

class Sampler:
    """采样器 - 控制数据收集成本"""
    
    def __init__(self, config: Dict):
        self.rate = config.get("rate", 1.0)  # 采样率 0-1
        self.max_traces_per_min = config.get("max_traces_per_min", 100)
        self._trace_count = 0
        self._reset_time = time.time()
    
    def should_sample(self) -> bool:
        now = time.time()
        if now - self._reset_time > 60:
            self._trace_count = 0
            self._reset_time = now
        
        if self._trace_count >= self.max_traces_per_min:
            return False
        
        import random
        if random.random() > self.rate:
            return False
        
        self._trace_count += 1
        return True
```

### 3.2 平台适配器

#### OpenClaw 适配器

```python
# collector/adapters/openclaw_adapter.py
from collector.base import BaseCollector, Span, TokenUsage
from typing import Dict, Any

class OpenClawCollector(BaseCollector):
    """OpenClaw 平台数据收集器"""
    
    platform = "openclaw"
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
        self._current_trace = None
        self._span_stack = []
    
    def _create_exporter(self):
        from collector.exporters import get_exporter
        return get_exporter(self.config.get("exporter", {"type": "sqlite"}))
    
    def on_tool_start(self, tool_name: str, params: Dict):
        """工具调用开始"""
        if not self._current_trace:
            self._current_trace = self.start_trace()
        
        parent_id = self._span_stack[-1].span_id if self._span_stack else None
        span = self.start_span(
            context=self._current_trace,
            name=f"tool:{tool_name}",
            span_type="tool",
            parent_id=parent_id
        )
        span.input_data = {"params": params}
        self._span_stack.append(span)
        return span.span_id
    
    def on_tool_end(self, span_id: str, result: Any, error: str = None):
        """工具调用结束"""
        span = self._find_span(span_id)
        if span:
            self.end_span(span, output_data={"result": result}, error=error)
            self._span_stack.remove(span)
    
    def on_llm_start(self, model: str, messages: list, params: Dict):
        """LLM 请求开始"""
        if not self._current_trace:
            self._current_trace = self.start_trace()
        
        parent_id = self._span_stack[-1].span_id if self._span_stack else None
        span = self.start_span(
            context=self._current_trace,
            name=f"llm:{model}",
            span_type="llm",
            parent_id=parent_id
        )
        span.input_data = {
            "model": model,
            "messages": self._truncate_messages(messages),
            "params": params
        }
        self._span_stack.append(span)
        return span.span_id
    
    def on_llm_end(self, span_id: str, response: Dict, token_usage: Dict):
        """LLM 请求结束"""
        span = self._find_span(span_id)
        if span:
            usage = TokenUsage(
                prompt_tokens=token_usage.get("prompt_tokens", 0),
                completion_tokens=token_usage.get("completion_tokens", 0),
                total_tokens=token_usage.get("total_tokens", 0),
                model=span.input_data.get("model", "unknown"),
                cost_usd=self._calculate_cost(token_usage, span.input_data.get("model"))
            )
            self.end_span(span, output_data={"response": response}, token_usage=usage)
            self._span_stack.remove(span)
    
    def _truncate_messages(self, messages: list, max_chars: int = 1000) -> list:
        """截断消息内容，减少存储"""
        truncated = []
        for msg in messages:
            content = msg.get("content", "")
            if len(content) > max_chars:
                content = content[:max_chars] + "... [truncated]"
            truncated.append({**msg, "content": content})
        return truncated
    
    def _calculate_cost(self, usage: Dict, model: str) -> float:
        """计算 Token 成本"""
        pricing = {
            "gpt-4": {"prompt": 0.03, "completion": 0.06},
            "gpt-3.5-turbo": {"prompt": 0.0015, "completion": 0.002},
            "claude-3-opus": {"prompt": 0.015, "completion": 0.075},
            "claude-3-sonnet": {"prompt": 0.003, "completion": 0.015},
        }
        rates = pricing.get(model, pricing["gpt-3.5-turbo"])
        prompt_cost = usage.get("prompt_tokens", 0) * rates["prompt"] / 1000
        completion_cost = usage.get("completion_tokens", 0) * rates["completion"] / 1000
        return round(prompt_cost + completion_cost, 6)
    
    def _find_span(self, span_id: str) -> Span:
        for span in self._span_stack:
            if span.span_id == span_id:
                return span
        return None
```

#### Claude Code 适配器

```python
# collector/adapters/claude_code_adapter.py
from collector.base import BaseCollector
from typing import Dict, Any

class ClaudeCodeCollector(BaseCollector):
    """Claude Code 平台数据收集器"""
    
    platform = "claude_code"
    
    def __init__(self, config: Dict[str, Any]):
        super().__init__(config)
    
    def _create_exporter(self):
        from collector.exporters import get_exporter
        return get_exporter(self.config.get("exporter", {"type": "sqlite"}))
    
    def on_command_start(self, command: str, cwd: str):
        """命令执行开始"""
        pass
    
    def on_command_end(self, exit_code: int, output: str):
        """命令执行结束"""
        pass
    
    def on_file_read(self, path: str, content: str):
        """文件读取"""
        pass
    
    def on_file_edit(self, path: str, old_text: str, new_text: str):
        """文件编辑"""
        pass
```

---

## 4. 数据模型设计

### 4.1 Trace 数据模型

```python
# models/trace.py
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Any
from datetime import datetime
from enum import Enum

class SpanType(Enum):
    TOOL = "tool"
    LLM = "llm"
    AGENT = "agent"
    THOUGHT = "thought"
    CUSTOM = "custom"

class SpanStatus(Enum):
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    CANCELLED = "cancelled"

@dataclass
class TokenUsage:
    """Token 使用统计"""
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0
    model: str = ""
    cost_usd: float = 0.0

@dataclass
class Span:
    """执行单元"""
    span_id: str
    trace_id: str
    parent_id: Optional[str] = None
    name: str = ""
    span_type: str = "custom"
    status: str = "running"
    start_time: datetime = field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    duration_ms: Optional[float] = None
    input_data: Dict[str, Any] = field(default_factory=dict)
    output_data: Dict[str, Any] = field(default_factory=dict)
    token_usage: Optional[TokenUsage] = None
    error: Optional[str] = None
    error_type: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)

@dataclass
class Trace:
    """完整的执行追踪"""
    trace_id: str
    session_id: str
    platform: str
    platform_version: Optional[str] = None
    start_time: datetime = field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    duration_ms: Optional[float] = None
    status: str = "running"
    total_spans: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    error_count: int = 0
    root_span_id: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)
    tags: List[str] = field(default_factory=list)
    user_id: Optional[str] = None
    project_id: Optional[str] = None

@dataclass
class Session:
    """会话（多个 Trace 的集合）"""
    session_id: str
    start_time: datetime = field(default_factory=datetime.utcnow)
    end_time: Optional[datetime] = None
    platform: str = ""
    user_id: Optional[str] = None
    trace_count: int = 0
    total_tokens: int = 0
    total_cost_usd: float = 0.0
    metadata: Dict[str, Any] = field(default_factory=dict)
```

### 4.2 数据库 Schema (SQLite)

```sql
-- schema.sql
-- 轻量级设计，适合中小团队

-- Trace 表
CREATE TABLE traces (
    trace_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    platform TEXT NOT NULL,
    platform_version TEXT,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    duration_ms REAL,
    status TEXT DEFAULT 'running',
    total_spans INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0.0,
    error_count INTEGER DEFAULT 0,
    root_span_id TEXT,
    metadata TEXT,
    tags TEXT,
    user_id TEXT,
    project_id TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Span 表
CREATE TABLE spans (
    span_id TEXT PRIMARY KEY,
    trace_id TEXT NOT NULL,
    parent_id TEXT,
    name TEXT NOT NULL,
    span_type TEXT NOT NULL,
    status TEXT DEFAULT 'running',
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    duration_ms REAL,
    input_data TEXT,
    output_data TEXT,
    prompt_tokens INTEGER DEFAULT 0,
    completion_tokens INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    model TEXT,
    cost_usd REAL DEFAULT 0.0,
    error TEXT,
    error_type TEXT,
    metadata TEXT,
    tags TEXT,
    FOREIGN KEY (trace_id) REFERENCES traces(trace_id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES spans(span_id) ON DELETE SET NULL
);

-- Session 表
CREATE TABLE sessions (
    session_id TEXT PRIMARY KEY,
    start_time DATETIME NOT NULL,
    end_time DATETIME,
    platform TEXT NOT NULL,
    user_id TEXT,
    trace_count INTEGER DEFAULT 0,
    total_tokens INTEGER DEFAULT 0,
    total_cost_usd REAL DEFAULT 0.0,
    metadata TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 索引优化
CREATE INDEX idx_traces_session ON traces(session_id);
CREATE INDEX idx_traces_platform ON traces(platform);
CREATE INDEX idx_traces_start_time ON traces(start_time);
CREATE INDEX idx_traces_user ON traces(user_id);
CREATE INDEX idx_spans_trace ON spans(trace_id);
CREATE INDEX idx_spans_parent ON spans(parent_id);
CREATE INDEX idx_spans_type ON spans(span_type);
CREATE INDEX idx_spans_start_time ON spans(start_time);

-- 成本统计视图
CREATE VIEW daily_costs AS
SELECT 
    date(start_time) as date,
    platform,
    COUNT(*) as trace_count,
    SUM(total_tokens) as total_tokens,
    SUM(total_cost_usd) as total_cost_usd,
    SUM(error_count) as total_errors