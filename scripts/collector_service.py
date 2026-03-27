#!/usr/bin/env python3
"""AgentLens Collector Service - 后台数据收集服务"""

import sys
import time
import signal
import logging
from pathlib import Path

# 添加 src 到路径
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from agentlens.realtime import start_realtime_updater, stop_realtime_updater, get_updater_status

# 配置日志
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)


def signal_handler(sig, frame):
    """信号处理"""
    logger.info("Shutting down...")
    stop_realtime_updater()
    sys.exit(0)


if __name__ == "__main__":
    # 注册信号处理
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # 启动实时更新器
    logger.info("Starting AgentLens Collector Service...")
    updater = start_realtime_updater(interval=5.0)
    
    logger.info("Collector service is running. Press Ctrl+C to stop.")
    
    # 保持运行
    try:
        while True:
            time.sleep(60)
            status = get_updater_status()
            logger.info(f"Status: {status}")
    except KeyboardInterrupt:
        signal_handler(None, None)
