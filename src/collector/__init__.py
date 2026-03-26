"""
AgentLens Collector - 数据收集器

负责拦截 Agent 的工具调用、捕获 LLM 请求/响应，并异步写入存储。
采用异步架构，最小化对 Agent 性能的影响。
"""

from __future__ import annotations

import asyncio
import functools
import time
import uuid
from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Callable, Coroutine, Dict, List, Optional, Protocol, TypeVar, Union

from agentlens.models import AgentRole, AgentSpan, SpanStatus, ToolCall


# 类型定义
T = TypeVar("T")
AsyncCallable = Callable[..., Coroutine[Any, Any, T]]


class StorageBackend(Protocol):
    """存储后端协议"""
    
    async def store_span(self, span: AgentSpan) -> None:
        """存储 Span"""
        ...
    
    async def store_tool_call(self, span_id: str, tool_call: ToolCall) -> None:
        """存储工具调用"""
        ...
    
    async def flush(self) -> None:
        """强制刷新缓冲区"""
        ...


@dataclass
class LLMRequest:
    """LLM 请求记录"""
    request_id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    span_id: str = ""
    model: str = ""
    messages: List[Dict[str, Any]] = field(default_factory=list)
    temperature: float = 0.7
    max_tokens: Optional[int] = None
    timestamp: datetime = field(default_factory=datetime.now)
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "request_id": self.request_id,
            "span_id": self.span_id,
            "model": self.model,
            "message_count": len(self.messages),
            "temperature": self.temperature,
            "max_tokens": self.max_tokens,
            "timestamp": self.timestamp.isoformat(),
        }


@dataclass
class LLMResponse:
    """LLM 响应记录"""
    response_id: str = field(default_factory=lambda: str(uuid.uuid4())[:12])
    request_id: str = ""
    span_id: str = ""
    content: str = ""
    finish_reason: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    timestamp: datetime = field(default_factory=datetime.now)
    
    @property
    def total_tokens(self) -> int:
        return self.input_tokens + self.output_tokens
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "response_id": self.response_id,
            "request_id": self.request_id,
            "span_id": self.span_id,
            "content_preview": self.content[:100] + "..." if len(self.content) > 100 else self.content,
            "finish_reason": self.finish_reason,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "total_tokens": self.total_tokens,
            "latency_ms": self.latency_ms,
            "timestamp": self.timestamp.isoformat(),
        }


# 当前上下文
_current_span: ContextVar[Optional[AgentSpan]] = ContextVar("collector_span", default=None)
_current_trace_id: ContextVar[str] = ContextVar("trace_id", default="")


