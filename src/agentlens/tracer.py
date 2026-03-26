"""Agent 调用追踪器"""

import functools
import time
from typing import Optional, Callable, Any, Dict
from contextvars import ContextVar
from .models import AgentSpan, AgentRole, SpanStatus, ToolCall

# 当前 Span 上下文
current_span: ContextVar[Optional[AgentSpan]] = ContextVar("current_span", default=None)
current_session: ContextVar[Optional[Any]] = ContextVar("current_session", default=None)


class AgentTracer:
    """Agent 追踪器"""
    
    def __init__(self, session: Optional[Any] = None):
        self.session = session
        self._spans: list = []
    
    def start_span(
        self,
        agent_name: str,
        role: AgentRole,
        model: str = "claude-3-5-sonnet",
        task_description: str = "",
        task_id: str = "",
        project: str = "",
    ) -> AgentSpan:
        """开始一个新的 Span"""
        span = AgentSpan(
            agent_name=agent_name,
            agent_role=role,
            model=model,
            task_description=task_description,
            task_id=task_id,
            project=project,
        )
        
        # 设置父子关系
        parent = current_span.get()
        if parent:
            span.parent_span_id = parent.span_id
            parent.child_span_ids.append(span.span_id)
        
        # 设置上下文
        current_span.set(span)
        self._spans.append(span)
        
        # 添加到会话
        if self.session:
            self.session.add_span(span)
        
        return span
    
    def end_span(
        self,
        span: AgentSpan,
        output: Any = None,
        tokens_in: int = 0,
        tokens_out: int = 0,
    ):
        """结束 Span"""
        span.complete(output, tokens_in, tokens_out)
        
        # 恢复父上下文
        if span.parent_span_id:
            for s in self._spans:
                if s.span_id == span.parent_span_id:
                    current_span.set(s)
                    break
        else:
            current_span.set(None)
    
    def trace(
        self,
        agent_name: str,
        role: str = "backend_dev",
        model: str = "claude-3-5-sonnet",
        task_description: str = "",
    ):
        """装饰器：自动追踪函数调用"""
        def decorator(func: Callable) -> Callable:
            @functools.wraps(func)
            def wrapper(*args, **kwargs):
                role_enum = AgentRole(role)
                span = self.start_span(
                    agent_name=agent_name,
                    role=role_enum,
                    model=model,
                    task_description=task_description or func.__name__,
                )
                
                try:
                    # 模拟 Token 消耗（实际应从 LLM API 获取）
                    result = func(*args, **kwargs)
                    
                    # 估算 Token（简化）
                    tokens_in = len(str(args)) + len(str(kwargs)) // 4
                    tokens_out = len(str(result)) // 4
                    
                    self.end_span(span, result, tokens_in, tokens_out)
                    return result
                    
                except Exception as e:
                    span.fail(str(e))
                    raise
            
            return wrapper
        return decorator
    
    def get_current_span(self) -> Optional[AgentSpan]:
        """获取当前 Span"""
        return current_span.get()
    
    def add_tool_call(
        self,
        tool_name: str,
        input_args: Dict[str, Any],
        output_result: Any,
        duration_ms: int = 0,
        success: bool = True,
        error_message: Optional[str] = None,
    ):
        """添加工具调用到当前 Span"""
        span = current_span.get()
        if span:
            tool_call = ToolCall(
                tool_name=tool_name,
                input_args=input_args,
                output_result=output_result,
                duration_ms=duration_ms,
                success=success,
                error_message=error_message,
            )
            span.add_tool_call(tool_call)


# 全局追踪器实例
tracer = AgentTracer()


def trace(
    agent_name: str,
    role: str = "backend_dev",
    model: str = "claude-3-5-sonnet",
    task_description: str = "",
):
    """便捷装饰器，使用全局追踪器"""
    return tracer.trace(agent_name, role, model, task_description)
