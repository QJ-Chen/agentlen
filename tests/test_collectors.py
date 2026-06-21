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
