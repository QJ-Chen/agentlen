"""Claude Code 适配器 - 用于 AgentLens 观测

使用方法:
1. 在 Claude Code 项目中安装: pip install agentlens
2. 导入并初始化收集器
3. 自动拦截工具调用和 LLM 请求
"""

import os
import sys
from typing import Any, Dict, Optional
from pathlib import Path

# 添加 AgentLens 到路径
AGENTLENS_PATH = Path(__file__).parent.parent.parent / "src"
sys.path.insert(0, str(AGENTLENS_PATH))

from agentlens.collector import Collector, create_collector
from agentlens.storage import SQLiteStorage


class ClaudeCodeAdapter:
    """Claude Code 适配器"""
    
    def __init__(self, server_url: str = "http://localhost:8080"):
        self.collector = create_collector(
            platform="claude-code",
            agent_name="claude-code-session",
            server_url=server_url
        )
        self._original_tools = {}
        self._initialized = False
    
    async def initialize(self):
        """初始化收集器"""
        if not self._initialized:
            await self.collector.start()
            self._initialized = True
            print("✓ AgentLens collector started for Claude Code")
    
    async def shutdown(self):
        """关闭收集器"""
        if self._initialized:
            await self.collector.stop()
            self._initialized = False
            print("✓ AgentLens collector stopped")
    
    def trace_tool(self, tool_name: str, input_args: dict = None):
        """装饰器：追踪工具调用"""
        return self.collector.trace_tool_call(tool_name, input_args)
    
    def start_llm_trace(self, model: str, prompt: str) -> str:
        """开始 LLM 调用追踪"""
        trace = self.collector.start_trace(
            model=model,
            prompt=prompt
        )
        return trace.trace_id
    
    def end_llm_trace(
        self,
        trace_id: str,
        response: str,
        tokens_in: int = 0,
        tokens_out: int = 0
    ):
        """结束 LLM 调用追踪"""
        # 查找对应的 trace
        # 简化实现：直接创建新的 trace 记录
        trace = self.collector.start_trace(
            model="claude-3-5-sonnet",
            prompt="[LLM Call]"
        )
        trace.trace_id = trace_id
        self.collector.end_trace(trace, response, tokens_in, tokens_out)
    
    def log_event(self, event_type: str, data: Dict[str, Any]):
        """记录通用事件"""
        trace = self.collector.start_trace(
            model="event",
            prompt=f"[{event_type}] {str(data)[:200]}"
        )
        self.collector.end_trace(trace, "logged", 0, 0)


# 全局适配器实例
_adapter: Optional[ClaudeCodeAdapter] = None


def get_adapter() -> ClaudeCodeAdapter:
    """获取全局适配器"""
    global _adapter
    if _adapter is None:
        _adapter = ClaudeCodeAdapter()
    return _adapter


# 便捷函数
def init_agentlens():
    """初始化 AgentLens（在 Claude Code 启动时调用）"""
    import asyncio
    adapter = get_adapter()
    asyncio.create_task(adapter.initialize())


def log_tool_call(tool_name: str, duration_ms: int, success: bool):
    """记录工具调用"""
    adapter = get_adapter()
    adapter.log_event("tool_call", {
        "tool": tool_name,
        "duration_ms": duration_ms,
        "success": success
    })


def log_llm_call(model: str, tokens_in: int, tokens_out: int, cost: float):
    """记录 LLM 调用"""
    adapter = get_adapter()
    adapter.log_event("llm_call", {
        "model": model,
        "tokens_in": tokens_in,
        "tokens_out": tokens_out,
        "cost": cost
    })


# 手动测试
if __name__ == "__main__":
    import asyncio
    
    async def test():
        adapter = ClaudeCodeAdapter()
        await adapter.initialize()
        
        # 模拟工具调用
        print("Testing tool call tracing...")
        
        @adapter.trace_tool("read_file", {"path": "/tmp/test.txt"})
        def read_file(path: str):
            return f"Content of {path}"
        
        result = read_file("/tmp/test.txt")
        print(f"Tool result: {result}")
        
        # 模拟 LLM 调用
        print("Testing LLM tracing...")
        trace_id = adapter.start_llm_trace(
            model="claude-3-5-sonnet",
            prompt="Hello, how are you?"
        )
        
        # 模拟响应
        adapter.end_llm_trace(
            trace_id=trace_id,
            response="I'm doing well, thank you!",
            tokens_in=10,
            tokens_out=20
        )
        
        print("Test completed!")
        
        # 等待数据发送
        await asyncio.sleep(2)
        await adapter.shutdown()
    
    asyncio.run(test())
