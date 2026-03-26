"""
AgentLens Observer for Claude Code
=====================================

在 Claude Code 中使用 AgentLens 进行观测：

1. 将此文件保存到你的 Claude Code 项目根目录
2. 在 .claude/agents/ 中的 agent 文件里导入并使用
3. 启动 AgentLens API 服务器 (端口 8080)

示例用法:
    from agentlens_observer import observe_tool, observe_llm
    
    @observe_tool("read_file")
    def read_file(path: str):
        ...
    
    with observe_llm("claude-3-5", "你的提示"):
        # LLM 调用
        pass
"""

import functools
import time
import httpx
from typing import Any, Dict, Optional
from contextlib import contextmanager

API_URL = "http://localhost:8080"


def observe_tool(tool_name: str):
    """装饰器：观测工具调用"""
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            start_time = time.time()
            
            try:
                result = func(*args, **kwargs)
                duration_ms = int((time.time() - start_time) * 1000)
                
                # 发送观测数据
                _send_trace({
                    "trace_id": f"tool_{int(start_time * 1000)}",
                    "platform": "claude-code",
                    "agent_name": "claude-agent",
                    "session_id": f"session_{int(start_time)}",
                    "start_time": _format_time(start_time),
                    "end_time": _format_time(time.time()),
                    "duration_ms": duration_ms,
                    "model": tool_name,
                    "prompt": f"Tool: {tool_name}\nArgs: {str(kwargs)[:200]}",
                    "response": str(result)[:500],
                    "input_tokens": len(str(args)) + len(str(kwargs)),
                    "output_tokens": len(str(result)),
                    "cost_usd": 0.0,
                    "tool_calls": [],
                    "status": "success",
                    "error_message": ""
                })
                
                return result
            except Exception as e:
                duration_ms = int((time.time() - start_time) * 1000)
                _send_trace({
                    "trace_id": f"tool_{int(start_time * 1000)}",
                    "platform": "claude-code",
                    "agent_name": "claude-agent",
                    "session_id": f"session_{int(start_time)}",
                    "start_time": _format_time(start_time),
                    "end_time": _format_time(time.time()),
                    "duration_ms": duration_ms,
                    "model": tool_name,
                    "prompt": f"Tool: {tool_name}\nArgs: {str(kwargs)[:200]}",
                    "response": "",
                    "input_tokens": len(str(args)) + len(str(kwargs)),
                    "output_tokens": 0,
                    "cost_usd": 0.0,
                    "tool_calls": [],
                    "status": "error",
                    "error_message": str(e)
                })
                raise
        
        return wrapper
    return decorator


@contextmanager
def observe_llm(model: str, prompt: str):
    """上下文管理器：观测 LLM 调用"""
    start_time = time.time()
    trace_id = f"llm_{int(start_time * 1000)}"
    
    try:
        yield trace_id
        
        # LLM 调用完成后记录
        duration_ms = int((time.time() - start_time) * 1000)
        
        _send_trace({
            "trace_id": trace_id,
            "platform": "claude-code",
            "agent_name": "claude-agent",
            "session_id": f"session_{int(start_time)}",
            "start_time": _format_time(start_time),
            "end_time": _format_time(time.time()),
            "duration_ms": duration_ms,
            "model": model,
            "prompt": prompt[:500],
            "response": "[LLM Response]",
            "input_tokens": len(prompt) // 4,
            "output_tokens": 100,  # 估算
            "cost_usd": 0.0,
            "tool_calls": [],
            "status": "success",
            "error_message": ""
        })
        
    except Exception as e:
        _send_trace({
            "trace_id": trace_id,
            "platform": "claude-code",
            "agent_name": "claude-agent",
            "session_id": f"session_{int(start_time)}",
            "start_time": _format_time(start_time),
            "end_time": _format_time(time.time()),
            "duration_ms": int((time.time() - start_time) * 1000),
            "model": model,
            "prompt": prompt[:500],
            "response": "",
            "input_tokens": len(prompt) // 4,
            "output_tokens": 0,
            "cost_usd": 0.0,
            "tool_calls": [],
            "status": "error",
            "error_message": str(e)
        })
        raise


def _send_trace(trace_data: Dict[str, Any]):
    """发送 trace 到 AgentLens API"""
    try:
        import requests
        requests.post(
            f"{API_URL}/api/v1/traces",
            json=trace_data,
            timeout=1.0
        )
    except:
        pass  # 静默失败，不影响主流程


def _format_time(timestamp: float) -> str:
    """格式化时间"""
    from datetime import datetime
    return datetime.fromtimestamp(timestamp).isoformat()


# 便捷函数
def log_event(event_type: str, data: Dict[str, Any]):
    """记录通用事件"""
    _send_trace({
        "trace_id": f"event_{int(time.time() * 1000)}",
        "platform": "claude-code",
        "agent_name": "claude-agent",
        "session_id": f"session_{int(time.time())}",
        "start_time": _format_time(time.time()),
        "end_time": _format_time(time.time()),
        "duration_ms": 0,
        "model": event_type,
        "prompt": str(data)[:500],
        "response": "",
        "input_tokens": 0,
        "output_tokens": 0,
        "cost_usd": 0.0,
        "tool_calls": [],
        "status": "success",
        "error_message": ""
    })


if __name__ == "__main__":
    # 测试
    @observe_tool("test_tool")
    def test_tool(name: str):
        return f"Hello, {name}!"
    
    result = test_tool("Claude")
    print(f"Test result: {result}")
    print("✓ AgentLens observer test completed")
