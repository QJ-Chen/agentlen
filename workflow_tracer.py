"""
AgentLens Workflow Tracer - 深度工作流追踪器

监控 Agent 的实际工作流程：
- 工具调用的完整输入输出
- LLM 请求的提示词和响应
- 执行时间和成本
- 调用链和依赖关系

使用方法:
    # 方式1: 装饰器
    from workflow_tracer import trace_agent, trace_tool
    
    @trace_agent("my-agent")
    class MyAgent:
        @trace_tool("read_file")
        def read_file(self, path):
            ...
    
    # 方式2: 上下文管理器
    from workflow_tracer import WorkflowSession
    
    with WorkflowSession("my-agent") as session:
        result = session.trace_tool("search", query="AI")
        response = session.trace_llm("gpt-4", prompt)
    
    # 方式3: 手动记录
    from workflow_tracer import log_tool_call, log_llm_call
    
    log_tool_call("read_file", {"path": "/tmp/test.txt"}, "file content", 150)
    log_llm_call("gpt-4", "prompt", "response", 100, 50, 0.002)
"""

import functools
import time
import json
import uuid
import requests
from typing import Any, Dict, List, Optional, Callable
from contextlib import contextmanager
from dataclasses import dataclass, field, asdict
from datetime import datetime

API_URL = "http://localhost:8080"


@dataclass
class ToolCall:
    """工具调用记录"""
    tool_name: str
    input_args: Dict[str, Any]
    output: Any
    duration_ms: int
    timestamp: float = field(default_factory=time.time)
    error: Optional[str] = None
    
    def to_dict(self) -> Dict:
        return {
            "name": self.tool_name,
            "input": self.input_args,
            "output": str(self.output)[:1000] if self.output else None,
            "duration_ms": self.duration_ms,
            "timestamp": self.timestamp,
            "error": self.error
        }


@dataclass
class LLMCall:
    """LLM 调用记录"""
    model: str
    prompt: str
    response: str
    input_tokens: int
    output_tokens: int
    cost_usd: float
    duration_ms: int
    timestamp: float = field(default_factory=time.time)
    
    def to_dict(self) -> Dict:
        return {
            "model": self.model,
            "prompt": self.prompt[:500],
            "response": self.response[:500],
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": self.cost_usd,
            "duration_ms": self.duration_ms,
            "timestamp": self.timestamp
        }


class WorkflowTracer:
    """工作流追踪器"""
    
    def __init__(self, agent_name: str, platform: str = "openclaw"):
        self.agent_name = agent_name
        self.platform = platform
        self.session_id = f"{agent_name}_{int(time.time())}"
        self.trace_id = None
        self.tool_calls: List[ToolCall] = []
        self.llm_calls: List[LLMCall] = []
        self.start_time = None
        
    def start_trace(self, task_description: str = ""):
        """开始追踪一个任务"""
        self.trace_id = str(uuid.uuid4())[:8]
        self.start_time = time.time()
        self.tool_calls = []
        self.llm_calls = []
        
        print(f"🔍 [{self.agent_name}] 开始追踪: {task_description or self.trace_id}")
        return self
    
    def end_trace(self, status: str = "success", error: str = ""):
        """结束追踪并发送数据"""
        if not self.start_time:
            return
        
        duration_ms = int((time.time() - self.start_time) * 1000)
        total_tokens = sum(llm.input_tokens + llm.output_tokens for llm in self.llm_calls)
        total_cost = sum(llm.cost_usd for llm in self.llm_calls)
        
        trace_data = {
            "trace_id": self.trace_id or str(uuid.uuid4())[:8],
            "platform": self.platform,
            "agent_name": self.agent_name,
            "session_id": self.session_id,
            "start_time": datetime.fromtimestamp(self.start_time).isoformat(),
            "end_time": datetime.now().isoformat(),
            "duration_ms": duration_ms,
            "model": "workflow",
            "prompt": f"Agent: {self.agent_name}\nTools: {len(self.tool_calls)}\nLLMs: {len(self.llm_calls)}",
            "response": json.dumps({
                "tool_calls": [t.to_dict() for t in self.tool_calls],
                "llm_calls": [l.to_dict() for l in self.llm_calls]
            }),
            "input_tokens": total_tokens,
            "output_tokens": 0,
            "cost_usd": total_cost,
            "tool_calls": json.dumps([t.to_dict() for t in self.tool_calls]),
            "status": status,
            "error_message": error
        }
        
        self._send_trace(trace_data)
        
        print(f"✅ [{self.agent_name}] 追踪完成: {len(self.tool_calls)} 工具, {len(self.llm_calls)} LLM, ${total_cost:.4f}")
        return trace_data
    
    def trace_tool(self, tool_name: str, input_args: Dict[str, Any], output: Any, duration_ms: int, error: str = ""):
        """记录工具调用"""
        tool_call = ToolCall(
            tool_name=tool_name,
            input_args=input_args,
            output=output,
            duration_ms=duration_ms,
            error=error if error else None
        )
        self.tool_calls.append(tool_call)
        
        status = "✓" if not error else "✗"
        print(f"  {status} {tool_name}({self._format_args(input_args)}) -> {str(output)[:50]}... [{duration_ms}ms]")
        return tool_call
    
    def trace_llm(self, model: str, prompt: str, response: str, 
                  input_tokens: int, output_tokens: int, cost_usd: float, duration_ms: int):
        """记录 LLM 调用"""
        llm_call = LLMCall(
            model=model,
            prompt=prompt,
            response=response,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            duration_ms=duration_ms
        )
        self.llm_calls.append(llm_call)
        
        print(f"  🤖 {model}: {input_tokens}→{output_tokens} tokens, ${cost_usd:.4f} [{duration_ms}ms]")
        return llm_call
    
    def _format_args(self, args: Dict) -> str:
        """格式化参数"""
        items = []
        for k, v in args.items():
            v_str = str(v)[:30] + "..." if len(str(v)) > 30 else str(v)
            items.append(f"{k}={v_str}")
        return ", ".join(items)
    
    def _send_trace(self, trace_data: Dict):
        """发送追踪数据"""
        try:
            requests.post(
                f"{API_URL}/api/v1/traces",
                json=trace_data,
                timeout=2.0
            )
        except Exception as e:
            print(f"  ⚠️ 发送失败: {e}")


