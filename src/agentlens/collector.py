"""AgentLens Collector - 数据收集器

用于拦截和收集 Agent 执行数据
"""

import asyncio
import json
import time
from typing import Dict, Any, Optional, List
from dataclasses import dataclass, asdict
from datetime import datetime
from contextvars import ContextVar
import httpx

# 当前 Trace 上下文
current_trace: ContextVar[Optional['Trace']] = ContextVar('current_trace', default=None)


@dataclass
class ToolCall:
    """工具调用记录"""
    tool_name: str
    input_args: Dict[str, Any]
    output_result: Any
    start_time: float
    end_time: float
    status: str = "success"
    error_message: Optional[str] = None
    
    @property
    def duration_ms(self) -> int:
        return int((self.end_time - self.start_time) * 1000)


@dataclass
class Trace:
    """执行追踪记录"""
    trace_id: str
    platform: str
    agent_name: str
    session_id: str
    
    # 时间
    start_time: float
    end_time: Optional[float] = None
    
    # LLM
    model: str = ""
    prompt: str = ""
    response: str = ""
    input_tokens: int = 0
    output_tokens: int = 0
    
    # 工具调用
    tool_calls: List[ToolCall] = None
    
    # 状态
    status: str = "running"
    error_message: str = ""
    
    # 元数据
    metadata: Dict[str, Any] = None
    
    def __post_init__(self):
        if self.tool_calls is None:
            self.tool_calls = []
        if self.metadata is None:
            self.metadata = {}
    
    def complete(self, response: str = "", tokens_in: int = 0, tokens_out: int = 0):
        """标记完成"""
        self.end_time = time.time()
        self.response = response
        self.input_tokens = tokens_in
        self.output_tokens = tokens_out
        self.status = "success"
    
    def fail(self, error: str):
        """标记失败"""
        self.end_time = time.time()
        self.status = "error"
        self.error_message = error
    
    def add_tool_call(self, tool_call: ToolCall):
        """添加工具调用"""
        self.tool_calls.append(tool_call)
    
    @property
    def duration_ms(self) -> int:
        if self.end_time:
            return int((self.end_time - self.start_time) * 1000)
        return int((time.time() - self.start_time) * 1000)
    
    @property
    def cost_usd(self) -> float:
        """估算成本"""
        # 简化模型: $0.001 / 1K tokens
        total = self.input_tokens + self.output_tokens
        return (total / 1000) * 0.001
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "trace_id": self.trace_id,
            "platform": self.platform,
            "agent_name": self.agent_name,
            "session_id": self.session_id,
            "start_time": datetime.fromtimestamp(self.start_time).isoformat(),
            "end_time": datetime.fromtimestamp(self.end_time).isoformat() if self.end_time else None,
            "duration_ms": self.duration_ms,
            "model": self.model,
            "prompt": self.prompt[:500] + "..." if len(self.prompt) > 500 else self.prompt,
            "response": self.response[:500] + "..." if len(self.response) > 500 else self.response,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.cost_usd, 6),
            "tool_calls": [
                {
                    "tool_name": tc.tool_name,
                    "duration_ms": tc.duration_ms,
                    "status": tc.status
                }
                for tc in self.tool_calls
            ],
            "status": self.status,
            "error_message": self.error_message,
        }


