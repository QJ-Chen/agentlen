"""Agent 编排器 - 模拟团队协作"""

import yaml
import random
from typing import List, Dict, Any, Optional
from pathlib import Path
from datetime import datetime
from .models import (
    AgentConfig, AgentRole, AgentSpan, AgentMessage, 
    TeamSession, MessageType, SpanStatus
)
from .tracer import AgentTracer


class Agent:
    """单个 Agent 实例"""
    
    def __init__(self, config: AgentConfig, tracer: AgentTracer):
        self.config = config
        self.tracer = tracer
        self.status = "idle"  # idle, working, blocked
        self.current_task: Optional[str] = None
        self.completed_tasks: List[str] = []
        
    def execute_task(
        self, 
        task_description: str, 
        context: Dict[str, Any] = None,
        depends_on: List[str] = None
    ) -> AgentSpan:
        """执行任务"""
        self.status = "working"
        self.current_task = task_description
        
        # 开始追踪
        span = self.tracer.start_span(
            agent_name=self.config.name,
            role=self.config.role,
            model=self.config.model,
            task_description=task_description,
        )
        
        # 模拟执行时间（根据角色不同）- 非阻塞模式
        # import time
        # execution_time = self._estimate_execution_time()
        # time.sleep(execution_time * 0.001)  # 模拟延迟
        execution_time = self._estimate_execution_time()
        
        # 模拟输出
        output = self._generate_output(task_description, context)
        
        # 模拟 Token 消耗
        tokens_in = len(task_description) * 2
        tokens_out = len(output) * 2
        
        # 完成
        self.tracer.end_span(span, output, tokens_in, tokens_out)
        self.completed_tasks.append(task_description)
        self.status = "idle"
        self.current_task = None
        
        return span
    
    def _estimate_execution_time(self) -> int:
        """估算执行时间（毫秒）"""
        base_time = {
            AgentRole.TECH_LEAD: 2000,
            AgentRole.PRODUCT_MANAGER: 1500,
            AgentRole.BACKEND_DEV: 3000,
            AgentRole.FRONTEND_DEV: 2500,
            AgentRole.DEVOPS: 2000,
            AgentRole.QA_ENGINEER: 1800,
        }.get(self.config.role, 2000)
        
        # 添加随机波动
        return int(base_time * random.uniform(0.8, 1.5))
    
    def _generate_output(self, task: str, context: Dict[str, Any] = None) -> str:
        """生成模拟输出"""
        role_outputs = {
            AgentRole.TECH_LEAD: f"[架构评审通过] {task[:30]}... 建议：注意扩展性",
            AgentRole.PRODUCT_MANAGER: f"[PRD完成] {task[:30]}... 优先级：P1",
            AgentRole.BACKEND_DEV: f"[API实现] {task[:30]}... 状态：200 OK",
            AgentRole.FRONTEND_DEV: f"[UI完成] {task[:30]}... 组件：React",
            AgentRole.DEVOPS: f"[部署成功] {task[:30]}... 环境：staging",
            AgentRole.QA_ENGINEER: f"[测试通过] {task[:30]}... 覆盖率：85%",
        }
        return role_outputs.get(self.config.role, f"[完成] {task}")
    
    def consult(self, target_agent: str, question: str) -> AgentMessage:
        """向其他 Agent 咨询"""
        return AgentMessage(
            from_agent=self.config.name,
            to_agent=target_agent,
            message_type=MessageType.CONSULT,
            content=question,
            priority="medium",
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "name": self.config.name,
            "role": self.config.role.value,
            "status": self.status,
            "current_task": self.current_task,
            "completed_tasks": len(self.completed_tasks),
            "model": self.config.model,
        }


class TeamOrchestrator:
    """团队编排器"""
    
    def __init__(self, config_dir: str):
        self.config_dir = Path(config_dir)
        self.agents: Dict[str, Agent] = {}
        self.session: Optional[TeamSession] = None
        self.tracer = AgentTracer()
        
    def load_agents(self):
        """从配置文件加载 Agents"""
        for config_file in self.config_dir.glob("*.yaml"):
            with open(config_file, 'r', encoding='utf-8') as f:
                data = yaml.safe_load(f)
                config = AgentConfig.from_dict(data)
                agent = Agent(config, self.tracer)
                self.agents[config.name] = agent
        
        print(f"✓ 加载了 {len(self.agents)} 个 Agent")
        return self
    
    def create_session(self, project: str, description: str) -> TeamSession:
        """创建新会话"""
        self.session = TeamSession(
            project=project,
            description=description,
        )
        self.tracer.session = self.session
        return self.session
    
    def run_simulation(self, workflow: List[Dict[str, Any]]) -> TeamSession:
        """运行模拟工作流"""
        if not self.session:
            raise ValueError("请先创建会话")
        
        print(f"\n🚀 开始模拟: {self.session.description}")
        print("=" * 60)
        
        for step in workflow:
            agent_name = step.get("agent")
            task = step.get("task")
            
            if agent_name not in self.agents:
                print(f"⚠️ Agent {agent_name} 不存在")
                continue
            
            agent = self.agents[agent_name]
            
            # 检查依赖
            depends_on = step.get("depends_on", [])
            if depends_on:
                for dep in depends_on:
                    if dep not in agent.completed_tasks:
                        print(f"⏳ {agent_name} 等待依赖: {dep}")
                        agent.status = "blocked"
                        continue
            
            # 执行任务
            print(f"\n👤 {agent_name} ({agent.config.role.value})")
            print(f"   任务: {task[:50]}...")
            
            span = agent.execute_task(task)
            
            print(f"   ✅ 完成 | Token: {span.input_tokens + span.output_tokens} | "
                  f"成本: ${span.cost_usd:.6f} | 耗时: {span.latency_ms}ms")
            
            # 处理咨询
            if "consult" in step:
                target = step["consult"]
                message = agent.consult(target, f"关于 {task} 的咨询")
                self.session.add_message(message)
                print(f"   💬 咨询 {target}")
        
        # 完成会话
        self.session.complete()
        
        print("\n" + "=" * 60)
        print("📊 模拟完成")
        
        return self.session
    
    def get_dashboard(self) -> Dict[str, Any]:
        """获取仪表盘数据"""
        if not self.session:
            return {}
        
        return {
            "session": self.session.to_dict(),
            "agents": [agent.to_dict() for agent in self.agents.values()],
            "agent_stats": {
                name: self.session.get_agent_stats(name)
                for name in self.session.agents_involved
            },
        }
    
    def print_summary(self):
        """打印会话摘要"""
        if not self.session:
            print("没有活动会话")
            return
        
        print("\n" + "=" * 60)
        print("📈 会话摘要")
        print("=" * 60)
        
        print(f"\n项目: {self.session.project}")
        print(f"描述: {self.session.description}")
        print(f"参与 Agent: {', '.join(self.session.agents_involved)}")
        print(f"\n总 Token: {self.session.total_tokens:,}")
        print(f"总成本: ${self.session.total_cost:.4f}")
        print(f"总耗时: {self.session.total_duration_ms}ms")
        print(f"Agent 交接: {self.session.handoff_count} 次")
        print(f"阻塞次数: {self.session.block_count}")
        
        print("\n各 Agent 统计:")
        print("-" * 60)
        for agent_name in self.session.agents_involved:
            stats = self.session.get_agent_stats(agent_name)
            print(f"  {stats['agent_name']:20} | "
                  f"任务: {stats['span_count']:2} | "
                  f"Token: {stats['total_tokens']:6,} | "
                  f"成本: ${stats['total_cost']:.4f} | "
                  f"成功率: {stats['success_rate']*100:.0f}%")
