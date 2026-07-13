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


def test_time_window_matches_sessions_active_in_window():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)

        overnight = _sample_trace()
        overnight["trace_id"] = "session_overnight"
        overnight["session_id"] = "overnight"
        overnight["start_time"] = "2026-07-10T22:00:00Z"
        overnight["end_time"] = "2026-07-11T03:00:00Z"
        storage.save_trace(overnight)

        prior_day = _sample_trace()
        prior_day["trace_id"] = "session_prior"
        prior_day["session_id"] = "prior"
        prior_day["start_time"] = "2026-07-10T08:00:00Z"
        prior_day["end_time"] = "2026-07-10T09:00:00Z"
        storage.save_trace(prior_day)

        window = storage.get_traces(
            start_time="2026-07-11T00:00:00Z",
            end_time="2026-07-11T23:59:59Z",
            limit=10,
        )
        ids = {trace["session_id"] for trace in window}

        # The overnight session was active on the 11th even though it started
        # on the 10th; the fully-prior session stays excluded.
        assert ids == {"overnight"}


def test_time_window_includes_open_ended_sessions_via_start_time():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)

        running = _sample_trace()
        running["trace_id"] = "session_running"
        running["session_id"] = "running"
        running["start_time"] = "2026-07-11T10:00:00Z"
        running["end_time"] = None
        storage.save_trace(running)

        window = storage.get_traces(
            start_time="2026-07-11T00:00:00Z",
            end_time="2026-07-11T23:59:59Z",
            limit=10,
        )

        assert [trace["session_id"] for trace in window] == ["running"]


def test_running_session_started_before_window_remains_active():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        running = _sample_trace()
        running.update({
            "trace_id": "session_long_running",
            "session_id": "long-running",
            "start_time": "2026-07-10T10:00:00Z",
            "end_time": None,
            "status": "running",
        })
        completed = _sample_trace()
        completed.update({
            "trace_id": "session_legacy_open",
            "session_id": "legacy-open",
            "start_time": "2026-07-10T11:00:00Z",
            "end_time": None,
            "status": "success",
        })
        storage.save_traces([running, completed])

        window = storage.get_traces(
            start_time="2026-07-11T00:00:00Z",
            end_time="2026-07-11T23:59:59Z",
            limit=None,
        )

        assert {trace["session_id"] for trace in window} == {"long-running"}


def test_list_sessions_searches_all_trace_and_nested_content():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        first = _sample_trace()
        first.update({
            "trace_id": "search_first",
            "session_id": "search-session",
            "prompt": "first prompt",
            "response": "first response",
            "start_time": "2026-07-11T10:00:00Z",
            "end_time": "2026-07-11T10:01:00Z",
        })
        second = _sample_trace()
        second.update({
            "trace_id": "search_second",
            "session_id": "search-session",
            "prompt": "middle-only-needle",
            "response": "middle response",
            "start_time": "2026-07-11T10:02:00Z",
            "end_time": "2026-07-11T10:03:00Z",
            "tool_calls": [{"name": "Read", "output": "tool-only-needle"}],
            "llm_calls": [{"prompt": "nested-llm-needle", "response": "done"}],
        })
        third = _sample_trace()
        third.update({
            "trace_id": "search_third",
            "session_id": "search-session",
            "prompt": "last prompt",
            "response": "last response",
            "start_time": "2026-07-11T10:04:00Z",
            "end_time": "2026-07-11T10:05:00Z",
        })
        storage.save_traces([first, second, third])

        for needle in ("middle-only-needle", "tool-only-needle", "nested-llm-needle"):
            payload = storage.list_sessions(query=needle, period_hours=100000, limit=10)
            assert payload["total"] == 1
            assert payload["sessions"][0]["session_id"] == "search-session"
            assert "_search_text" not in payload["sessions"][0]


def test_session_listing_and_stats_are_not_silently_capped():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        traces = []
        for idx in range(5001):
            trace = _sample_trace()
            trace.update({
                "trace_id": f"bulk-{idx}",
                "session_id": f"bulk-{idx}",
                "start_time": f"2026-07-11T{idx % 24:02d}:{idx % 60:02d}:00Z",
                "end_time": f"2026-07-11T{idx % 24:02d}:{idx % 60:02d}:30Z",
                "project_path": f"/project/{idx % 3}",
                "prompt": "oldest-search-target" if idx == 0 else "other",
            })
            traces.append(trace)
        storage.save_traces(traces)

        payload = storage.list_sessions(query="oldest-search-target", period_hours=100000, limit=10)
        stats = storage.get_overview_stats(period_hours=100000)

        assert payload["total"] == 1
        assert payload["sessions"][0]["session_id"] == "bulk-0"
        assert stats["total_sessions"] == 5001
        assert stats["total_projects"] == 3
