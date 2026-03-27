"""AgentLens Collectors - 多平台日志收集器（简化版，无 watchdog 依赖）"""

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
    def parse_log_entry(self, line: str, context: Dict = None) -> Optional[Dict[str, Any]]:
        """解析单条日志记录"""
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
        """检查文件变化"""
        for log_path in self.get_log_paths():
            if not log_path.exists():
                continue
            
            current_size = log_path.stat().st_size
            last_position = self.file_positions.get(log_path, 0)
            
            if current_size > last_position:
                try:
                    with open(log_path, 'r', encoding='utf-8') as f:
                        f.seek(last_position)
                        new_lines = f.readlines()
                        self.file_positions[log_path] = f.tell()
                    
                    for line in new_lines:
                        trace = self.parse_log_entry(line.strip())
                        if trace:
                            self.storage.save_trace(trace)
                
                except Exception as e:
                    logger.error(f"Error processing {log_path}: {e}")
    
    def collect_historical(self) -> List[Dict[str, Any]]:
        """收集历史日志"""
        traces = []
        
        for log_path in self.get_log_paths():
            if not log_path.exists():
                continue
            
            try:
                with open(log_path, 'r', encoding='utf-8') as f:
                    for line in f:
                        trace = self.parse_log_entry(line.strip())
                        if trace:
                            traces.append(trace)
                
                # 更新文件位置
                self.file_positions[log_path] = log_path.stat().st_size
                
            except Exception as e:
                logger.error(f"Error reading {log_path}: {e}")
        
        return traces


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
    
    def parse_log_entry(self, line: str, context: Dict = None) -> Optional[Dict[str, Any]]:
        """解析 OpenClaw session 日志"""
        try:
            data = json.loads(line)
            msg_type = data.get("type")
            
            if msg_type != "message":
                return None
            
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
            
            return {
                "trace_id": data.get("id"),
                "platform": "openclaw",
                "agent_name": data.get("agentId") or "main",
                "session_id": data.get("sessionId"),
                "start_time": data.get("timestamp"),
                "model": message.get("model", "unknown"),
                "role": role,
                "prompt": content if role == "user" else None,
                "response": content if role == "assistant" else None,
                "input_tokens": usage.get("input", 0),
                "output_tokens": usage.get("output", 0),
                "cache_read_tokens": usage.get("cacheRead", 0),
                "cache_write_tokens": usage.get("cacheWrite", 0),
                "cost_usd": cost.get("total", 0) if isinstance(cost, dict) else 0,
                "tool_calls": tool_calls,
                "status": "success" if role == "assistant" else "pending",
                "metadata": {
                    "parent_id": data.get("parentId"),
                    "provider": message.get("provider"),
                    "stop_reason": message.get("stopReason"),
                    "thinking_level": data.get("thinkingLevel"),
                    "api": message.get("api")
                }
            }
        
        except json.JSONDecodeError:
            return None
        except Exception as e:
            logger.error(f"Error parsing OpenClaw log: {e}")
            return None


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
    
    def parse_log_entry(self, line: str, context: Dict = None) -> Optional[Dict[str, Any]]:
        """解析 Claude Code 项目级日志"""
        try:
            data = json.loads(line)
            msg_type = data.get("type")
            
            if msg_type not in ["user", "assistant"]:
                return None
            
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
            
            # 从 cwd 提取项目路径
            cwd = data.get("cwd", "")
            project_name = Path(cwd).name if cwd else "unknown"
            
            return {
                "trace_id": data.get("uuid"),
                "platform": "claude-code",
                "agent_name": "claude-code",
                "session_id": data.get("sessionId"),
                "start_time": data.get("timestamp"),
                "model": message.get("model", "unknown"),
                "role": role,
                "prompt": content if role == "user" and isinstance(content, str) else None,
                "response": content if role == "assistant" else None,
                "input_tokens": usage.get("input_tokens", 0),
                "output_tokens": usage.get("output_tokens", 0),
                "cache_creation_input_tokens": usage.get("cache_creation_input_tokens", 0),
                "cache_read_input_tokens": usage.get("cache_read_input_tokens", 0),
                "cost_usd": 0,
                "tool_calls": tool_calls,
                "status": "success" if role == "assistant" else "pending",
                "project_path": cwd,
                "metadata": {
                    "parent_uuid": data.get("parentUuid"),
                    "is_sidechain": data.get("isSidechain"),
                    "version": data.get("version"),
                    "git_branch": data.get("gitBranch"),
                    "permission_mode": data.get("permissionMode"),
                    "stop_reason": message.get("stop_reason")
                }
            }
        
        except json.JSONDecodeError:
            return None
        except Exception as e:
            logger.error(f"Error parsing Claude Code log: {e}")
            return None


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
    
    def parse_log_entry(self, line: str, context: Dict = None) -> Optional[Dict[str, Any]]:
        """解析 Kimi Code wire 日志"""
        try:
            data = json.loads(line)
            msg_type = data.get("type")
            
            if msg_type == "TurnBegin":
                return self._parse_turn_begin(data)
            elif msg_type == "ToolCall":
                return self._parse_tool_call(data)
            elif msg_type == "ToolResult":
                return self._parse_tool_result(data)
            elif msg_type == "ContentPart":
                return self._parse_content_part(data)
            
            return None
        
        except json.JSONDecodeError:
            return None
        except Exception as e:
            logger.error(f"Error parsing Kimi Code log: {e}")
            return None
    
    def _parse_turn_begin(self, data: Dict) -> Optional[Dict[str, Any]]:
        """解析 TurnBegin 消息"""
        payload = data.get("message", {}).get("payload", {})
        user_input = payload.get("user_input", [])
        
        return {
            "trace_id": f"turn-{data.get('timestamp')}",
            "platform": "kimi-code",
            "agent_name": "kimi-code",
            "start_time": datetime.fromtimestamp(data.get("timestamp", 0)).isoformat(),
            "role": "user",
            "prompt": user_input[0].get("text") if user_input else None,
            "status": "streaming",
            "metadata": {"message_type": "TurnBegin"}
        }
    
    def _parse_tool_call(self, data: Dict) -> Optional[Dict[str, Any]]:
        """解析 ToolCall 消息"""
        payload = data.get("message", {}).get("payload", {})
        function = payload.get("function", {})
        
        return {
            "trace_id": f"tool-{data.get('timestamp')}",
            "platform": "kimi-code",
            "agent_name": "kimi-code",
            "start_time": datetime.fromtimestamp(data.get("timestamp", 0)).isoformat(),
            "tool_calls": [{
                "tool_use_id": payload.get("id"),
                "name": function.get("name"),
                "input": json.loads(function.get("arguments", "{}")),
                "timestamp": data.get("timestamp")
            }],
            "status": "success",
            "metadata": {"message_type": "ToolCall"}
        }
    
    def _parse_tool_result(self, data: Dict) -> Optional[Dict[str, Any]]:
        """解析 ToolResult 消息"""
        payload = data.get("message", {}).get("payload", {})
        return_value = payload.get("return_value", {})
        
        return {
            "trace_id": f"result-{data.get('timestamp')}",
            "platform": "kimi-code",
            "agent_name": "kimi-code",
            "start_time": datetime.fromtimestamp(data.get("timestamp", 0)).isoformat(),
            "tool_calls": [{
                "tool_use_id": payload.get("tool_call_id"),
                "output": return_value.get("output"),
                "is_error": return_value.get("is_error", False),
                "timestamp": data.get("timestamp")
            }],
            "status": "error" if return_value.get("is_error") else "success",
            "metadata": {"message_type": "ToolResult"}
        }
    
    def _parse_content_part(self, data: Dict) -> Optional[Dict[str, Any]]:
        """解析 ContentPart 消息"""
        payload = data.get("message", {}).get("payload", {})
        
        return {
            "trace_id": f"content-{data.get('timestamp')}",
            "platform": "kimi-code",
            "agent_name": "kimi-code",
            "start_time": datetime.fromtimestamp(data.get("timestamp", 0)).isoformat(),
            "role": "assistant",
            "response": payload.get("text"),
            "status": "success",
            "metadata": {
                "message_type": "ContentPart",
                "content_type": payload.get("type")
            }
        }


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
            logger.info(f"{collector.get_name()}: collected {len(traces)} traces")
        
        # 按时间排序
        all_traces.sort(key=lambda x: x.get("start_time", ""))
        
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
