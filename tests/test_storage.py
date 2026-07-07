import tempfile
from pathlib import Path

from agentlens.storage import SQLiteStorage


def _make_storage(tmp_dir: str) -> SQLiteStorage:
    return SQLiteStorage(db_path=str(Path(tmp_dir) / "agentlens.db"))


def _sample_trace() -> dict:
    return {
        "trace_id": "session_abc",
        "platform": "claude-code",
        "agent_name": "claude-code",
        "session_id": "abc",
        "start_time": "2026-06-22T09:00:00Z",
        "end_time": "2026-06-22T09:05:00Z",
        "model": "claude-opus-4-8",
        "prompt": "hello",
        "response": "world",
        "input_tokens": 100,
        "output_tokens": 50,
        "cost_usd": 0.01,
        "tool_calls": [{"tool_use_id": "t1", "name": "Bash", "input": {}}],
        "llm_calls": [{"id": "turn-1", "is_assistant_turn": True, "child_records": [{}]}],
        "status": "success",
        "project_path": "/demo/project",
        "metadata": {
            "llm_call_count": 1,
            "tool_call_count": 1,
            "tool_name_counts": {"Bash": 1},
            "subagent_logs": [{"id": "s1"}],
            "task_summary": {"tasks": [{"taskId": "1"}]},
            "vision_references": [{"path": "pasted:imagePasteId=1"}],
        },
    }


def test_list_sessions_light_omits_heavy_arrays():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        storage.save_trace(_sample_trace())

        payload = storage.list_sessions(limit=10, light=True)
        session = payload["sessions"][0]

        assert session["tool_calls"] == []
        assert session["llm_calls"] == []
        assert session["metadata"]["llm_call_count"] == 1
        assert session["metadata"]["tool_call_count"] == 1
        assert session["metadata"]["subagent_count"] == 1
        assert session["metadata"]["task_count"] == 1
        assert session["metadata"]["vision_count"] == 1
        assert session["total_tokens"] == 150


def test_list_sessions_full_still_has_arrays():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        storage.save_trace(_sample_trace())

        payload = storage.list_sessions(limit=10)
        session = payload["sessions"][0]

        assert len(session["tool_calls"]) == 1
        assert len(session["llm_calls"]) == 1


def test_overview_stats_uses_metadata_counts():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        storage.save_trace(_sample_trace())

        stats = storage.get_overview_stats(period_hours=100000)

        assert stats["total_sessions"] == 1
        assert stats["total_llm_calls"] == 1
        assert stats["total_tool_calls"] == 1
        assert stats["total_tokens"] == 150
        assert stats["top_tools"] == [{"name": "Bash", "count": 1}]
