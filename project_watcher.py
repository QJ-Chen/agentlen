"""
AgentLens Project Watcher - 独立项目观测器

无需修改 Claude Code 代码，直接观测项目目录：
- 监控文件变化
- 检测 Agent 活动模式
- 记录执行时间
- 估算 Token 消耗

使用方法:
    python3 project_watcher.py /path/to/your/project
"""

import os
import sys
import time
import json
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Set
from dataclasses import dataclass, asdict
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileModifiedEvent, FileCreatedEvent
import requests

API_URL = "http://localhost:8080"


@dataclass
class Activity:
    """活动记录"""
    timestamp: float
    activity_type: str  # file_change, agent_run, etc.
    file_path: str
    agent_name: str = "unknown"
    duration_ms: int = 0
    tokens_estimate: int = 0


class ProjectWatcher(FileSystemEventHandler):
    """项目观测器"""
    
    def __init__(self, project_path: str, agent_name: str = "claude-code"):
        self.project_path = Path(project_path).resolve()
        self.agent_name = agent_name
        self.session_id = f"watch_{int(time.time())}"
        
        # 状态跟踪
        self.file_hashes: Dict[str, str] = {}
        self.last_activity: float = 0
        self.activity_buffer: List[Activity] = []
        
        # 忽略的目录和文件
        self.ignore_patterns = {
            '.git', '.claude', 'node_modules', '__pycache__',
            '.pytest_cache', '.mypy_cache', '.venv', 'venv',
            '.DS_Store', '*.pyc', '*.pyo', '*.log'
        }
        
        print(f"🔍 AgentLens Project Watcher")
        print(f"📁 监控项目: {self.project_path}")
        print(f"🤖 Agent: {agent_name}")
        print(f"📊 API: {API_URL}")
        print("-" * 60)
    
    def should_ignore(self, path: str) -> bool:
        """检查是否应该忽略"""
        path_obj = Path(path)
        
        # 检查忽略模式
        for part in path_obj.parts:
            if part in self.ignore_patterns:
                return True
        
        # 检查文件扩展名
        if path_obj.suffix in {'.pyc', '.pyo', '.log', '.tmp'}:
            return True
        
        return False
    
    def on_modified(self, event):
        """文件修改事件"""
        if event.is_directory:
            return
        
        if self.should_ignore(event.src_path):
            return
        
        # 计算文件 hash
        try:
            with open(event.src_path, 'rb') as f:
                content = f.read(10240)  # 读取前 10KB
                file_hash = hashlib.md5(content).hexdigest()
        except:
            return
        
        # 检查是否真正变化
        old_hash = self.file_hashes.get(event.src_path)
        if old_hash == file_hash:
            return
        
        self.file_hashes[event.src_path] = file_hash
        
        # 记录活动
        activity = Activity(
            timestamp=time.time(),
            activity_type="file_modified",
            file_path=str(Path(event.src_path).relative_to(self.project_path)),
            agent_name=self.agent_name,
            tokens_estimate=len(content) // 4  # 估算
        )
        
        self.activity_buffer.append(activity)
        self.last_activity = time.time()
        
        # 发送到 AgentLens
        self._send_activity(activity)
        
        print(f"📝 {datetime.now().strftime('%H:%M:%S')} - {activity.file_path}")
    
    def on_created(self, event):
        """文件创建事件"""
        if event.is_directory:
            return
        
        if self.should_ignore(event.src_path):
            return
        
        activity = Activity(
            timestamp=time.time(),
            activity_type="file_created",
            file_path=str(Path(event.src_path).relative_to(self.project_path)),
            agent_name=self.agent_name,
        )
        
        self.activity_buffer.append(activity)
        self._send_activity(activity)
        
        print(f"✨ {datetime.now().strftime('%H:%M:%S')} - {activity.file_path}")
    
    def _send_activity(self, activity: Activity):
        """发送活动到 AgentLens"""
        try:
            trace_data = {
                "trace_id": f"watch_{int(activity.timestamp * 1000)}",
                "platform": self.agent_name,
                "agent_name": self.agent_name,
                "session_id": self.session_id,
                "start_time": datetime.fromtimestamp(activity.timestamp).isoformat(),
                "end_time": datetime.fromtimestamp(activity.timestamp).isoformat(),
                "duration_ms": activity.duration_ms,
                "model": activity.activity_type,
                "prompt": f"File: {activity.file_path}",
                "response": "",
                "input_tokens": activity.tokens_estimate,
                "output_tokens": 0,
                "cost_usd": 0.0,
                "tool_calls": [],
                "status": "success",
                "error_message": ""
            }
            
            requests.post(
                f"{API_URL}/api/v1/traces",
                json=trace_data,
                timeout=1.0
            )
        except:
            pass  # 静默失败
    
    def get_stats(self) -> Dict:
        """获取统计信息"""
        return {
            "total_activities": len(self.activity_buffer),
            "files_modified": len([a for a in self.activity_buffer if a.activity_type == "file_modified"]),
            "files_created": len([a for a in self.activity_buffer if a.activity_type == "file_created"]),
            "session_id": self.session_id,
            "project_path": str(self.project_path),
        }
    
    def save_report(self):
        """保存观测报告"""
        report_path = self.project_path / ".agentlens_report.json"
        
        report = {
            "session_id": self.session_id,
            "start_time": datetime.fromtimestamp(self.activity_buffer[0].timestamp if self.activity_buffer else time.time()).isoformat(),
            "end_time": datetime.now().isoformat(),
            "stats": self.get_stats(),
            "activities": [asdict(a) for a in self.activity_buffer[-100:]]  # 最近 100 条
        }
        
        with open(report_path, 'w') as f:
            json.dump(report, f, indent=2)
        
        print(f"\n📄 报告已保存: {report_path}")


def main():
    """主函数"""
    if len(sys.argv) < 2:
        print("Usage: python3 project_watcher.py <project_path> [agent_name]")
        print("Example: python3 project_watcher.py ~/my-project claude-code")
        sys.exit(1)
    
    project_path = sys.argv[1]
    agent_name = sys.argv[2] if len(sys.argv) > 2 else "claude-code"
    
    if not os.path.exists(project_path):
        print(f"Error: Project path does not exist: {project_path}")
        sys.exit(1)
    
    # 创建观测器
    watcher = ProjectWatcher(project_path, agent_name)
    
    # 创建文件系统观察者
    observer = Observer()
    observer.schedule(watcher, project_path, recursive=True)
    observer.start()
    
    print("\n👀 正在监控... (按 Ctrl+C 停止)\n")
    
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        print("\n\n🛑 停止监控...")
        observer.stop()
    
    observer.join()
    
    # 保存报告
    watcher.save_report()
    
    # 打印摘要
    stats = watcher.get_stats()
    print(f"\n📊 监控摘要:")
    print(f"  总活动: {stats['total_activities']}")
    print(f"  文件修改: {stats['files_modified']}")
    print(f"  文件创建: {stats['files_created']}")
    print(f"\n✅ 观测完成!")


if __name__ == "__main__":
    main()
