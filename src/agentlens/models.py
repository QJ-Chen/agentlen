"""数据模型定义"""

from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from datetime import datetime
from enum import Enum
import uuid


class AgentRole(str, Enum):
    """Agent 角色类型"""
    TECH_LEAD = "tech_lead"
    BACKEND_DEV = "backend_dev"
    FRONTEND_DEV = "frontend_dev"
    DEVOPS = "devops"
    QA_ENGINEER = "qa_engineer"
    PRODUCT_MANAGER = "product_manager"


class SpanStatus(str, Enum):
    """Span 状态"""
    RUNNING = "running"
    SUCCESS = "success"
    ERROR = "error"
    BLOCKED = "blocked"
    CANCELLED = "cancelled"


class MessageType(str, Enum):
    """消息类型"""
    REQUEST = "request"
    RESPONSE = "response"
    NOTIFY = "notify"
    BLOCK = "block"
    CONSULT = "consult"
    COMPLETE = "complete"


@dataclass
class ToolCall:
    """工具调用记录"""
    tool_name: str
    input_args: Dict[str, Any]
    output_result: Any
    duration_ms: int
    success: bool
    error_message: Optional[str] = None


@dataclass
class AgentSpan:
    """单个 Agent 执行跨度"""
    # 标识
    span_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    trace_id: str = ""
    
    # Agent 信息
    agent_name: str = ""
    agent_role: AgentRole = AgentRole.BACKEND_DEV
    model: str = ""
    
    # 时间
    start_time: datetime = field(default_factory=datetime.now)
    end_time: Optional[datetime] = None
    
    # 输入输出
    task_description: str = ""
    input_context: Dict[str, Any] = field(default_factory=dict)
    output_result: Any = None
    
    # Token 消耗
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0
    
    # 工具调用
    tool_calls: List[ToolCall] = field(default_factory=list)
    
    # 性能
    latency_ms: int = 0
    
    # 协作关系
    parent_span_id: Optional[str] = None
    child_span_ids: List[str] = field(default_factory=list)
    
    # 任务信息
    task_id: str = ""
    project: str = ""
    status: SpanStatus = SpanStatus.RUNNING
    
    # 阻塞信息
    blocked_by: Optional[str] = None
    block_reason: Optional[str] = None
    
    def complete(self, output: Any, tokens_in: int = 0, tokens_out: int = 0):
        """标记完成"""
        self.end_time = datetime.now()
        self.output_result = output
        self.input_tokens = tokens_in
        self.output_tokens = tokens_out
        self.status = SpanStatus.SUCCESS
        self._calculate_latency()
        self._calculate_cost()
    
    def fail(self, error: str):
        """标记失败"""
        self.end_time = datetime.now()
        self.status = SpanStatus.ERROR
        self._calculate_latency()
    
    def block(self, blocked_by: str, reason: str):
        """标记阻塞"""
        self.status = SpanStatus.BLOCKED
        self.blocked_by = blocked_by
        self.block_reason = reason
    
    def _calculate_latency(self):
        """计算延迟"""
        if self.end_time:
            delta = self.end_time - self.start_time
            self.latency_ms = int(delta.total_seconds() * 1000)
    
    def _calculate_cost(self):
        """计算成本（简化模型）"""
        # 假设：$0.001 / 1K tokens (混合模型平均)
        total_tokens = self.input_tokens + self.output_tokens
        self.cost_usd = (total_tokens / 1000) * 0.001
    
    def add_tool_call(self, tool_call: ToolCall):
        """添加工具调用"""
        self.tool_calls.append(tool_call)
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "span_id": self.span_id,
            "trace_id": self.trace_id,
            "agent_name": self.agent_name,
            "agent_role": self.agent_role.value,
            "model": self.model,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "task_description": self.task_description,
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "cost_usd": round(self.cost_usd, 6),
            "latency_ms": self.latency_ms,
            "tool_calls": len(self.tool_calls),
            "status": self.status.value,
            "parent_span_id": self.parent_span_id,
            "child_span_ids": self.child_span_ids,
        }


