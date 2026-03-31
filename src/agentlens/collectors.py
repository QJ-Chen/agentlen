"""AgentLens Collectors - 多平台日志收集器（Session 聚合版）"""

import json
import os
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path
import logging
import time
import threading

logger = logging.getLogger(__name__)


class SessionAggregator:
    """Session 聚合器 - 将同一 session 的消息聚合成一个 trace"""
    
    def __init__(self):
        self.sessions: Dict[str, Dict[str, Any]] = {}
    
    def add_message(self, session_id: str, message: Dict[str, Any]):
        """添加消息到 session"""
        if session_id not in self.sessions:
            self.sessions[session_id] = {
                "session_id": session_id,
                "messages": [],
                "tool_calls": [],
                "llm_calls": [],
                "start_time": None,
                "end_time": None,
                "total_input_tokens": 0,
                "total_output_tokens": 0,
                "total_cost": 0,
                "project_path": "",
                "platform": "",
                "agent_name": "",
            }
        
        session = self.sessions[session_id]
        session["messages"].append(message)
        
        # 更新基本信息
        if message.get("start_time"):
            if not session["start_time"]:
                session["start_time"] = message["start_time"]
            session["end_time"] = message["start_time"]
        
        if message.get("project_path"):
            session["project_path"] = message["project_path"]
        
        if message.get("platform"):
            session["platform"] = message["platform"]
        
        if message.get("agent_name"):
            session["agent_name"] = message["agent_name"]
        
        # 聚合 token 和成本
        session["total_input_tokens"] += message.get("input_tokens", 0)
        session["total_output_tokens"] += message.get("output_tokens", 0)
        session["total_cost"] += message.get("cost_usd", 0)
        
        # 收集工具调用
        if message.get("tool_calls"):
            session["tool_calls"].extend(message["tool_calls"])
        
        # 收集 LLM 调用（只保留最近的 50 个，避免数据过大）
        if message.get("role") == "assistant" and message.get("model"):
            # 查找前一个 user 消息的 prompt
            last_user_prompt = None
            for prev_msg in reversed(session["messages"][:-1]):  # 排除当前消息
                if prev_msg.get("role") == "user" and prev_msg.get("prompt"):
                    last_user_prompt = prev_msg.get("prompt")
                    break
            
            session["llm_calls"].append({
                "id": message.get("trace_id"),
                "model": message.get("model"),
                "start_time": message.get("start_time"),
                "input_tokens": message.get("input_tokens", 0),
                "output_tokens": message.get("output_tokens", 0),
                "prompt": last_user_prompt[:500] if last_user_prompt else None,
                "response": message.get("response")[:1000] if message.get("response") else None,
            })
            # 只保留最近的 50 个
            if len(session["llm_calls"]) > 50:
                session["llm_calls"] = session["llm_calls"][-50:]
    
    def get_traces(self) -> List[Dict[str, Any]]:
        """获取聚合后的 traces"""
        traces = []
        
        for session_id, session in self.sessions.items():
            if not session["messages"]:
                continue
            
            # 构建完整的 prompt 和 response
            user_messages = [m for m in session["messages"] if m.get("role") == "user"]
            assistant_messages = [m for m in session["messages"] if m.get("role") == "assistant"]
            
            # 获取第一条 user message 作为 prompt
            first_prompt = None
            if user_messages:
                first_prompt = user_messages[0].get("prompt")
            
            # 获取最后一条 assistant message 作为 response
            last_response = None
            if assistant_messages:
                last_response = assistant_messages[-1].get("response")
            
            trace = {
                "trace_id": session_id,
                "platform": session["platform"],
                "agent_name": session["agent_name"] or "unknown",
                "session_id": session_id,
                "start_time": session["start_time"],
                "end_time": session["end_time"],
                "duration_ms": 0,  # 可以计算
                "model": session["llm_calls"][-1]["model"] if session["llm_calls"] else "unknown",
                "prompt": first_prompt,
                "response": last_response,
                "input_tokens": session["total_input_tokens"],
                "output_tokens": session["total_output_tokens"],
                "cost_usd": session["total_cost"],
                "tool_calls": session["tool_calls"],
                "llm_calls": session["llm_calls"],  # 包含所有 LLM 调用详情
                "status": "success",
                "project_path": session["project_path"],
                "metadata": {
                    "message_count": len(session["messages"]),
                    "llm_call_count": len(session["llm_calls"]),
                }
            }
            
            traces.append(trace)
        
        return traces