class AsyncCollector:
    """
    异步数据收集器
    
    特性：
    - 异步写入，不阻塞 Agent 执行
    - 批量缓冲，减少 I/O 次数
    - 自动重试，确保数据不丢失
    - 内存控制，防止 OOM
    """
    
    def __init__(
        self,
        storage: Optional[StorageBackend] = None,
        buffer_size: int = 100,
        flush_interval_ms: float = 1000,
        max_retries: int = 3,
    ):
        self.storage = storage
        self.buffer_size = buffer_size
        self.flush_interval_ms = flush_interval_ms
        self.max_retries = max_retries
        
        # 缓冲区
        self._span_buffer: List[AgentSpan] = []
        self._tool_buffer: List[tuple] = []  # (span_id, ToolCall)
        self._llm_request_buffer: List[LLMRequest] = []
        self._llm_response_buffer: List[LLMResponse] = []
        
        # 锁和任务
        self._lock = asyncio.Lock()
        self._flush_task: Optional[asyncio.Task] = None
        self._running = False
        
        # 统计
        self._stats = {
            "spans_collected": 0,
            "tool_calls_collected": 0,
            "llm_requests_collected": 0,
            "llm_responses_collected": 0,
            "flush_count": 0,
            "errors": 0,
        }
    
    async def start(self) -> None:
        """启动收集器"""
        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
    
    async def stop(self) -> None:
        """停止收集器并刷新缓冲区"""
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        await self.flush()
    
    async def _flush_loop(self) -> None:
        """定时刷新循环"""
        while self._running:
            try:
                await asyncio.sleep(self.flush_interval_ms / 1000)
                await self.flush()
            except asyncio.CancelledError:
                break
            except Exception:
                pass  # 忽略定时刷新错误
    
    async def flush(self) -> None:
        """强制刷新缓冲区到存储"""
        if not self.storage:
            return
        
        async with self._lock:
            # 批量写入 Span
            if self._span_buffer:
                for span in self._span_buffer:
                    await self._store_with_retry(self.storage.store_span, span)
                self._span_buffer.clear()
            
            # 批量写入工具调用
            if self._tool_buffer:
                for span_id, tool_call in self._tool_buffer:
                    await self._store_with_retry(
                        self.storage.store_tool_call, span_id, tool_call
                    )
                self._tool_buffer.clear()
            
            # 调用存储层刷新
            await self._store_with_retry(self.storage.flush)
            
            self._stats["flush_count"] += 1
    
    async def _store_with_retry(self, store_func: Callable, *args) -> None:
        """带重试的存储操作"""
        for attempt in range(self.max_retries):
            try:
                await store_func(*args)
                return
            except Exception as e:
                if attempt == self.max_retries - 1:
                    self._stats["errors"] += 1
                    # 记录错误但不抛出，避免影响 Agent
                    print(f"[AgentLens] Storage error after {self.max_retries} retries: {e}")
                else:
                    await asyncio.sleep(0.1 * (attempt + 1))  # 指数退避
    
    async def collect_span(self, span: AgentSpan) -> None:
        """收集 Span"""
        async with self._lock:
            self._span_buffer.append(span)
            self._stats["spans_collected"] += 1
            
            # 达到缓冲区大小则触发刷新
            if len(self._span_buffer) >= self.buffer_size:
                asyncio.create_task(self.flush())
    
    async def collect_tool_call(self, span_id: str, tool_call: ToolCall) -> None:
        """收集工具调用"""
        async with self._lock:
            self._tool_buffer.append((span_id, tool_call))
            self._stats["tool_calls_collected"] += 1
    
    async def collect_llm_request(self, request: LLMRequest) -> None:
        """收集 LLM 请求"""
        async with self._lock:
            self._llm_request_buffer.append(request)
            self._stats["llm_requests_collected"] += 1
    
    async def collect_llm_response(self, response: LLMResponse) -> None:
        """收集 LLM 响应"""
        async with self._lock:
            self._llm_response_buffer.append(response)
            self._stats["llm_responses_collected"] += 1
    
    def get_stats(self) -> Dict[str, Any]:
        """获取收集统计"""
        return {
            **self._stats,
            "buffer_pending": {
                "spans": len(self._span_buffer),
                "tool_calls": len(self._tool_buffer),
                "llm_requests": len(self._llm_request_buffer),
                "llm_responses": len(self._llm_response_buffer),
            }
        }


