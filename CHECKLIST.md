# AgentLens 功能检查清单

用于代码更新后验证功能完整性。

## 基础功能

### 数据收集
- [ ] OpenClaw collector 正常工作
- [ ] Claude Code collector 正常工作
- [ ] Kimi Code collector 正常工作
- [ ] 历史数据收集完整
- [ ] 实时数据更新正常

### API 服务
- [ ] `/api/v1/traces` 返回正确数据格式
- [ ] `/api/v1/stats` 返回正确统计信息
- [ ] 支持 `limit` 参数
- [ ] 支持时间范围过滤

### Dashboard
- [ ] 页面正常加载
- [ ] Trace 列表显示正确
- [ ] 实时更新正常（每 5 秒轮询）

## 数据字段检查

### Trace 基础信息
- [ ] trace_id 正确
- [ ] platform 正确（openclaw/claude-code/kimi-code）
- [ ] agent_name 正确
- [ ] start_time 正确
- [ ] status 正确

### 工作目录
- [ ] OpenClaw: project_path 显示正确
- [ ] Claude Code: project_path 显示正确
- [ ] Kimi Code: project_path 从 ToolCall 推断正确

### Token 统计
- [ ] input_tokens 正确
- [ ] output_tokens 正确
- [ ] cache_read_tokens 正确（如适用）
- [ ] cache_write_tokens 正确（如适用）

### LLM Calls
- [ ] LLM calls 数量正确
- [ ] model 字段正确
- [ ] **prompt 不为空**
- [ ] **response 不为空**
- [ ] input_tokens 正确
- [ ] output_tokens 正确

### Tool Calls
- [ ] Tool calls 数量正确
- [ ] name 字段正确
- [ ] input 参数正确
- [ ] output 结果正确（如适用）

## Dashboard UI 检查

### Trace 列表
- [ ] 显示 Agent 名称
- [ ] 显示平台图标/标识
- [ ] 显示工作目录（简短形式）
- [ ] 显示状态
- [ ] 点击可选中

### Trace 详情面板
- [ ] Overview Tab 正常
- [ ] Timeline Tab 正常
- [ ] Tools Tab 正常
  - [ ] Tool calls 可展开/折叠
  - [ ] 显示 input/output
- [ ] LLM Tab 正常
  - [ ] **显示所有 LLM calls**
  - [ ] **每个 LLM call 显示 prompt**
  - [ ] **每个 LLM call 显示 response**
  - [ ] 支持代码高亮
  - [ ] 支持复制
- [ ] Raw Tab 正常

### 平台筛选
- [ ] 显示所有平台选项
- [ ] OpenClaw 筛选正常
- [ ] Claude Code 筛选正常
- [ ] Kimi Code 筛选正常

### 统计面板
- [ ] 总 Traces 正确
- [ ] 总 Tokens 正确
- [ ] 平台分布正确
- [ ] 模型分布正确

## 各平台特殊检查

### OpenClaw
- [ ] session_id 正确提取
- [ ] tool_calls 格式正确
- [ ] 支持 toolCall 类型 content

### Claude Code
- [ ] session_id 正确提取
- [ ] tool_use/tool_result 正确处理
- [ ] cwd 正确提取

### Kimi Code
- [ ] session hash 正确提取
- [ ] TurnBegin/TurnEnd 正确处理
- [ ] ToolCall/ToolResult 正确处理
- [ ] ContentPart 正确处理
- [ ] StatusUpdate 正确处理
- [ ] **user_input 支持字符串和数组**
- [ ] **工作目录从 ToolCall 推断**
- [ ] **prompt 正确关联到 LLM call**

## 性能检查

- [ ] 数据收集速度正常
- [ ] Dashboard 加载速度正常
- [ ] 大数据量时（>100 traces）性能正常
- [ ] 内存使用正常

## 回归测试命令

```bash
# 1. 重新收集数据
cd projects/agentlens
rm -f ~/.agentlens/agentlens.db
PYTHONPATH=src python3 -c "
from agentlens.collectors import CollectorManager
from agentlens.storage import SQLiteStorage
storage = SQLiteStorage()
manager = CollectorManager(storage)
count = manager.collect_all_historical()
print(f'Collected {count} traces')
"

# 2. 启动 API
PYTHONPATH=src python3 -m agentlens.api

# 3. 检查 API 数据
curl -s "http://localhost:8080/api/v1/traces?limit=5" | python3 -m json.tool

# 4. 检查平台分布
curl -s "http://localhost:8080/api/v1/traces?limit=100" | python3 -c "
import json,sys
d=json.load(sys.stdin)
platforms = {}
for t in d['traces']:
    p = t['platform']
    platforms[p] = platforms.get(p, 0) + 1
for p, c in platforms.items():
    print(f'{p}: {c}')
"

# 5. 检查 LLM calls
curl -s "http://localhost:8080/api/v1/traces?limit=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t = d['traces'][0]
print(f'Platform: {t[\"platform\"]}')
print(f'LLM calls: {len(t.get(\"llm_calls\", []))}')
if t.get('llm_calls'):
    first = t['llm_calls'][0]
    print(f'First prompt: {first.get(\"prompt\", \"None\")[:50]}...')
    print(f'First response: {first.get(\"response\", \"None\")[:50]}...')
"
```

## 已知问题

- [ ] Kimi Code 第一个 LLM call 的 prompt 可能为 None（因为没有前一个 user 消息）

## 版本记录

- **2026-03-31**: 创建检查清单
