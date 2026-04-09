"""
AgentLens Session Scanner - Session 数据扫描器

直接读取 Agent 工具（Claude Code, OpenClaw, Kimi Code）的 session 数据
并在 Dashboard 中展示

功能：
- 扫描 ~/.codex/sessions/ 目录（Claude Code）
- 扫描 ~/.openclaw/sessions/ 目录（OpenClaw）
- 解析 session 文件，提取工具调用和 LLM 交互
- 发送到 AgentLens Dashboard

使用方法:
    python3 session_scanner.py --watch
"""

import os
import json
import time
import glob
import argparse
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import requests

API_URL = "http://localhost:8080"

# Platform token pricing (USD per million tokens)
PLATFORM_PRICING = {
    "openclaw": {"input_per_1m": 0.2, "output_per_1m": 1.2},   # MiniMax-M2
    "claude-code": {"input_per_1m": 3.0, "output_per_1m": 15.0}, # Claude 3.5 Sonnet
    "kimi-code": {"input_per_1m": 0.5, "output_per_1m": 1.5},   # Kimi K2.5
}

def calc_cost(platform: str, input_tokens: int, output_tokens: int) -> float:
    rates = PLATFORM_PRICING.get(platform, {"input_per_1m": 0.5, "output_per_1m": 1.5})
    return (input_tokens / 1_000_000) * rates["input_per_1m"] + (output_tokens / 1_000_000) * rates["output_per_1m"]


@dataclass
class SessionEvent:
    """Session 事件"""
    timestamp: float
    event_type: str  # tool_call, llm_call, message
    tool_name: Optional[str]
    input_data: Any
    output_data: Any
    duration_ms: int
    tokens_in: int = 0
    tokens_out: int = 0
    cost: float = 0.0