class Collector:
    """数据收集器"""
    
    def __init__(
        self,
        platform: str,
        agent_name: str = "default",
        server_url: str = "http://localhost:8080",
        batch_size: int = 10,
        flush_interval: float = 5.0
    ):
        self.platform = platform
        self.agent_name = agent_name
        self.server_url = server_url
        self.batch_size = batch_size
        self.flush_interval = flush_interval
        
        self._traces: List[Trace] = []
        self._session_id = f"{platform}_{int(time.time())}"
        self._client = httpx.AsyncClient()
        self._flush_task: Optional[asyncio.Task] = None
        self._running = False
    
    async def start(self):
        """启动收集器"""
        self._running = True
        self._flush_task = asyncio.create_task(self._flush_loop())
    
    async def stop(self):
        """停止收集器"""
        self._running = False
        if self._flush_task:
            self._flush_task.cancel()
            try:
                await self._flush_task
            except asyncio.CancelledError:
                pass
        # 最后刷新
        await self._flush()
        await self._client.aclose()
    
    def start_trace(
        self,
        model: str = "",
        prompt: str = "",
        trace_id: Optional[str] = None
    ) -> Trace:
        """开始新的 Trace"""
        import uuid
        
        trace = Trace(
            trace_id=trace_id or str(uuid.uuid4())[:8],
            platform=self.platform,
            agent_name=self.agent_name,
            session_id=self._session_id,
            start_time=time.time(),
            model=model,
            prompt=prompt,
        )
        
        current_trace.set(trace)
        return trace
    
    def end_trace(
        self,
        trace: Trace,
        response: str = "",
        tokens_in: int = 0,
        tokens_out: int = 0
    ):
        """结束 Trace"""
        trace.complete(response, tokens_in, tokens_out)
        self._traces.append(trace)
        current_trace.set(None)
        
        # 如果达到批量大小，立即刷新
        if len(self._traces) >= self.batch_size:
            asyncio.create_task(self._flush())
    
    def trace_tool_call(self, tool_name: str, input_args: Dict[str, Any]):
        """装饰器：追踪工具调用"""
        def decorator(func):
            async def async_wrapper(*args, **kwargs):
                trace = current_trace.get()
                start_time = time.time()
                
                try:
                    result = await func(*args, **kwargs)
                    tool_call = ToolCall(
                        tool_name=tool_name,
                        input_args=input_args or kwargs,
                        output_result=result,
                        start_time=start_time,
                        end_time=time.time(),
                        status="success"
                    )
                    if trace:
                        trace.add_tool_call(tool_call)
                    return result
                except Exception as e:
                    tool_call = ToolCall(
                        tool_name=tool_name,
                        input_args=input_args or kwargs,
                        output_result=None,
                        start_time=start_time,
                        end_time=time.time(),
                        status="error",
                        error_message=str(e)
                    )
                    if trace:
                        trace.add_tool_call(tool_call)
                    raise
            
            def sync_wrapper(*args, **kwargs):
                trace = current_trace.get()
                start_time = time.time()
                
                try:
                    result = func(*args, **kwargs)
                    tool_call = ToolCall(
                        tool_name=tool_name,
                        input_args=input_args or kwargs,
                        output_result=result,
                        start_time=start_time,
                        end_time=time.time(),
                        status="success"
                    )
                    if trace:
                        trace.add_tool_call(tool_call)
                    return result
                except Exception as e:
                    tool_call = ToolCall(
                        tool_name=tool_name,
                        input_args=input_args or kwargs,
                        output_result=None,
                        start_time=start_time,
                        end_time=time.time(),
                        status="error",
                        error_message=str(e)
                    )
                    if trace:
                        trace.add_tool_call(tool_call)
                    raise
            
            import asyncio
            if asyncio.iscoroutinefunction(func):
                return async_wrapper
            return sync_wrapper
        return decorator
    
    async def _flush_loop(self):
        """定期刷新循环"""
        while self._running:
            try:
                await asyncio.sleep(self.flush_interval)
                if self._traces:
                    await self._flush()
            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"Flush error: {e}")
    
    async def _flush(self):
        """刷新数据到服务器"""
        if not self._traces:
            return
        
        traces_to_send = self._traces[:]
        self._traces = []
        
        try:
            data = {
                "traces": [t.to_dict() for t in traces_to_send],
                "session_id": self._session_id,
            }
            
            response = await self._client.post(
                f"{self.server_url}/api/v1/traces/batch",
                json=data,
                timeout=10.0
            )
            response.raise_for_status()
            
        except Exception as e:
            # 发送失败，重新加入队列
            self._traces.extend(traces_to_send)
            print(f"Failed to send traces: {e}")


# 便捷函数
def create_collector(
    platform: str,
    agent_name: str = "default",
    server_url: str = "http://localhost:8080"
) -> Collector:
    """创建收集器"""
    return Collector(platform, agent_name, server_url)
