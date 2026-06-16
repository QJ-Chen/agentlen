# AgentLens 功能检查清单

用于代码更新后验证 Claude Code 运行时路径的功能完整性。

## 基础功能

### 数据收集
- [ ] Claude Code collector 正常工作
- [ ] 历史数据收集完整
- [ ] 实时数据更新正常
- [ ] 非 Claude 数据会被拒绝或清理

### API 服务
- [ ] `/api/v1/traces` 返回正确数据格式
- [ ] `/api/v1/stats` 返回正确统计信息
- [ ] `/api/v1/sessions` 返回正确 session 数据
- [ ] `/api/v1/platforms` 仅返回 `claude-code`
- [ ] 支持 `limit` 参数
- [ ] 支持时间范围过滤

### Dashboard
- [ ] 页面正常加载
- [ ] Session 列表显示正确
- [ ] 实时更新正常（每 5 秒轮询）

## 数据字段检查

### Trace / Session 基础信息
- [ ] trace_id 正确
- [ ] platform 固定为 `claude-code`
- [ ] agent_name 正确
- [ ] start_time 正确
- [ ] status 正确

### 工作目录
- [ ] Claude Code: project_path 显示正确
- [ ] session_file_path 显示正确

### Token 统计
- [ ] input_tokens 正确
- [ ] output_tokens 正确
- [ ] cache_read_tokens 正确（如适用）
- [ ] cache_write_tokens 正确（如适用）

### LLM Calls
- [ ] LLM calls 数量正确
- [ ] model 字段正确
- [ ] prompt 不为空（在有用户输入的场景中）
- [ ] response 不为空
- [ ] input_tokens 正确
- [ ] output_tokens 正确

### Tool Calls
- [ ] Tool calls 数量正确
- [ ] name 字段正确
- [ ] input 参数正确
- [ ] output 结果正确（如适用）

## Dashboard UI 检查

### Session 列表
- [ ] 显示 Agent 名称
- [ ] 显示 Claude Code 标识
- [ ] 显示工作目录（简短形式）
- [ ] 显示状态
- [ ] 点击可选中

### Session 详情面板
- [ ] Overview Tab 正常
- [ ] Timeline Tab 正常
- [ ] Tools Tab 正常
  - [ ] Tool calls 可展开/折叠
  - [ ] 显示 input/output
- [ ] LLM Tab 正常
  - [ ] 显示所有 LLM calls
  - [ ] 每个 LLM call 显示 prompt
  - [ ] 每个 LLM call 显示 response
  - [ ] 支持代码高亮
  - [ ] 支持复制
- [ ] Raw Tab 正常

### 状态筛选
- [ ] completed 筛选正常
- [ ] failed 筛选正常
- [ ] running 筛选正常
- [ ] cancelled 筛选正常

### 统计面板
- [ ] 总 Sessions 正确
- [ ] 总 Tokens 正确
- [ ] 模型分布正确
- [ ] 工具分布正确

## 回归测试命令

```bash
# 1. 重新收集数据
rm -f ~/.agentlens/agentlens.db
python3 session_scanner.py

# 2. 启动 API
python3 -m src.agentlens.api

# 3. 检查 API 数据
curl -s "http://localhost:8080/api/v1/traces?limit=5" | python3 -m json.tool

# 4. 检查平台输出
curl -s "http://localhost:8080/api/v1/platforms" | python3 -m json.tool

# 5. 检查 LLM calls
curl -s "http://localhost:8080/api/v1/traces?limit=1" | python3 -c "
import json,sys
d=json.load(sys.stdin)
t = d['traces'][0]
print(f'Platform: {t["platform"]}')
print(f'LLM calls: {len(t.get("llm_calls", []))}')
if t.get('llm_calls'):
    first = t['llm_calls'][0]
    print(f'First prompt: {first.get("prompt", "None")[:50]}...')
    print(f'First response: {first.get("response", "None")[:50]}...')
"
```

## 已知问题

- [ ] 某些非常早期或异常中断的 Claude Code 记录可能缺少完整 prompt/response 对

## 版本记录

- **2026-03-31**: 创建检查清单
- **2026-06-16**: 收缩为 Claude Code only 检查项
