"""
AgentLens OpenClaw Integration Example
======================================

展示如何在 OpenClaw Agent 中集成深度工作流追踪
"""

import asyncio
from typing import Dict, Any, List
from workflow_tracer import trace_session, trace_tool, trace_llm_call, get_tracer


class OpenClawAgent:
    """示例 OpenClaw Agent，带完整工作流追踪"""
    
    def __init__(self, name: str = "openclaw-agent"):
        self.name = name
        self.tracer = None
    
    async def run(self, task: str) -> Dict[str, Any]:
        """运行 Agent 任务，完整追踪工作流"""
        
        with trace_session(self.name, "openclaw") as tracer:
            self.tracer = tracer
            print(f"\n🚀 Agent '{self.name}' 开始执行任务: {task}")
            print("=" * 60)
            
            # Step 1: 分析任务
            analysis = await self._analyze_task(task)
            
            # Step 2: 搜索相关信息
            search_results = await self._search_info(analysis["keywords"])
            
            # Step 3: 读取相关文件
            files_content = await self._read_files(analysis["files_needed"])
            
            # Step 4: 调用 LLM 生成响应
            response = await self._generate_response(
                task=task,
                search_results=search_results,
                files_content=files_content
            )
            
            # Step 5: 执行工具（如需要）
            if response.get("action"):
                await self._execute_action(response["action"])
            
            print("=" * 60)
            print(f"✅ 任务完成!")
            
            return {
                "task": task,
                "response": response["text"],
                "tools_used": len(tracer.tool_calls),
                "llm_calls": len(tracer.llm_calls),
                "total_cost": sum(llm.cost_usd for llm in tracer.llm_calls)
            }
    
    async def _analyze_task(self, task: str) -> Dict[str, Any]:
        """分析任务需求"""
        print("\n📋 Step 1: 分析任务...")
        
        start_time = asyncio.get_event_loop().time()
        
        # 模拟任务分析
        await asyncio.sleep(0.1)
        keywords = ["AI", "agent", "workflow"]
        files_needed = ["config.yaml", "agent.py"]
        
        duration_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
        
        # 记录工具调用
        self.tracer.trace_tool(
            tool_name="analyze_task",
            input_args={"task": task},
            output={"keywords": keywords, "files_needed": files_needed},
            duration_ms=duration_ms
        )
        
        return {"keywords": keywords, "files_needed": files_needed}
    
    async def _search_info(self, keywords: List[str]) -> List[Dict]:
        """搜索相关信息"""
        print("\n🔍 Step 2: 搜索信息...")
        
        results = []
        for keyword in keywords:
            start_time = asyncio.get_event_loop().time()
            
            # 模拟搜索
            await asyncio.sleep(0.2)
            result = {
                "keyword": keyword,
                "results": [f"{keyword} result 1", f"{keyword} result 2"]
            }
            results.append(result)
            
            duration_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
            
            # 记录工具调用
            self.tracer.trace_tool(
                tool_name="web_search",
                input_args={"query": keyword},
                output=result,
                duration_ms=duration_ms
            )
        
        return results
    
    async def _read_files(self, files: List[str]) -> Dict[str, str]:
        """读取文件"""
        print("\n📁 Step 3: 读取文件...")
        
        contents = {}
        for file_path in files:
            start_time = asyncio.get_event_loop().time()
            
            # 模拟文件读取
            await asyncio.sleep(0.05)
            content = f"# Content of {file_path}\n..."
            contents[file_path] = content
            
            duration_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
            
            # 记录工具调用
            self.tracer.trace_tool(
                tool_name="read_file",
                input_args={"path": file_path},
                output=content[:100],
                duration_ms=duration_ms
            )
        
        return contents
    
    async def _generate_response(self, task: str, search_results: List[Dict], 
                                  files_content: Dict[str, str]) -> Dict[str, Any]:
        """调用 LLM 生成响应"""
        print("\n🤖 Step 4: 调用 LLM...")
        
        start_time = asyncio.get_event_loop().time()
        
        # 构建提示词
        prompt = f"""Task: {task}

Search Results:
{search_results}

Files:
{files_content}

Please provide a response."""
        
        # 模拟 LLM 调用
        await asyncio.sleep(0.5)
        
        response_text = f"Based on the search results and files, here's my analysis of '{task}'..."
        
        # 估算 token（简化）
        input_tokens = len(prompt) // 4
        output_tokens = len(response_text) // 4
        cost_usd = (input_tokens + output_tokens) * 0.00001  # $0.01 per 1K tokens
        
        duration_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
        
        # 记录 LLM 调用
        self.tracer.trace_llm(
            model="claude-3-5-sonnet",
            prompt=prompt[:200] + "...",
            response=response_text[:200] + "...",
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=cost_usd,
            duration_ms=duration_ms
        )
        
        return {
            "text": response_text,
            "action": None
        }
    
    async def _execute_action(self, action: Dict[str, Any]):
        """执行动作"""
        print("\n⚡ Step 5: 执行动作...")
        
        start_time = asyncio.get_event_loop().time()
        
        # 模拟执行
        await asyncio.sleep(0.1)
        result = f"Executed: {action}"
        
        duration_ms = int((asyncio.get_event_loop().time() - start_time) * 1000)
        
        # 记录工具调用
        self.tracer.trace_tool(
            tool_name="execute_action",
            input_args=action,
            output=result,
            duration_ms=duration_ms
        )


# 使用装饰器方式的示例
class SimpleTools:
    """简单工具类，使用装饰器追踪"""
    
    @trace_tool("calculator")
    def calculate(self, expression: str) -> float:
        """计算表达式"""
        return eval(expression)
    
    @trace_tool("formatter")
    def format_text(self, text: str, style: str = "upper") -> str:
        """格式化文本"""
        if style == "upper":
            return text.upper()
        return text.lower()


async def demo_full_workflow():
    """演示完整工作流"""
    print("=" * 60)
    print("AgentLens - OpenClaw Agent 工作流追踪演示")
    print("=" * 60)
    
    # 创建 Agent 并运行
    agent = OpenClawAgent(name="research-assistant")
    result = await agent.run("Analyze AI agent workflows")
    
    print("\n" + "=" * 60)
    print("📊 执行摘要:")
    print(f"  工具调用: {result['tools_used']} 次")
    print(f"  LLM 调用: {result['llm_calls']} 次")
    print(f"  总成本: ${result['total_cost']:.4f}")
    print("=" * 60)
    
    # 演示装饰器方式
    print("\n🛠️  工具调用演示:")
    tools = SimpleTools()
    result1 = tools.calculate("2 + 2 * 10")
    result2 = tools.format_text("hello world", "upper")
    
    print(f"  calculate: {result1}")
    print(f"  format_text: {result2}")
    
    print("\n✅ 演示完成！")
    print("📊 查看 Dashboard: http://localhost:5174")
    print("📈 查看统计: http://localhost:8080/api/v1/stats")


if __name__ == "__main__":
    asyncio.run(demo_full_workflow())
