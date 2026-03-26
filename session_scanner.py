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
        self.openclaw_runs_file = Path.home() / '.openclaw' / 'subagents' / 'runs.json'
        self.processed_files = set()
        self.agent_name = "session-scanner"
        self.processed_run_ids = set()
        
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
        
        return all_sessions
    
    def _scan_platform_sessions(self, platform: str, dir_path: Path) -> List[Dict]:
        """扫描特定平台的 sessions"""
        sessions = []
        
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
                            'name': tc.get('function', {}).get('name', 'unknown'),
                            'input': tc.get('function', {}).get('arguments', {}),
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
            "trace_id": f"session_{session['session_id']}",
            "platform": session['platform'],
            "agent_name": f"{session['platform']}-agent",
            "session_id": session['session_id'],
            "start_time": datetime.fromtimestamp(session['start_time']).isoformat(),
            "end_time": datetime.now().isoformat(),
            "duration_ms": duration_ms,
            "model": (session.get('llm_calls') or [{}])[0].get('model', session['platform']),
            "prompt": prompt,
            "response": response,
            "input_tokens": session['total_tokens'],
            "output_tokens": 0,
            "cost_usd": session['total_cost'],
            "tool_calls": json.dumps(session['tool_calls']),
            "status": status,
            "error_message": error
        }
        
        try:
            requests.post(
                f"{API_URL}/api/v1/traces",
                json=trace_data,
                timeout=2.0
            )
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
            print(f"  Messages: {session['message_count']}")
            print(f"  Tool Calls: {len(session['tool_calls'])}")
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