# 全局追踪器
_current_tracer: Optional[WorkflowTracer] = None


def get_tracer(agent_name: str = None, platform: str = "openclaw") -> WorkflowTracer:
    """获取或创建追踪器"""
    global _current_tracer
    if _current_tracer is None or agent_name:
        _current_tracer = WorkflowTracer(agent_name or "unknown", platform)
    return _current_tracer


@contextmanager
def trace_session(agent_name: str, platform: str = "openclaw"):
    """上下文管理器：追踪整个会话"""
    tracer = WorkflowTracer(agent_name, platform)
    tracer.start_trace()
    
    try:
        yield tracer
        tracer.end_trace(status="success")
    except Exception as e:
        tracer.end_trace(status="error", error=str(e))
        raise


def trace_tool(tool_name: str):
    """装饰器：追踪工具函数"""
    def decorator(func: Callable) -> Callable:
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            tracer = get_tracer()
            
            # 构建输入参数
            input_args = {}
            if args:
                input_args["args"] = list(args)
            if kwargs:
                input_args.update(kwargs)
            
            start_time = time.time()
            error = ""
            
            try:
                result = func(*args, **kwargs)
                return result
            except Exception as e:
                error = str(e)
                raise
            finally:
                duration_ms = int((time.time() - start_time) * 1000)
                tracer.trace_tool(
                    tool_name=tool_name,
                    input_args=input_args,
                    output=result if not error else None,
                    duration_ms=duration_ms,
                    error=error
                )
        
        return wrapper
    return decorator


def trace_llm_call(model: str, prompt: str, response: str = "",
                   input_tokens: int = 0, output_tokens: int = 0, 
                   cost_usd: float = 0.0, duration_ms: int = 0):
    """记录 LLM 调用"""
    tracer = get_tracer()
    tracer.trace_llm(model, prompt, response, input_tokens, output_tokens, cost_usd, duration_ms)


def log_tool_call(tool_name: str, input_args: Dict, output: Any, duration_ms: int):
    """便捷函数：记录工具调用"""
    tracer = get_tracer()
    tracer.trace_tool(tool_name, input_args, output, duration_ms)


def log_llm_call(model: str, prompt: str, response: str,
                 input_tokens: int, output_tokens: int, cost_usd: float):
    """便捷函数：记录 LLM 调用"""
    duration_ms = 0  # 外部记录时可能不知道耗时
    tracer = get_tracer()
    tracer.trace_llm(model, prompt, response, input_tokens, output_tokens, cost_usd, duration_ms)


# 示例用法
if __name__ == "__main__":
    print("=" * 60)
    print("AgentLens Workflow Tracer - 测试")
    print("=" * 60)
    
    # 测试 1: 使用上下文管理器
    with trace_session("test-agent", "openclaw") as tracer:
        # 模拟工具调用
        tracer.trace_tool("read_file", {"path": "/tmp/test.txt"}, "Hello World", 50)
        tracer.trace_tool("web_search", {"query": "AI agents"}, ["result1", "result2"], 1200)
        
        # 模拟 LLM 调用
        tracer.trace_llm(
            model="gpt-4",
            prompt="Summarize the search results",
            response="AI agents are...",
            input_tokens=500,
            output_tokens=150,
            cost_usd=0.015,
            duration_ms=2500
        )
    
    print("\n" + "=" * 60)
    print("测试完成！查看 Dashboard: http://localhost:5174")
    print("=" * 60)