class LogCollector(ABC):
    """日志收集器基类"""
    
    def __init__(self, storage):
        self.storage = storage
        self.watching = False
        self.watch_thread: Optional[threading.Thread] = None
        self.file_positions: Dict[Path, int] = {}
    
    @abstractmethod
    def get_name(self) -> str:
        """返回收集器名称"""
        pass
    
    @abstractmethod
    def get_log_paths(self) -> List[Path]:
        """返回要监控的日志路径列表"""
        pass
    
    @abstractmethod
    def parse_session_file(self, log_path: Path) -> List[Dict[str, Any]]:
        """解析整个 session 文件，返回聚合后的 traces"""
        pass
    
    def start_watching(self, interval: float = 1.0):
        """开始监控日志文件变化（轮询方式）"""
        if self.watching:
            return
        
        self.watching = True
        
        # 初始化文件位置
        for log_path in self.get_log_paths():
            if log_path.exists():
                self.file_positions[log_path] = log_path.stat().st_size
        
        # 启动监控线程
        self.watch_thread = threading.Thread(target=self._watch_loop, args=(interval,), daemon=True)
        self.watch_thread.start()
        
        logger.info(f"{self.get_name()} collector started watching")
    
    def stop_watching(self):
        """停止监控"""
        self.watching = False
        if self.watch_thread:
            self.watch_thread.join(timeout=5)
            self.watch_thread = None
    
    def _watch_loop(self, interval: float):
        """监控循环"""
        while self.watching:
            try:
                self._check_files()
            except Exception as e:
                logger.error(f"Error in watch loop: {e}")
            
            time.sleep(interval)
    
    def _check_files(self):
        """检查文件变化，只解析新增内容"""
        for log_path in self.get_log_paths():
            if not log_path.exists():
                continue
            
            current_size = log_path.stat().st_size
            last_position = self.file_positions.get(log_path, 0)
            
            if current_size > last_position:
                try:
                    # 只解析新增的行
                    new_lines = []
                    with open(log_path, 'r', encoding='utf-8') as f:
                        f.seek(last_position)
                        new_lines = f.readlines()
                    
                    if new_lines:
                        # 获取 session 基本信息
                        session_id = log_path.stem
                        session_cwd = ""
                        
                        # 尝试从已解析的数据中获取 cwd
                        with open(log_path, 'r', encoding='utf-8') as f:
                            for line in f:
                                try:
                                    data = json.loads(line.strip())
                                    if data.get("type") == "session" and data.get("cwd"):
                                        session_cwd = data.get("cwd", "")
                                        break
                                except:
                                    pass
                        
                        # 解析新增的消息并保存
                        self._parse_new_lines(log_path, new_lines, session_id, session_cwd)
                    
                    self.file_positions[log_path] = current_size
                
                except Exception as e:
                    logger.error(f"Error processing {log_path}: {e}")
    
    def _parse_new_lines(self, log_path: Path, new_lines: List[str], session_id: str, session_cwd: str):
        """解析新增的行并保存到数据库（子类需要重写）"""
        pass
    
    def collect_historical(self) -> List[Dict[str, Any]]:
        """收集历史日志"""
        all_traces = []
        
        for log_path in self.get_log_paths():
            if not log_path.exists():
                continue
            
            try:
                traces = self.parse_session_file(log_path)
                all_traces.extend(traces)
                
                # 更新文件位置
                self.file_positions[log_path] = log_path.stat().st_size
                
            except Exception as e:
                logger.error(f"Error reading {log_path}: {e}")
        
        return all_traces


