"""AgentLens CLI - 实时观测工具"""

import asyncio
import httpx
import time
from datetime import datetime
from rich.console import Console
from rich.table import Table
from rich.live import Live
from rich.panel import Panel
from rich.layout import Layout

console = Console()

API_URL = "http://localhost:8080"


async def fetch_stats():
    """获取统计信息"""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(f"{API_URL}/api/v1/stats", timeout=2.0)
            return response.json()
        except:
            return None


async def fetch_traces(limit=10):
    """获取最近 traces"""
    async with httpx.AsyncClient() as client:
        try:
            response = await client.get(
                f"{API_URL}/api/v1/traces?limit={limit}",
                timeout=2.0
            )
            data = response.json()
            return data.get("traces", [])
        except:
            return []


def create_dashboard(stats, traces):
    """创建仪表盘布局"""
    layout = Layout()
    
    # 顶部统计
    if stats:
        stats_text = (
            f"📊 Traces: {stats['total_traces']} | "
            f"💰 Cost: ${stats['total_cost']:.4f} | "
            f"📝 Tokens: {stats['total_tokens']:,} | "
            f"⏱️ Avg Latency: {stats['avg_duration_ms']:.0f}ms"
        )
    else:
        stats_text = "⚠️ 无法连接到 AgentLens API"
    
    # 最近 traces 表格
    table = Table(title="Recent Traces", expand=True)
    table.add_column("Time", style="cyan", width=12)
    table.add_column("Platform", style="green", width=15)
    table.add_column("Model", style="blue", width=20)
    table.add_column("Tokens", justify="right", width=10)
    table.add_column("Cost", justify="right", width=10)
    table.add_column("Status", width=10)
    
    for trace in traces[:10]:
        time_str = trace.get("start_time", "")[11:19] if trace.get("start_time") else "--:--:--"
        platform = trace.get("platform", "unknown")
        model = trace.get("model", "-")[:18]
        tokens = trace.get("input_tokens", 0) + trace.get("output_tokens", 0)
        cost = trace.get("cost_usd", 0)
        status = "✓" if trace.get("status") == "success" else "✗"
        
        table.add_row(
            time_str,
            platform,
            model,
            f"{tokens:,}",
            f"${cost:.4f}",
            status
        )
    
    # 组合布局
    layout.split_column(
        Layout(Panel(stats_text, title="AgentLens Monitor", border_style="blue"), size=3),
        Layout(table)
    )
    
    return layout


async def monitor():
    """实时监控模式"""
    console.print("[bold blue]🔍 AgentLens - Claude Code 实时监控[/bold blue]")
    console.print(f"API: {API_URL}")
    console.print("按 Ctrl+C 退出\n")
    
    with Live(refresh_per_second=1) as live:
        while True:
            stats = await fetch_stats()
            traces = await fetch_traces()
            
            dashboard = create_dashboard(stats, traces)
            live.update(dashboard)
            
            await asyncio.sleep(2)


def print_summary():
    """打印当前摘要"""
    import requests
    
    try:
        response = requests.get(f"{API_URL}/api/v1/stats", timeout=2.0)
        stats = response.json()
        
        console.print("\n[bold green]📈 AgentLens 统计摘要[/bold green]")
        console.print(f"总 Traces: {stats['total_traces']}")
        console.print(f"总成本: ${stats['total_cost']:.4f}")
        console.print(f"总 Tokens: {stats['total_tokens']:,}")
        console.print(f"平均延迟: {stats['avg_duration_ms']:.0f}ms")
        
        if stats.get('platforms'):
            console.print("\n[bold]平台分布:[/bold]")
            for p in stats['platforms']:
                console.print(f"  {p['platform']}: {p['count']} 次 (${p['cost']:.4f})")
        
        if stats.get('models'):
            console.print("\n[bold]模型分布:[/bold]")
            for m in stats['models']:
                console.print(f"  {m['model']}: {m['count']} 次 (${m['cost']:.4f})")
                
    except Exception as e:
        console.print(f"[red]错误: {e}[/red]")


if __name__ == "__main__":
    import sys
    
    if len(sys.argv) > 1 and sys.argv[1] == "monitor":
        try:
            asyncio.run(monitor())
        except KeyboardInterrupt:
            console.print("\n[yellow]监控已停止[/yellow]")
    else:
        print_summary()
