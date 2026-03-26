"""模拟运行脚本 - Skill 市场开发"""

from agentlens.orchestrator import TeamOrchestrator
from pathlib import Path

def main():
    # 初始化编排器
    config_dir = Path(__file__).parent.parent / "configs"
    orchestrator = TeamOrchestrator(config_dir)
    
    # 加载 Agents
    orchestrator.load_agents()
    
    # 创建会话
    orchestrator.create_session(
        project="AgentLens",
        description="开发 Skill 市场功能"
    )
    
    # 定义工作流
    workflow = [
        {
            "agent": "PM-Frank",
            "task": "编写 Skill 市场 PRD 文档，包含功能列表和用户故事",
        },
        {
            "agent": "TechLead-Alex",
            "task": "审查 PRD，设计技术架构，确定 API 接口",
            "depends_on": ["编写 Skill 市场 PRD 文档，包含功能列表和用户故事"],
        },
        {
            "agent": "Backend-Bob",
            "task": "实现 Skill API：列表、详情、搜索接口",
            "depends_on": ["审查 PRD，设计技术架构，确定 API 接口"],
        },
        {
            "agent": "Backend-Bob",
            "task": "实现 Skill 评分和评论系统",
            "depends_on": ["实现 Skill API：列表、详情、搜索接口"],
        },
        {
            "agent": "Frontend-Cathy",
            "task": "设计 Skill 市场 UI 界面",
            "depends_on": ["审查 PRD，设计技术架构，确定 API 接口"],
        },
        {
            "agent": "Frontend-Cathy",
            "task": "实现 Skill 卡片组件和列表页面",
            "depends_on": ["设计 Skill 市场 UI 界面"],
        },
        {
            "agent": "DevOps-David",
            "task": "配置 CI/CD 流水线，设置 staging 环境",
            "depends_on": [
                "实现 Skill 评分和评论系统",
                "实现 Skill 卡片组件和列表页面"
            ],
        },
        {
            "agent": "QA-Emma",
            "task": "编写 API 测试用例，执行功能测试",
            "depends_on": ["配置 CI/CD 流水线，设置 staging 环境"],
        },
        {
            "agent": "TechLead-Alex",
            "task": "最终代码审查，批准合并到 main 分支",
            "depends_on": ["编写 API 测试用例，执行功能测试"],
        },
    ]
    
    # 运行模拟
    session = orchestrator.run_simulation(workflow)
    
    # 打印摘要
    orchestrator.print_summary()
    
    # 获取仪表盘数据
    dashboard = orchestrator.get_dashboard()
    
    print("\n" + "=" * 60)
    print("🔍 详细数据")
    print("=" * 60)
    
    # 打印所有 Span
    print(f"\n所有执行记录 ({len(session.spans)} 个):")
    for span in session.spans:
        print(f"  [{span.agent_name:20}] {span.task_description[:40]:40} | "
              f"{span.status.value:8} | ${span.cost_usd:.6f}")

if __name__ == "__main__":
    main()