class OpenClawCollector(LogCollector):
    """OpenClaw 日志收集器"""
    
    def get_name(self) -> str:
        return "openclaw"
    
    def get_log_paths(self) -> List[Path]:
        """OpenClaw 日志路径：按 agent 组织"""
        base_path = Path.home() / ".openclaw" / "agents"
        paths = []
        
        if base_path.exists():
            for agent_dir in base_path.iterdir():
                if agent_dir.is_dir():
                    sessions_dir = agent_dir / "sessions"
                    if sessions_dir.exists():
                        for session_file in sessions_dir.glob("*.jsonl"):
                            if not session_file.name.endswith(".lock"):
                                paths.append(session_file)
        
        return paths
    
    def parse_session_file(self, log_path: Path) -> List[Dict[str, Any]]:
        """解析 OpenClaw session 文件，按 session 聚合"""
        session_id = log_path.stem
        aggregator = SessionAggregator()
        
        # 首先读取 session 初始化信息
        session_cwd = ""
        try:
            with open(log_path, 'r', encoding='utf-8') as f:
                for line in f:
                    try:
                        data = json.loads(line.strip())
                        if data.get("type") == "session" and data.get("cwd"):
                            session_cwd = data.get("cwd", "")
                            break
                    except:
                        pass
        except:
            pass
        
        # 解析所有消息
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    data = json.loads(line.strip())
                    
                    if data.get("type") != "message":
                        continue
                    
                    message = data.get("message", {})
                    role = message.get("role")
                    
                    # 提取工具调用
                    tool_calls = []
                    content = message.get("content", [])
                    
                    if isinstance(content, list):
                        for item in content:
                            if item.get("type") == "toolCall":
                                tool_calls.append({
                                    "tool_use_id": item.get("id"),
                                    "name": item.get("name"),
                                    "input": item.get("arguments", {}),
                                    "timestamp": data.get("timestamp")
                                })
                            elif item.get("type") == "toolResult":
                                tool_calls.append({
                                    "tool_use_id": item.get("toolCallId"),
                                    "name": item.get("toolName"),
                                    "output": item.get("content"),
                                    "is_error": item.get("isError", False),
                                    "timestamp": data.get("timestamp")
                                })
                    
                    usage = message.get("usage", {})
                    cost = usage.get("cost", {})
                    
                    # 确保 prompt/response 是字符串
                    prompt = None
                    response = None
                    if role == "user" and content:
                        if isinstance(content, str):
                            prompt = content
                        elif isinstance(content, list):
                            # 提取 text 类型的内容
                            texts = [item.get("text", "") for item in content if item.get("type") == "text"]
                            prompt = "\n".join(texts)
                    elif role == "assistant" and content:
                        if isinstance(content, str):
                            response = content
                        elif isinstance(content, list):
                            # 提取 text 类型的内容
                            texts = [item.get("text", "") for item in content if item.get("type") == "text"]
                            response = "\n".join(texts)
                            
                            # 如果没有 text 但有 toolCall，将 toolCall 作为 response
                            if not response:
                                tool_calls_in_content = [item for item in content if item.get("type") == "toolCall"]
                                if tool_calls_in_content:
                                    response_parts = []
                                    for tc in tool_calls_in_content:
                                        tc_name = tc.get("name", "Unknown")
                                        tc_args = tc.get("arguments", {})
                                        response_parts.append(f"[{tc_name}] {json.dumps(tc_args, ensure_ascii=False)[:200]}")
                                    response = "\n".join(response_parts)
                    
                    msg_data = {
                        "trace_id": data.get("id"),
                        "platform": "openclaw",
                        "agent_name": data.get("agentId") or "main",
                        "session_id": session_id,
                        "start_time": data.get("timestamp"),
                        "model": message.get("model", "unknown"),
                        "role": role,
                        "prompt": prompt,
                        "response": response,
                        "input_tokens": usage.get("input", 0),
                        "output_tokens": usage.get("output", 0),
                        "cost_usd": cost.get("total", 0) if isinstance(cost, dict) else 0,
                        "tool_calls": tool_calls,
                        "project_path": session_cwd,
                    }
                    
                    aggregator.add_message(session_id, msg_data)
                    
                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    logger.error(f"Error parsing line: {e}")
        
        return aggregator.get_traces()