class SessionScanner:
    """Session 扫描器"""
    
    def __init__(self):
        self.session_dirs = {
            'claude-code': Path.home() / '.codex' / 'sessions',
            'openclaw': Path.home() / '.openclaw' / 'sessions',
            'kimi-code': Path.home() / '.kimi' / 'sessions',
        }
        self.claude_projects_dir = Path.home() / '.claude' / 'projects'
        self.openclaw_runs_file = Path.home() / '.openclaw' / 'subagents' / 'runs.json'
        self.processed_files = set()
        self.agent_name = "session-scanner"
        self.processed_run_ids = set()
        self.processed_claude_sessions = set()
        
    def scan_sessions(self) -> List[Dict[str, Any]]:
        """扫描所有 session 目录"""
        all_sessions = []
        
        # 扫描传统 session 目录
        for platform, dir_path in self.session_dirs.items():
            if not dir_path.exists():
                print(f"  ⚠️  {platform}: 目录不存在 {dir_path}")
                continue
            
            sessions = self._scan_platform_sessions(platform, dir_path)
            all_sessions.extend(sessions)
            print(f"  ✓ {platform}: 发现 {len(sessions)} 个 sessions")
        
        # 扫描 OpenClaw subagent runs
        if self.openclaw_runs_file.exists():
            openclaw_sessions = self._scan_openclaw_runs()
            all_sessions.extend(openclaw_sessions)
            print(f"  ✓ openclaw-runs: 发现 {len(openclaw_sessions)} 个 runs")
        
        # 扫描 Claude Code projects (详细记录)
        if self.claude_projects_dir.exists():
            claude_sessions = self._scan_claude_projects()
            all_sessions.extend(claude_sessions)
            print(f"  ✓ claude-projects: 发现 {len(claude_sessions)} 个详细 sessions")
        
        return all_sessions
    
    def _scan_platform_sessions(self, platform: str, dir_path: Path) -> List[Dict]:
        """扫描特定平台的 sessions"""
        sessions = []
        
        # Kimi Code 特殊处理 - 扫描 wire.jsonl 文件
        if platform == 'kimi-code':
            return self._scan_kimi_sessions(dir_path)
        
        # 查找 session 文件
        session_files = list(dir_path.glob('**/session.json'))
        session_files.extend(dir_path.glob('**/*.json'))
        
        for file_path in session_files:
            if file_path in self.processed_files:
                continue
            
            try:
                session_data = self._parse_session_file(platform, file_path)
                if session_data:
                    sessions.append(session_data)
                    self.processed_files.add(file_path)
            except Exception as e:
                print(f"    ⚠️ 解析失败 {file_path}: {e}")
        
        return sessions
    
    def _scan_kimi_sessions(self, dir_path: Path) -> List[Dict]:
        """扫描 Kimi Code sessions"""
        sessions = []
        
        # 遍历所有 session 目录
        for session_dir in dir_path.iterdir():
            if not session_dir.is_dir():
                continue
            
            # 查找 wire.jsonl 文件
            for wire_file in session_dir.rglob('wire.jsonl'):
                if wire_file in self.processed_files:
                    continue
                
                try:
                    session_data = self._parse_kimi_wire(wire_file, session_dir.name)
                    if session_data:
                        sessions.append(session_data)
                        self.processed_files.add(wire_file)
                except Exception as e:
                    # Silently skip problematic files
                    pass
        
        return sessions
    
    def _parse_kimi_wire(self, wire_file: Path, session_name: str) -> Optional[Dict]:
        """解析 Kimi Code wire.jsonl"""
        try:
            tool_calls = []
            llm_calls = []
            messages = []
            start_time = None
            end_time = None
            total_input_tokens = 0
            total_output_tokens = 0
            file_paths = []  # Collect file paths to infer working directory
            
            with open(wire_file, 'r', encoding='utf-8', errors='ignore') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    
                    try:
                        event = json.loads(line)
                    except:
                        continue
                    
                    timestamp = event.get('timestamp', time.time())
                    msg = event.get('message', {})
                    if not msg:
                        continue
                    
                    msg_type = msg.get('type', '')
                    payload = msg.get('payload') or {}
                    
                    # Extract file paths from ToolCall to infer working directory
                    if msg_type == 'ToolCall':
                        tool_data = payload or {}
                        func = tool_data.get('function') or {}
                        args = func.get('arguments', '{}')
                        try:
                            args_dict = json.loads(args)
                            path = args_dict.get('path') or args_dict.get('file_path') or args_dict.get('cwd')
                            if path and isinstance(path, str) and path.startswith('/'):
                                file_paths.append(path)
                        except:
                            pass
                    
                    if not start_time:
                        start_time = timestamp
                    end_time = timestamp
                    
                    # TurnBegin - 用户输入
                    if msg_type == 'TurnBegin':
                        user_input = payload.get('user_input', '')
                        messages.append({
                            'role': 'user',
                            'content': user_input,
                            'timestamp': timestamp
                        })
                        llm_calls.append({
                            'model': 'kimi-k2.5',
                            'prompt': user_input,
                            'timestamp': timestamp,
                            'input_tokens': 0,
                            'output_tokens': 0
                        })
                    
                    # ToolCall
                    elif msg_type == 'ToolCall':
                        tool_data = payload or {}
                        func = tool_data.get('function') or {}
                        args = func.get('arguments', '{}')
                        try:
                            args_dict = json.loads(args)
                        except:
                            args_dict = {'raw': args}
                        
                        tool_calls.append({
                            'name': func.get('name', 'unknown'),
                            'input': args_dict,
                            'tool_use_id': tool_data.get('id', ''),
                            'timestamp': timestamp,
                            'output': None
                        })
                    
                    # ToolResult
                    elif msg_type == 'ToolResult':
                        tool_call_id = payload.get('tool_call_id', '')
                        return_value = payload.get('return_value', {})
                        for tc in tool_calls:
                            if tc.get('tool_use_id') == tool_call_id:
                                tc['output'] = return_value.get('output', '')
                                tc['is_error'] = return_value.get('is_error', False)
                                break
                    
                    # ContentPart - LLM 响应
                    elif msg_type == 'ContentPart':
                        content_type = payload.get('type', '')
                        if content_type == 'text':
                            text = payload.get('text', '')
                            if llm_calls:
                                llm_calls[-1]['response'] = text
                    
                    # StatusUpdate - Token 使用
                    elif msg_type == 'StatusUpdate':
                        token_usage = payload.get('token_usage', {})
                        input_tokens = token_usage.get('input_other', 0) + token_usage.get('input_cache_read', 0)
                        output_tokens = token_usage.get('output', 0)
                        
                        total_input_tokens += input_tokens
                        total_output_tokens += output_tokens
                        
                        if llm_calls:
                            llm_calls[-1]['input_tokens'] = input_tokens
                            llm_calls[-1]['output_tokens'] = output_tokens
            
            if not messages and not tool_calls:
                return None
            
            # 计算统计
            duration_ms = int((end_time - start_time) * 1000) if end_time and start_time else 0
            total_tokens = total_input_tokens + total_output_tokens
            # Kimi K2.5: 估算价格
            total_cost = (total_input_tokens * 0.000002) + (total_output_tokens * 0.000008)
            
            # Infer working directory from file paths
            working_dir = None
            if file_paths:
                # Find common prefix of all file paths
                from pathlib import Path as PathLib
                path_objs = [PathLib(p) for p in file_paths if p.startswith('/')]
                if path_objs:
                    common = path_objs[0]
                    for p in path_objs[1:]:
                        # Find common parent
                        while not str(p).startswith(str(common)):
                            common = common.parent
                            if common == PathLib('/'):
                                break
                    if common != PathLib('/'):
                        working_dir = str(common)
            
            return {
                'session_id': f"{session_name}_{wire_file.parent.name[:20]}",
                'platform': 'kimi-code',
                'project': session_name,
                'working_dir': working_dir,
                'file_path': str(wire_file),
                'start_time': start_time or time.time(),
                'message_count': len(messages),
                'tool_calls': tool_calls,
                'llm_calls': llm_calls,
                'total_tokens': total_tokens,
                'total_cost': total_cost,
                'duration_ms': duration_ms,
                'status': 'success'
            }
            
        except Exception as e:
            print(f"    ⚠️ 解析 Kimi wire {wire_file.name} 失败: {e}")
            return None
    
    def _scan_openclaw_runs(self) -> List[Dict]:
        """扫描 OpenClaw subagent runs"""
        sessions = []
        
        try:
            with open(self.openclaw_runs_file, 'r', encoding='utf-8') as f:
                data = json.load(f)
            
            runs = data.get('runs', {})
            
            for run_id, run_data in runs.items():
                if run_id in self.processed_run_ids:
                    continue
                
                session = self._parse_openclaw_run(run_id, run_data)
                if session:
                    sessions.append(session)
                    self.processed_run_ids.add(run_id)
                    
        except Exception as e:
            print(f"    ⚠️ 解析 OpenClaw runs 失败: {e}")
        
        return sessions
    
    def _scan_claude_projects(self) -> List[Dict]:
        """扫描 Claude Code projects 目录 (详细记录)"""
        sessions = []
        
        try:
            # 遍历所有 project 目录
            for project_dir in self.claude_projects_dir.iterdir():
                if not project_dir.is_dir():
                    continue
                
                # 查找 jsonl 文件
                jsonl_files = list(project_dir.glob('*.jsonl'))
                
                for jsonl_file in jsonl_files:
                    session_id = jsonl_file.stem
                    if session_id in self.processed_claude_sessions:
                        continue
                    
                    session = self._parse_claude_jsonl(jsonl_file, project_dir.name)
                    if session:
                        sessions.append(session)
                        self.processed_claude_sessions.add(session_id)
                        
        except Exception as e:
            print(f"    ⚠️ 扫描 Claude projects 失败: {e}")
        
        return sessions
    
    def _parse_claude_jsonl(self, jsonl_file: Path, project_name: str) -> Optional[Dict]:
        """解析 Claude Code jsonl 文件"""
        try:
            tool_calls = []
            llm_calls = []
            messages = []
            start_time = None
            end_time = None
            
            # Decode working directory from project directory name
            # Format: -Users-username-path-to-project
            working_dir = None
            if project_name.startswith('-'):
                # Replace - with / and remove leading -
                decoded = project_name[1:].replace('-', '/')
                # Handle special case where multiple - become //
                while '//' in decoded:
                    decoded = decoded.replace('//', '/')
                working_dir = '/' + decoded
            
            with open(jsonl_file, 'r', encoding='utf-8') as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    
                    try:
                        event = json.loads(line)
                    except:
                        continue
                    
                    event_type = event.get('type')
                    timestamp_raw = event.get('timestamp', time.time())
                    # Handle ISO format timestamps
                    if isinstance(timestamp_raw, str):
                        from datetime import datetime
                        try:
                            # Try parsing ISO format
                            dt = datetime.fromisoformat(timestamp_raw.replace('Z', '+00:00'))
                            timestamp = dt.timestamp()
                        except:
                            timestamp = time.time()
                    else:
                        timestamp = timestamp_raw
                    
                    if not start_time:
                        start_time = timestamp
                    end_time = timestamp
                    
                    # 提取用户消息 (LLM 输入)
                    if event_type == 'user':
                        content = event.get('content', '')
                        messages.append({
                            'role': 'user',
                            'content': content,
                            'timestamp': timestamp
                        })
                        llm_calls.append({
                            'model': 'claude-3-5-sonnet',
                            'prompt': content,
                            'timestamp': timestamp,
                            'tokens': len(content) // 4
                        })
                    
                    # 提取助手消息 (LLM 响应) 和工具调用
                    elif event_type == 'assistant':
                        message_data = event.get('message', {})
                        content_parts = message_data.get('content', [])
                        
                        # Extract text content
                        text_content = ''
                        for part in content_parts:
                            if part.get('type') == 'text':
                                text_content += part.get('text', '')
                            elif part.get('type') == 'tool_use':
                                # Extract tool call
                                tool_name = part.get('name', 'unknown')
                                input_data = part.get('input', {})
                                tool_use_id = part.get('id', '')
                                
                                tool_calls.append({
                                    'name': tool_name,
                                    'input': input_data,
                                    'output': None,
                                    'tool_use_id': tool_use_id,
                                    'timestamp': timestamp
                                })
                            elif part.get('type') == 'tool_result':
                                # Find matching tool call and update output
                                result_id = part.get('tool_use_id', '')
                                for tc in tool_calls:
                                    if tc.get('tool_use_id') == result_id:
                                        tc['output'] = part.get('content', '')
                                        break
                        
                        # Get usage info
                        usage = message_data.get('usage', {})
                        input_tokens = usage.get('input_tokens', 0)
                        output_tokens = usage.get('output_tokens', 0)
                        model = message_data.get('model', 'claude-3-5-sonnet')
                        
                        messages.append({
                            'role': 'assistant',
                            'content': text_content,
                            'timestamp': timestamp,
                            'input_tokens': input_tokens,
                            'output_tokens': output_tokens,
                            'model': model
                        })
                        
                        if llm_calls:
                            llm_calls[-1]['response'] = text_content
                            llm_calls[-1]['output_tokens'] = output_tokens
                            llm_calls[-1]['input_tokens'] = input_tokens
                            llm_calls[-1]['model'] = model
            
            if not messages and not tool_calls:
                return None
            
            # 计算统计
            duration_ms = int((end_time - start_time) * 1000) if end_time and start_time else 0
            total_input_tokens = sum(m.get('input_tokens', 0) for m in llm_calls)
            total_output_tokens = sum(m.get('output_tokens', 0) for m in llm_calls)
            total_tokens = total_input_tokens + total_output_tokens
            # Claude 3.5 Sonnet: $3/M input, $15/M output
            total_cost = (total_input_tokens * 0.000003) + (total_output_tokens * 0.000015)
            
            return {
                'session_id': jsonl_file.stem[:20],
                'platform': 'claude-code',
                'project': project_name,
                'working_dir': working_dir,
                'file_path': str(jsonl_file),
                'start_time': start_time or time.time(),
                'message_count': len(messages),
                'tool_calls': tool_calls,
                'llm_calls': llm_calls,
                'total_tokens': total_tokens,
                'total_cost': total_cost,
                'duration_ms': duration_ms,
                'status': 'success'
            }
            
        except Exception as e:
            print(f"    ⚠️ 解析 {jsonl_file.name} 失败: {e}")
            return None
    
    def _parse_openclaw_run(self, run_id: str, run_data: Dict) -> Optional[Dict]:
        """解析单个 OpenClaw run"""
        try:
            created_at = run_data.get('createdAt', 0) / 1000  # ms to s
            started_at = run_data.get('startedAt', 0) / 1000
            ended_at = run_data.get('endedAt', 0) / 1000
            
            duration_ms = int((ended_at - started_at) * 1000) if ended_at > started_at else 0
            
            outcome = run_data.get('outcome', {})
            status = outcome.get('status', 'unknown')
            
            # 提取工具调用（从 frozenResultText 估算）
            result_text = run_data.get('frozenResultText', '') or ''
            
            # 估算 token
            task_tokens = len(run_data.get('task', '')) // 4
            result_tokens = len(result_text) // 4
            total_tokens = task_tokens + result_tokens
            
            # 估算成本
            model = run_data.get('model', 'unknown')
            cost_per_1k = 0.01 if 'gpt-4' in model else 0.002
            total_cost = (total_tokens / 1000) * cost_per_1k
            
            return {
                'session_id': run_id[:20],
                'platform': 'openclaw',
                'file_path': str(self.openclaw_runs_file),
                'start_time': created_at or time.time(),
                'message_count': 1,
                'tool_calls': [],
                'llm_calls': [{
                    'model': model,
                    'prompt': run_data.get('task', '')[:200],
                    'response': result_text[:200],
                    'tokens': total_tokens,
                    'status': status
                }],
                'total_tokens': total_tokens,
                'total_cost': total_cost,
                'duration_ms': duration_ms,
                'status': status,
                'label': run_data.get('label', 'unnamed'),
                'error': outcome.get('error', '') if status == 'error' else ''
            }
        except Exception as e:
            print(f"    ⚠️ 解析 run {run_id[:20]} 失败: {e}")
            return None
    
    def _parse_session_file(self, platform: str, file_path: Path) -> Optional[Dict]:
        """解析 session 文件"""
        try:
            with open(file_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except:
            return None
        
        # 提取 session 信息
        session_id = data.get('id') or file_path.stem
        start_time = data.get('start_time') or data.get('created_at') or time.time()
        
        # 提取消息/交互
        messages = data.get('messages', [])
        interactions = data.get('interactions', [])
        events = data.get('events', [])
        
        # 解析工具调用
        tool_calls = []
        llm_calls = []
        
        for msg in messages:
            if isinstance(msg, dict):
                # 检测工具调用
                if msg.get('role') == 'assistant' and msg.get('tool_calls'):
                    for tc in msg['tool_calls']:
                        tool_calls.append({
                            'name': (tc.get('function') or {}).get('name', 'unknown'),
                            'input': (tc.get('function') or {}).get('arguments', {}),
                            'timestamp': msg.get('timestamp', time.time())
                        })
                
                # 检测 LLM 调用
                if msg.get('role') == 'user':
                    llm_calls.append({
                        'prompt': msg.get('content', '')[:200],
                        'timestamp': msg.get('timestamp', time.time()),
                        'tokens': len(msg.get('content', '')) // 4
                    })
        
        # 计算统计
        total_tokens = sum(t.get('tokens', 0) for t in llm_calls)
        total_cost = total_tokens * 0.00001  # 估算
        
        return {
            'session_id': session_id,
            'platform': platform,
            'file_path': str(file_path),
            'start_time': start_time,
            'message_count': len(messages),
            'tool_calls': tool_calls,
            'llm_calls': llm_calls,
            'total_tokens': total_tokens,
            'total_cost': total_cost
        }
    
    def send_to_agentlens(self, session: Dict):
        """发送 session 数据到 AgentLens"""
        # 构建提示词和响应
        if session['platform'] == 'openclaw' and session.get('llm_calls'):
            llm_call = session['llm_calls'][0]
            prompt = f"[OpenClaw] {session.get('label', 'Run')}\n{llm_call.get('prompt', '')[:300]}"
            response = llm_call.get('response', '')[:500]
            status = session.get('status', 'success')
            error = session.get('error', '')
            duration_ms = session.get('duration_ms', 0)
        else:
            prompt = f"Session: {session['session_id']}\nMessages: {session['message_count']}"
            response = json.dumps({
                "tool_calls": session['tool_calls'],
                "llm_calls": session['llm_calls']
            })
            status = "success"
            error = ""
            duration_ms = 0
        
        trace_data = {
            "trace_id": f"session_{session['session_id'][:20]}",
            "platform": session['platform'],
            "agent_name": session.get('agent_name') or f"{session['platform']}-agent",
            "session_id": session['session_id'][:40],  # 避免超长 ID
            "start_time": datetime.fromtimestamp(session['start_time']).isoformat(),
            "end_time": datetime.now().isoformat(),
            "duration_ms": duration_ms,
            "model": (session.get('llm_calls') or [{}])[0].get('model', session['platform']),
            "prompt": prompt,
            "response": response,
            "input_tokens": sum(lc.get('input_tokens', 0) for lc in session.get('llm_calls', [])),
            "output_tokens": sum(lc.get('output_tokens', 0) for lc in session.get('llm_calls', [])),
            "cost_usd": calc_cost(
                session['platform'],
                sum(lc.get('input_tokens', 0) for lc in session.get('llm_calls', [])),
                sum(lc.get('output_tokens', 0) for lc in session.get('llm_calls', []))
            ),
            "tool_calls": session['tool_calls'],
            "status": status,
            "error_message": error,
            "metadata": {
                "working_dir": session.get('working_dir'),
                "project": session.get('project')
            }
        }
        
        # 确保必填字段不为空
        if not trace_data.get('prompt'):
            trace_data['prompt'] = f"{session['platform']} session"
        if not trace_data.get('response'):
            trace_data['response'] = ""
        
        try:
            response = requests.post(
                f"{API_URL}/api/v1/traces",
                json=trace_data,
                timeout=3.0
            )
            if response.status_code >= 400:
                print(f"    ⚠️ API {response.status_code}: {response.text[:100]}")
                return False
            return True
        except Exception as e:
            print(f"    ⚠️ 发送失败: {e}")
            return False
    
    def watch_mode(self, interval: int = 5):
        """持续监控模式"""
        print("🔍 AgentLens Session Scanner - 监控模式")
        print("=" * 60)
        print(f"监控目录:")
        for platform, path in self.session_dirs.items():
            print(f"  {platform}: {path}")
        print(f"\nAPI: {API_URL}")
        print(f"刷新间隔: {interval}秒")
        print("=" * 60)
        print("\n按 Ctrl+C 停止\n")
        
        try:
            while True:
                sessions = self.scan_sessions()
                
                for session in sessions:
                    if self.send_to_agentlens(session):
                        print(f"  ✓ 已发送: {session['platform']} | {session['session_id'][:20]}...")
                
                if sessions:
                    print(f"\n[{datetime.now().strftime('%H:%M:%S')}] 完成一轮扫描\n")
                
                time.sleep(interval)
                
        except KeyboardInterrupt:
            print("\n\n🛑 监控已停止")
    
    def scan_once(self):
        """单次扫描"""
        print("🔍 AgentLens Session Scanner - 单次扫描")
        print("=" * 60)
        
        sessions = self.scan_sessions()
        
        if not sessions:
            print("\n⚠️ 未发现 sessions")
            return
        
        print(f"\n发现 {len(sessions)} 个 sessions:\n")
        
        for session in sessions:
            print(f"  Platform: {session['platform']}")
            print(f"  Session: {session['session_id']}")
            if session['platform'] == 'openclaw':
                print(f"  Label: {session.get('label', 'N/A')}")
                print(f"  Status: {session.get('status', 'unknown')}")
                print(f"  Duration: {session.get('duration_ms', 0)}ms")
            elif session['platform'] == 'claude-code' and session.get('project'):
                print(f"  Project: {session['project']}")
            print(f"  Messages: {session['message_count']}")
            print(f"  Tool Calls: {len(session['tool_calls'])}")
            if session.get('tool_calls'):
                for tc in session['tool_calls'][:3]:
                    print(f"    - {tc.get('name', 'unknown')}: {str(tc.get('input', {}))[:60]}...")
            print(f"  LLM Calls: {len(session['llm_calls'])}")
            print(f"  Tokens: {session['total_tokens']}")
            print(f"  Cost: ${session['total_cost']:.4f}")
            print()
            
            if self.send_to_agentlens(session):
                print(f"  ✓ 已发送到 AgentLens")
            print("-" * 40)


def main():
    parser = argparse.ArgumentParser(description='AgentLens Session Scanner')
    parser.add_argument('--watch', action='store_true', help='持续监控模式')
    parser.add_argument('--interval', type=int, default=5, help='刷新间隔（秒）')
    
    args = parser.parse_args()
    
    scanner = SessionScanner()
    
    if args.watch:
        scanner.watch_mode(args.interval)
    else:
        scanner.scan_once()


if __name__ == "__main__":
    main()
