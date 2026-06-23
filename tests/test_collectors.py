from pathlib import Path

from agentlens.collectors import ClaudeCodeCollector


class DummyStorage:
    def save_traces(self, traces):
        self.traces = traces


def test_decode_path_preserves_posix_shape():
    collector = ClaudeCodeCollector(DummyStorage())

    assert collector._decode_path("-Users-wangwen-WorkSpace-cqj-agentlen") == "/Users/wangwen/WorkSpace/cqj/agentlen"


def test_decode_path_reconstructs_windows_drive_path():
    collector = ClaudeCodeCollector(DummyStorage())

    assert collector._decode_path("C:-Users-wangwen-WorkSpace-cqj-agentlen") == "C:\\Users\\wangwen\\WorkSpace\\cqj\\agentlen"


def test_process_line_prefers_cwd_over_decoded_path(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-fallback"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"assistant","timestamp":"2026-06-21T00:00:00Z","cwd":"C:\\\\Users\\\\real\\\\repo","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":1,"output_tokens":2}}}',
    )

    traces = state["aggregator"].get_traces()

    assert traces[0]["project_path"] == "C:\\Users\\real\\repo"


def test_process_line_uses_decoded_path_when_cwd_missing(tmp_path: Path):
    project_dir = tmp_path / "C:-Users-real-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"assistant","timestamp":"2026-06-21T00:00:00Z","message":{"role":"assistant","model":"claude-sonnet-4-6","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":1,"output_tokens":2}}}',
    )

    traces = state["aggregator"].get_traces()

    assert traces[0]["project_path"] == "C:\\Users\\real\\repo"


def test_consecutive_assistant_records_with_same_message_id_group_under_one_parent_turn(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"user","timestamp":"2026-06-22T03:20:00Z","message":{"role":"user","content":"track recent changes"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"44991d4d-b06c-4144-aaae-cccd91d77bd5","timestamp":"2026-06-22T03:20:05.955Z","message":{"id":"msg_same_turn","role":"assistant","model":"claude-opus-4-8","content":[{"type":"thinking","thinking":"Figuring out recent changes","signature":""}],"usage":{"input_tokens":27581,"output_tokens":630}}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"59961901-e3d9-48a8-b5ad-b8cc9fee9817","timestamp":"2026-06-22T03:20:05.961Z","message":{"id":"msg_same_turn","role":"assistant","model":"claude-opus-4-8","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"git log --stat --decorate -5"}}],"usage":{"input_tokens":27581,"output_tokens":630}}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"4474d629-0815-43fc-93c6-b3abca88e659","timestamp":"2026-06-22T03:20:06.120Z","message":{"id":"msg_same_turn","role":"assistant","model":"claude-opus-4-8","content":[{"type":"tool_use","id":"toolu_2","name":"Bash","input":{"command":"git status --short"}}],"usage":{"input_tokens":27581,"output_tokens":630}}}',
    )

    traces = state["aggregator"].get_traces()
    trace = traces[0]

    assert len(trace["llm_calls"]) == 1
    parent_turn = trace["llm_calls"][0]
    assert parent_turn["id"] == "msg_same_turn"
    assert parent_turn["message_id"] == "msg_same_turn"
    assert parent_turn["child_record_count"] == 3
    assert len(parent_turn["child_records"]) == 3
    assert [child["id"] for child in parent_turn["child_records"]] == [
        "44991d4d-b06c-4144-aaae-cccd91d77bd5",
        "59961901-e3d9-48a8-b5ad-b8cc9fee9817",
        "4474d629-0815-43fc-93c6-b3abca88e659",
    ]
    assert trace["input_tokens"] == 27581
    assert trace["output_tokens"] == 630
    assert len(trace["tool_calls"]) == 2
    assert {tool["assistant_turn_id"] for tool in trace["tool_calls"]} == {"msg_same_turn"}
    assert {tool["assistant_record_id"] for tool in trace["tool_calls"]} == {
        "59961901-e3d9-48a8-b5ad-b8cc9fee9817",
        "4474d629-0815-43fc-93c6-b3abca88e659",
    }


def test_same_message_id_after_user_message_creates_new_parent_turn(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"user","timestamp":"2026-06-22T03:20:00Z","message":{"role":"user","content":"track recent changes"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a1","timestamp":"2026-06-22T03:20:05.955Z","message":{"id":"msg_same_turn","role":"assistant","model":"claude-opus-4-8","content":[{"type":"thinking","thinking":"First snapshot","signature":""}],"usage":{"input_tokens":10,"output_tokens":2}}}',
    )
    collector.process_line(
        state,
        '{"type":"user","timestamp":"2026-06-22T03:20:06.000Z","message":{"role":"user","content":"continue"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a2","timestamp":"2026-06-22T03:20:06.100Z","message":{"id":"msg_same_turn","role":"assistant","model":"claude-opus-4-8","content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"git status --short"}}],"usage":{"input_tokens":12,"output_tokens":3}}}',
    )

    traces = state["aggregator"].get_traces()
    trace = traces[0]

    assert len(trace["llm_calls"]) == 2
    assert [turn["child_record_count"] for turn in trace["llm_calls"]] == [1, 1]
    assert trace["input_tokens"] == 22
    assert trace["output_tokens"] == 5