class ClaudeCodeCollector(LogCollector):
    """Claude Code 日志收集器"""
    
    def get_name(self) -> str:
        return "claude-code"
    
    def get_log_paths(self) -> List[Path]:
        """Claude Code 日志路径：按项目目录组织"""
        base_path = Path.home() / ".claude" / "projects"
        paths = []
        
        if base_path.exists():
            for project_dir in base_path.iterdir():
                if project_dir.is_dir():
                    for session_file in project_dir.glob("*.jsonl"):
                        paths.append(session_file)
        
        return paths
    
    def _decode_path(self, encoded_name: str) -> str:
        """解码路径编码的目录名"""
        decoded = encoded_name.replace("-", "/")
        if decoded.startswith("/"):
            decoded = decoded[1:]
        return decoded
    
    def parse_session_file(self, log_path: Path) -> List[Dict[str, Any]]:
        """解析 Claude Code session 文件，按 session 聚合"""
        session_id = log_path.stem
        aggregator = SessionAggregator()
        
        # 从目录名提取项目路径
        project_path = ""
        try:
            encoded_path = log_path.parent.name
            project_path = self._decode_path(encoded_path)
        except:
            pass
        
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    data = json.loads(line.strip())
                    msg_type = data.get("type")
                    
                    if msg_type not in ["user", "assistant"]:
                        continue
                    
                    message = data.get("message", {})
                    role = message.get("role")
                    
                    # 提取工具调用
                    tool_calls = []
                    content = message.get("content", [])
                    
                    if isinstance(content, list):
                        for item in content:
                            if item.get("type") == "tool_use":
                                tool_calls.append({
                                    "tool_use_id": item.get("id"),
                                    "name": item.get("name"),
                                    "input": item.get("input", {}),
                                    "timestamp": data.get("timestamp")
                                })
                            elif item.get("type") == "tool_result":
                                tool_calls.append({
                                    "tool_use_id": item.get("tool_use_id"),
                                    "output": item.get("content"),
                                    "timestamp": data.get("timestamp")
                                })
                    
                    usage = message.get("usage", {})
                    
                    # 确保 prompt/response 是字符串
                    prompt = None
                    response = None
                    if role == "user" and content:
                        if isinstance(content, str):
                            prompt = content
                        elif isinstance(content, list):
                            texts = [item.get("text", "") for item in content if item.get("type") == "text"]
                            prompt = "\n".join(texts)
                    elif role == "assistant" and content:
                        if isinstance(content, str):
                            response = content
                        elif isinstance(content, list):
                            texts = [item.get("text", "") for item in content if item.get("type") == "text"]
                            response = "\n".join(texts)
                            
                            # 如果没有 text 但有 tool_use，将 tool_use 作为 response
                            if not response:
                                tool_uses = [item for item in content if item.get("type") == "tool_use"]
                                if tool_uses:
                                    response_parts = []
                                    for tu in tool_uses:
                                        tu_name = tu.get("name", "Unknown")
                                        tu_input = tu.get("input", {})
                                        response_parts.append(f"[{tu_name}] {json.dumps(tu_input, ensure_ascii=False)[:200]}")
                                    response = "\n".join(response_parts)
                    
                    # 从 data 中获取 cwd
                    cwd = data.get("cwd", "")
                    
                    msg_data = {
                        "trace_id": data.get("uuid"),
                        "platform": "claude-code",
                        "agent_name": "claude-code",
                        "session_id": session_id,
                        "start_time": data.get("timestamp"),
                        "model": message.get("model", "unknown"),
                        "role": role,
                        "prompt": prompt,
                        "response": response,
                        "input_tokens": usage.get("input_tokens", 0),
                        "output_tokens": usage.get("output_tokens", 0),
                        "cost_usd": 0,
                        "tool_calls": tool_calls,
                        "project_path": cwd or project_path,
                    }
                    
                    aggregator.add_message(session_id, msg_data)
                    
                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    logger.error(f"Error parsing Claude Code line: {e}")
        
        return aggregator.get_traces()


