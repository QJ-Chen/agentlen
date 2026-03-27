"""AgentLens Realtime Updater - 实时数据更新服务"""

import time
import threading
from pathlib import Path
from typing import Dict, Any
import logging

from agentlens.collectors import CollectorManager
from agentlens.storage import SQLiteStorage

logger = logging.getLogger(__name__)


class RealtimeUpdater:
    """实时数据更新器 - 后台持续收集新数据"""
    
    def __init__(self, storage: SQLiteStorage, interval: float = 5.0):
        self.storage = storage
        self.interval = interval
        self.manager = CollectorManager(storage)
        self.running = False
        self.thread: threading.Thread = None
        self.last_counts: Dict[str, int] = {}
    
    def start(self):
        """启动实时更新"""
        if self.running:
            return
        
        self.running = True
        
        # 首先收集历史数据
        logger.info("Collecting historical data...")
        count = self.manager.collect_all_historical()
        logger.info(f"Collected {count} historical traces")
        
        # 记录初始文件位置
        for collector in self.manager.collectors:
            for log_path in collector.get_log_paths():
                if log_path.exists():
                    # 获取当前行数
                    with open(log_path, 'r', encoding='utf-8') as f:
                        self.last_counts[str(log_path)] = sum(1 for _ in f)
        
        # 启动后台线程
        self.thread = threading.Thread(target=self._update_loop, daemon=True)
        self.thread.start()
        
        logger.info(f"Realtime updater started (interval: {self.interval}s)")
    
    def stop(self):
        """停止实时更新"""
        self.running = False
        if self.thread:
            self.thread.join(timeout=5)
        logger.info("Realtime updater stopped")
    
    def _update_loop(self):
        """更新循环"""
        while self.running:
            try:
                self._check_for_updates()
            except Exception as e:
                logger.error(f"Error in update loop: {e}")
            
            time.sleep(self.interval)
    
    def _check_for_updates(self):
        """检查并更新数据"""
        updated = False
        
        for collector in self.manager.collectors:
            for log_path in collector.get_log_paths():
                if not log_path.exists():
                    continue
                
                path_str = str(log_path)
                last_count = self.last_counts.get(path_str, 0)
                
                # 获取当前行数
                with open(log_path, 'r', encoding='utf-8') as f:
                    current_count = sum(1 for _ in f)
                
                if current_count > last_count:
                    # 有新数据，重新解析整个文件
                    logger.debug(f"{log_path.name}: {current_count - last_count} new lines")
                    
                    try:
                        traces = collector.parse_session_file(log_path)
                        for trace in traces:
                            self.storage.save_trace(trace)
                        updated = True
                    except Exception as e:
                        logger.error(f"Error updating {log_path}: {e}")
                    
                    self.last_counts[path_str] = current_count
        
        if updated:
            logger.info("Data updated")
    
    def get_status(self) -> Dict[str, Any]:
        """获取更新器状态"""
        return {
            "running": self.running,
            "interval": self.interval,
            "collectors": [
                {
                    "name": c.get_name(),
                    "files": len(c.get_log_paths())
                }
                for c in self.manager.collectors
            ]
        }


# 全局更新器实例
_updater: RealtimeUpdater = None


def start_realtime_updater(interval: float = 5.0) -> RealtimeUpdater:
    """启动全局实时更新器"""
    global _updater
    if _updater is None:
        storage = SQLiteStorage()
        _updater = RealtimeUpdater(storage, interval)
        _updater.start()
    return _updater


def stop_realtime_updater():
    """停止全局实时更新器"""
    global _updater
    if _updater:
        _updater.stop()
        _updater = None


def get_updater_status() -> Dict[str, Any]:
    """获取更新器状态"""
    if _updater:
        return _updater.get_status()
    return {"running": False}


if __name__ == "__main__":
    # 测试
    import sys
    logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    
    updater = start_realtime_updater(interval=5.0)
    
    try:
        while True:
            time.sleep(10)
            status = updater.get_status()
            print(f"Status: {status}")
    except KeyboardInterrupt:
        stop_realtime_updater()
        print("Stopped")