class ToolInterceptor:
    """
    工具调用拦截器
    
    用于包装 Agent 的工具函数，自动记录调用信息。
    """
    
    def __init__(self, collector: AsyncCollector):
        self.collector = collector
    
    def intercept(self, tool_func: Callable) -> Callable:
        """
        拦截同步工具函数
        
        用法：
            @interceptor.intercept
            def my_tool(arg1, arg2):
                ...
        """
        @functools.wraps(tool_func)
        def wrapper(*args, **kwargs) -> Any:
            span = _current_span.get()
            span_id = span.span_id if span else ""
            
            start_time = time.perf_counter()
            success = True
            error_message = None
            result = None
            
            try:
                result = tool_func(*args, **kwargs)
                return result
            except Exception as e:
                success = False
                error_message = str(e)
                raise
            finally:
                duration_ms = int((time.perf_counter() - start_time) * 1000)
                
                # 异步记录工具调用
                tool_call = ToolCall(
                    tool_name=tool_func.__name__,
                    input_args={"args": args, "kwargs": kwargs},
                    output_result=result,
                    duration_ms=duration_ms,
                    success=success,
                    error_message=error_message,
                )
                
                # 非阻塞异步收集
                asyncio.create_task(
                    self.collector.collect_tool_call(span_id, tool_call)
                )
        
        return wrapper
    
    def intercept_async(self, tool_func: AsyncCallable) -> AsyncCallable:
        """
        拦截异步工具函数
        
        用法：
            @interceptor.intercept_async
            async def my_async_tool(arg1, arg2):
                ...
        """
        @functools.wraps(tool_func)
        async def wrapper(*args, **kwargs) -> Any:
            span = _current_span.get()
            span_id = span.span_id if span else ""
            
            start_time = time.perf_counter()
            success = True
            error_message = None
            result = None
            
            try:
                result = await tool_func(*args, **kwargs)
                return result
            except Exception as e:
                success = False
                error_message = str(e)
                raise
            finally:
                duration_ms = int((time.perf_counter() - start_time) * 1000)
                
                tool_call = ToolCall(
                    tool_name=tool_func.__name__,
                    input_args={"args": str(args), "kwargs": str(kwargs)},
                    output_result=result,
                    duration_ms=duration_ms,
                    success=success,
                    error_message=error_message,
                )
                
                asyncio.create_task(
                    self.collector.collect_tool_call(span_id, tool_call)
                )
        
        return wrapper


class LLMInterceptor:
    """
    LLM 调用拦截器
    
    用于包装 LLM API 调用，自动记录请求和响应。
    """
    
    def __init__(self, collector: AsyncCollector):
        self.collector = collector
    
    async def intercept_llm_call(
        self,
        model: str,
        messages: List[Dict[str, Any]],
        call_func: Callable[..., Coroutine[Any, Any, T]],
        *args,
        **kwargs
    ) -> T:
        """
        拦截 LLM 调用
        
        用法：
            response = await llm_interceptor.intercept_llm_call(
                model="gpt-4",
                messages=messages,
                call_func=openai_client.chat.completions.create,
                # ... 其他参数
            )
        """
        span = _current_span.get()
        span_id = span.span_id if span else ""
        
        # 记录请求
        request = LLMRequest(
            span_id=span_id,
            model=model,
            messages=messages,
            temperature=kwargs.get("temperature", 0.7),
            max_tokens=kwargs.get("max_tokens"),
        )
        await self.collector.collect_llm_request(request)
        
        start_time = time.perf_counter()
        
        try:
            result = await call_func(*args, **kwargs)
            
            # 解析响应（适配不同 LLM 格式）
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            response = self._parse_llm_response(result, request.request_id, span_id, latency_ms)
            await self.collector.collect_llm_response(response)
            
            # 更新当前 Span 的 Token 信息
            if span:
                span.input_tokens += response.input_tokens
                span.output_tokens += response.output_tokens
            
            return result
            
        except Exception as e:
            # 记录错误响应
            latency_ms = int((time.perf_counter() - start_time) * 1000)
            response = LLMResponse(
                request_id=request.request_id,
                span_id=span_id,
                content=str(e),
                finish_reason="error",
                latency_ms=latency_ms,
            )
            await self.collector.collect_llm_response(response)
            raise
    
    def _parse_llm_response(
        self,
        result: Any,
        request_id: str,
        span_id: str,
        latency_ms: int
    ) -> LLMResponse:
        """解析 LLM 响应，适配不同提供商格式"""
        response = LLMResponse(
            request_id=request_id,
            span_id=span_id,
            latency_ms=latency_ms,
        )
        
        # OpenAI / Anthropic 格式
        if hasattr(result, "choices") and result.choices:
            choice = result.choices[0]
            if hasattr(choice, "message"):
                response.content = choice.message.content or ""
            if hasattr(choice, "finish_reason"):
                response.finish_reason = choice.finish_reason or ""
        
        # Token 使用
        if hasattr(result, "usage"):
            usage = result.usage
            if hasattr(usage, "prompt_tokens"):
                response.input_tokens = usage.prompt_tokens
            if hasattr(usage, "completion_tokens"):
                response.output_tokens = usage.completion_tokens
            if hasattr(usage, "input_tokens"):  # Anthropic 格式
                response.input_tokens = usage.input_tokens
            if hasattr(usage, "output_tokens"):
                response.output_tokens = usage.output_tokens
        
        return response