class KimiCodeCollector(LogCollector):
    """Kimi Code 日志收集器"""
    
    def get_name(self) -> str:
        return "kimi-code"
    
    def get_log_paths(self) -> List[Path]:
        """Kimi Code 日志路径：按 session hash 组织"""
        base_path = Path.home() / ".kimi" / "sessions"
        paths = []
        
        if base_path.exists():
            for session_hash in base_path.iterdir():
                if session_hash.is_dir():
                    for sub_session in session_hash.iterdir():
                        if sub_session.is_dir():
                            wire_file = sub_session / "wire.jsonl"
                            if wire_file.exists():
                                paths.append(wire_file)
        
        return paths
    
    def parse_session_file(self, log_path: Path) -> List[Dict[str, Any]]:
        """解析 Kimi Code wire 文件，按 session 聚合"""
        session_id = log_path.parent.name
        aggregator = SessionAggregator()
        
        # 用于跟踪当前 turn 的信息
        current_turn = {
            "prompt": None,
            "response": None,
            "tool_calls": [],
            "model": "kimi-k2.5",
            "start_time": None,
            "input_tokens": 0,
            "output_tokens": 0,
        }
        
        with open(log_path, 'r', encoding='utf-8') as f:
            for line in f:
                try:
                    data = json.loads(line.strip())
                    msg_type = data.get("type")
                    timestamp = data.get("timestamp")
                    
                    if msg_type == "TurnBegin":
                        # 如果有之前的 turn，先保存
                        if current_turn["prompt"] and current_turn["start_time"]:
                            msg_data = {
                                "trace_id": f"turn-{current_turn['start_time']}",
                                "platform": "kimi-code",
                                "agent_name": "kimi-code",
                                "session_id": session_id,
                                "start_time": datetime.fromtimestamp(current_turn['start_time'], tz=datetime.now().astimezone().tzinfo).isoformat(),
                                "model": current_turn["model"],
                                "role": "assistant",  # Kimi Code 的 turn 是完整的对话回合
                                "prompt": current_turn["prompt"],
                                "response": current_turn["response"],
                                "input_tokens": current_turn["input_tokens"],
                                "output_tokens": current_turn["output_tokens"],
                                "cost_usd": 0,
                                "tool_calls": current_turn["tool_calls"],
                                "project_path": "",
                            }
                            aggregator.add_message(session_id, msg_data)
                        
                        # 开始新的 turn
                        payload = data.get("message", {}).get("payload", {})
                        user_input = payload.get("user_input", [])
                        current_turn = {
                            "prompt": user_input[0].get("text") if user_input else None,
                            "response": None,
                            "tool_calls": [],
                            "model": "kimi-k2.5",
                            "start_time": timestamp,
                            "input_tokens": 0,
                            "output_tokens": 0,
                        }
                    
                    elif msg_type == "ToolCall":
                        payload = data.get("message", {}).get("payload", {})
                        function = payload.get("function", {})
                        current_turn["tool_calls"].append({
                            "tool_use_id": payload.get("id"),
                            "name": function.get("name"),
                            "input": json.loads(function.get("arguments", "{}")),
                            "timestamp": timestamp
                        })
                    
                    elif msg_type == "ToolResult":
                        payload = data.get("message", {}).get("payload", {})
                        return_value = payload.get("return_value", {})
                        current_turn["tool_calls"].append({
                            "tool_use_id": payload.get("tool_call_id"),
                            "output": return_value.get("output"),
                            "is_error": return_value.get("is_error", False),
                            "timestamp": timestamp
                        })
                    
                    elif msg_type == "ContentPart":
                        payload = data.get("message", {}).get("payload", {})
                        content_type = payload.get("type")
                        if content_type == "text":
                            if current_turn["response"]:
                                current_turn["response"] += "\n" + payload.get("text", "")
                            else:
                                current_turn["response"] = payload.get("text", "")
                    
                    elif msg_type == "StatusUpdate":
                        payload = data.get("message", {}).get("payload", {})
                        usage = payload.get("usage", {})
                        if usage:
                            current_turn["input_tokens"] = usage.get("input", 0)
                            current_turn["output_tokens"] = usage.get("output", 0)
                    
                except json.JSONDecodeError:
                    continue
                except Exception as e:
                    logger.error(f"Error parsing Kimi Code line: {e}")
        
        # 保存最后一个 turn
        if current_turn["prompt"] and current_turn["start_time"]:
            msg_data = {
                "trace_id": f"turn-{current_turn['start_time']}",
                "platform": "kimi-code",
                "agent_name": "kimi-code",
                "session_id": session_id,
                "start_time": datetime.fromtimestamp(current_turn['start_time'], tz=datetime.now().astimezone().tzinfo).isoformat(),
                "model": current_turn["model"],
                "role": "assistant",
                "prompt": current_turn["prompt"],
                "response": current_turn["response"],
                "input_tokens": current_turn["input_tokens"],
                "output_tokens": current_turn["output_tokens"],
                "cost_usd": 0,
                "tool_calls": current_turn["tool_calls"],
                "project_path": "",
            }
            aggregator.add_message(session_id, msg_data)
        
        return aggregator.get_traces()


class CollectorManager:
    """收集器管理器"""
    
    def __init__(self, storage):
        self.storage = storage
        self.collectors: List[LogCollector] = [
            OpenClawCollector(storage),
            ClaudeCodeCollector(storage),
            KimiCodeCollector(storage)
        ]
    
    def start_all(self, interval: float = 1.0):
        """启动所有收集器"""
        for collector in self.collectors:
            collector.start_watching(interval)
    
    def stop_all(self):
        """停止所有收集器"""
        for collector in self.collectors:
            collector.stop_watching()
    
    def collect_all_historical(self) -> int:
        """收集所有历史日志"""
        all_traces = []
        for collector in self.collectors:
            traces = collector.collect_historical()
            all_traces.extend(traces)
            logger.info(f"{collector.get_name()}: collected {len(traces)} session traces")
        
        # 按时间排序
        all_traces.sort(key=lambda x: x.get("start_time", ""), reverse=True)
        
        # 批量保存
        if all_traces:
            self.storage.save_traces(all_traces)
        
        return len(all_traces)
    
    def get_collector_status(self) -> List[Dict[str, Any]]:
        """获取收集器状态"""
        return [
            {
                "name": c.get_name(),
                "log_paths": [str(p) for p in c.get_log_paths()],
                "is_watching": c.watching
            }
            for c in self.collectors
        ]