@dataclass
class AgentMessage:
    """Agent 间消息"""
    message_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    from_agent: str = ""
    to_agent: str = ""
    message_type: MessageType = MessageType.NOTIFY
    content: str = ""
    context: Dict[str, Any] = field(default_factory=dict)
    timestamp: datetime = field(default_factory=datetime.now)
    priority: str = "medium"  # low, medium, high, urgent
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "message_id": self.message_id,
            "from_agent": self.from_agent,
            "to_agent": self.to_agent,
            "message_type": self.message_type.value,
            "content": self.content[:100] + "..." if len(self.content) > 100 else self.content,
            "timestamp": self.timestamp.isoformat(),
            "priority": self.priority,
        }


@dataclass
class TeamSession:
    """团队会话（多 Agent 协作）"""
    session_id: str = field(default_factory=lambda: str(uuid.uuid4())[:8])
    project: str = ""
    description: str = ""
    
    # 参与 Agent
    agents_involved: List[str] = field(default_factory=list)
    
    # 所有 Span
    spans: List[AgentSpan] = field(default_factory=list)
    
    # 消息记录
    messages: List[AgentMessage] = field(default_factory=list)
    
    # 时间
    start_time: datetime = field(default_factory=datetime.now)
    end_time: Optional[datetime] = None
    
    def add_span(self, span: AgentSpan):
        """添加 Span"""
        span.trace_id = self.session_id
        self.spans.append(span)
        if span.agent_name not in self.agents_involved:
            self.agents_involved.append(span.agent_name)
    
    def add_message(self, message: AgentMessage):
        """添加消息"""
        self.messages.append(message)
    
    def complete(self):
        """标记会话完成"""
        self.end_time = datetime.now()
    
    @property
    def total_tokens(self) -> int:
        """总 Token 消耗"""
        return sum(s.input_tokens + s.output_tokens for s in self.spans)
    
    @property
    def total_cost(self) -> float:
        """总成本"""
        return sum(s.cost_usd for s in self.spans)
    
    @property
    def total_duration_ms(self) -> int:
        """总耗时"""
        if self.end_time:
            delta = self.end_time - self.start_time
            return int(delta.total_seconds() * 1000)
        return 0
    
    @property
    def handoff_count(self) -> int:
        """Agent 间交接次数"""
        count = 0
        for span in self.spans:
            if span.parent_span_id:
                count += 1
        return count
    
    @property
    def block_count(self) -> int:
        """阻塞次数"""
        return sum(1 for s in self.spans if s.status == SpanStatus.BLOCKED)
    
    def get_agent_stats(self, agent_name: str) -> Dict[str, Any]:
        """获取指定 Agent 的统计"""
        agent_spans = [s for s in self.spans if s.agent_name == agent_name]
        return {
            "agent_name": agent_name,
            "span_count": len(agent_spans),
            "total_tokens": sum(s.input_tokens + s.output_tokens for s in agent_spans),
            "total_cost": round(sum(s.cost_usd for s in agent_spans), 4),
            "avg_latency_ms": sum(s.latency_ms for s in agent_spans) / len(agent_spans) if agent_spans else 0,
            "success_rate": sum(1 for s in agent_spans if s.status == SpanStatus.SUCCESS) / len(agent_spans) if agent_spans else 0,
        }
    
    def to_dict(self) -> Dict[str, Any]:
        """转换为字典"""
        return {
            "session_id": self.session_id,
            "project": self.project,
            "description": self.description,
            "agents_involved": self.agents_involved,
            "span_count": len(self.spans),
            "message_count": len(self.messages),
            "total_tokens": self.total_tokens,
            "total_cost": round(self.total_cost, 4),
            "total_duration_ms": self.total_duration_ms,
            "handoff_count": self.handoff_count,
            "block_count": self.block_count,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
        }


@dataclass
class AgentConfig:
    """Agent 配置"""
    name: str
    role: AgentRole
    description: str = ""
    model: str = "claude-3-5-sonnet"
    effort: str = "medium"
    tools: List[str] = field(default_factory=list)
    dependencies: List[str] = field(default_factory=list)
    cache_key: str = ""
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "AgentConfig":
        """从字典创建"""
        return cls(
            name=data.get("name", ""),
            role=AgentRole(data.get("role", "backend_dev")),
            description=data.get("description", ""),
            model=data.get("model", "claude-3-5-sonnet"),
            effort=data.get("effort", "medium"),
            tools=data.get("tools", []),
            dependencies=data.get("dependencies", []),
            cache_key=data.get("cache_key", ""),
        )