class SpanContext:
    """
    Span 上下文管理器
    
    用于创建和管理 Agent 执行 Span。
    """
    
    def __init__(
        self,
        collector: AsyncCollector,
        agent_name: str,
        role: AgentRole,
        model: str = "claude-3-5-sonnet",
        task_description: str = "",
        task_id: str = "",
        project: str = "",
        trace_id: str = "",
    ):
        self.collector = collector
        self.agent_name = agent_name
        self.role = role
        self.model = model
        self.task_description = task_description
        self.task_id = task_id
        self.project = project
        self.trace_id = trace_id or str(uuid.uuid4())[:12]
        
        self.span: Optional[AgentSpan] = None
        self._parent_span: Optional[AgentSpan] = None
        self._token: Optional[Any] = None
    
    async def __aenter__(self) -> AgentSpan:
        """进入上下文，创建 Span"""
        # 保存父 Span
        self._parent_span = _current_span.get()
        
        # 创建新 Span
        self.span = AgentSpan(
            trace_id=self.trace_id,
            agent_name=self.agent_name,
            agent_role=self.role,
            model=self.model,
            task_description=self.task_description,
            task_id=self.task_id,
            project=self.project,
            parent_span_id=self._parent_span.span_id if self._parent_span else None,
        )
        
        # 设置当前上下文
        self._token = _current_span.set(self.span)
        
        return self.span
    
    async def __aexit__(self, exc_type, exc_val, exc_tb) -> None:
        """退出上下文，完成 Span"""
        if self.span:
            if exc_val:
                self.span.fail(str(exc_val))
            else:
                self.span.complete(output=self.span.output_result)
            
            # 异步收集 Span
            await self.collector.collect_span(self.span)
        
        # 恢复父上下文
        if self._token:
            _current_span.reset(self._token)


def trace_agent(
    collector: AsyncCollector,
    agent_name: str,
    role: Union[str, AgentRole] = AgentRole.BACKEND_DEV,
    model: str = "claude-3-5-sonnet",
    task_description: str = "",
):
    """
    装饰器：追踪 Agent 函数
    
    用法：
        collector = AsyncCollector(storage=sqlite_storage)
        
        @trace_agent(collector, agent_name="Backend-Bob", role="backend_dev")
        async def implement_api(task):
            # 你的代码
            pass
    """
    role_enum = role if isinstance(role, AgentRole) else AgentRole(role)
    
    def decorator(func: AsyncCallable) -> AsyncCallable:
        @functools.wraps(func)
        async def wrapper(*args, **kwargs) -> Any:
            async with SpanContext(
                collector=collector,
                agent_name=agent_name,
                role=role_enum,
                model=model,
                task_description=task_description or func.__name__,
            ) as span:
                result = await func(*args, **kwargs)
                span.output_result = result
                return result
        
        return wrapper
    return decorator


# 全局收集器实例（懒加载）
_global_collector: Optional[AsyncCollector] = None


def get_global_collector() -> Optional[AsyncCollector]:
    """获取全局收集器实例"""
    return _global_collector


def set_global_collector(collector: AsyncCollector) -> None:
    """设置全局收集器实例"""
    global _global_collector
    _global_collector = collector
