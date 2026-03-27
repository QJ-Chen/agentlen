# AgentLens Dashboard v0.2.0

Agent 行为监控与可视化 Dashboard。

## 功能特性

### 1. 列表视图 (List View)
- 所有 Agent 执行记录列表
- 支持搜索和平台筛选
- 点击 Trace 查看详细信息

### 2. Agent 交互图 (Interaction Graph)
三种可视化模式：
- **流程图**: Agent 间调用关系拓扑
- **会话流**: 按 Session 展示执行序列
- **调用矩阵**: Agent 间调用次数统计

### 3. 实时状态 (Realtime Status)
- 运行中任务实时追踪
- 进度条显示
- 当前执行步骤
- 最近完成任务列表

### 4. 详细信息面板
- **概览**: 关键指标、Agent 信息、执行摘要
- **时序**: 可视化时间轴
- **工具**: 工具调用详情（可折叠、可复制）
- **LLM**: LLM 调用详情（Prompt/Response）
- **原始**: 完整 JSON 数据

## 技术栈

- React 19 + TypeScript
- Vite
- Tailwind CSS
- Lucide React (图标)
- Recharts (图表)

## 开发

```bash
cd dashboard
npm install
npm run dev
```

## 构建

```bash
npm run build
```

## API 端点

- `GET /api/v1/traces` - 获取 Traces 列表
- `GET /api/v1/stats` - 获取统计数据

## 截图

### 列表视图
![List View](./screenshots/list-view.png)

### Agent 交互图
![Interaction Graph](./screenshots/interaction-graph.png)

### 实时状态
![Realtime Status](./screenshots/realtime-status.png)

### 详细信息
![Detail Panel](./screenshots/detail-panel.png)

## 更新日志

### v0.2.0 (2026-03-27)
- 新增增强时序图组件
- 新增 Agent 交互图（三种视图）
- 新增实时状态面板
- 优化详细信息面板
- 支持工具调用详情折叠
- 支持一键复制 JSON

### v0.1.0 (2026-03-26)
- 基础 Dashboard 实现
- Trace 列表和详情
- 基础统计面板
