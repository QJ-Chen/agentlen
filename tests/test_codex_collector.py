import json
from pathlib import Path

from agentlens.activity import validate_activity_graph
from agentlens.collectors import CODEX_PLATFORM, CodexCollector, CollectorManager
from agentlens.storage import SQLiteStorage


def _line(timestamp: str, record_type: str, payload: dict) -> str:
    return json.dumps({"timestamp": timestamp, "type": record_type, "payload": payload})


def test_codex_collector_normalizes_messages_tools_usage_and_compaction(tmp_path: Path):
    log_path = tmp_path / "rollout-demo.jsonl"
    collector = CodexCollector(None)
    state = collector.create_incremental_state(log_path)
    records = [
        _line(
            "2026-07-16T01:00:00Z",
            "session_meta",
            {"id": "codex-session", "cwd": "/repo", "originator": "Codex Desktop"},
        ),
        _line(
            "2026-07-16T01:00:01Z",
            "turn_context",
            {"turn_id": "turn-1", "cwd": "/repo", "model": "gpt-5"},
        ),
        _line(
            "2026-07-16T01:00:02Z",
            "response_item",
            {
                "type": "message",
                "role": "user",
                "content": [{"type": "input_text", "text": "Fix the parser"}],
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:03Z",
            "event_msg",
            {"type": "agent_reasoning", "text": "Duplicate detailed reasoning."},
        ),
        _line(
            "2026-07-16T01:00:03Z",
            "event_msg",
            {"type": "token_count", "info": {}},
        ),
        _line(
            "2026-07-16T01:00:03Z",
            "response_item",
            {
                "type": "reasoning",
                "id": "reasoning-1",
                "summary": [{"type": "summary_text", "text": "Inspect the parser first."}],
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:03Z",
            "response_item",
            {
                "type": "function_call",
                "id": "fc-1",
                "call_id": "call-1",
                "name": "exec_command",
                "arguments": '{"cmd":"pytest"}',
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:03Z",
            "response_item",
            {
                "type": "function_call",
                "id": "fc-2",
                "call_id": "call-2",
                "name": "exec_command",
                "arguments": '{"cmd":"ruff check ."}',
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:04Z",
            "response_item",
            {
                "type": "function_call_output",
                "call_id": "call-1",
                "output": "1 passed",
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:04Z",
            "response_item",
            {
                "type": "function_call_output",
                "call_id": "call-2",
                "output": "All checks passed",
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:05Z",
            "response_item",
            {
                "type": "reasoning",
                "id": "reasoning-2",
                "summary": [{"type": "summary_text", "text": "Apply the fix."}],
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:05Z",
            "response_item",
            {
                "type": "function_call",
                "id": "fc-3",
                "call_id": "call-3",
                "name": "apply_patch",
                "arguments": "*** Begin Patch",
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:05Z",
            "response_item",
            {
                "type": "function_call_output",
                "call_id": "call-3",
                "output": "Done!",
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:06Z",
            "response_item",
            {
                "type": "message",
                "id": "answer-1",
                "role": "assistant",
                "content": [{"type": "output_text", "text": "Fixed."}],
                "internal_chat_message_metadata_passthrough": {"turn_id": "turn-1"},
            },
        ),
        _line(
            "2026-07-16T01:00:07Z",
            "event_msg",
            {
                "type": "token_count",
                "info": {
                    "total_token_usage": {
                        "input_tokens": 100,
                        "cached_input_tokens": 20,
                        "output_tokens": 30,
                    }
                },
            },
        ),
        _line(
            "2026-07-16T01:00:08Z",
            "compacted",
            {
                "window_number": 2,
                "message": "The parser was fixed and verified.",
                "replacement_history": [{"large": "duplicated conversation"}],
            },
        ),
    ]
    for record in records:
        collector.process_line(state, record)

    trace = collector.finalize_state(state)[0]
    assert trace["platform"] == CODEX_PLATFORM
    assert trace["session_id"] == "codex-session"
    assert trace["prompt"] == "Fix the parser"
    assert trace["response"] == "Fixed."
    assert trace["input_tokens"] == 100
    assert trace["cache_read_tokens"] == 20
    assert trace["metadata"]["tool_name_counts"] == {"exec_command": 2, "apply_patch": 1}
    assert trace["metadata"]["recap_text"] == "The parser was fixed and verified."
    assert validate_activity_graph(trace["activity_graph"]) == []
    compacted = next(
        node for node in trace["activity_graph"]["nodes"] if node["kind"] == "context-compacted"
    )
    assert "replacement_history" not in compacted["payload"]

    storage = SQLiteStorage(str(tmp_path / "agentlens.db"))
    storage.save_trace(trace)
    session = storage.get_session("codex-session")
    assert session is not None
    assert session["platform"] == CODEX_PLATFORM
    assert [tool["name"] for tool in session["tool_calls"]] == [
        "exec_command",
        "exec_command",
        "apply_patch",
    ]
    assert [tool["output"] for tool in session["tool_calls"]] == [
        "1 passed",
        "All checks passed",
        "Done!",
    ]
    assert session["metadata"]["recap_text"] == "The parser was fixed and verified."
    child_records = [
        child
        for turn in session["llm_calls"]
        for child in turn.get("child_records", [])
    ]
    assert len(session["llm_calls"]) == 3
    assert {turn["prompt_id"] for turn in session["llm_calls"]} == {"turn-1"}
    assert [turn["child_record_count"] for turn in session["llm_calls"]] == [3, 2, 1]
    assert session["llm_calls"][0]["message_id"] == "codex-phase:turn-1:1"
    assert session["llm_calls"][1]["message_id"] == "codex-phase:turn-1:2"
    assert session["llm_calls"][2]["message_id"] == "codex-phase:turn-1:3"
    assert [
        child["id"] for child in session["llm_calls"][0]["child_records"]
    ] == ["reasoning-1", "fc-1", "fc-2"]
    assert [
        child["id"] for child in session["llm_calls"][1]["child_records"]
    ] == ["reasoning-2", "fc-3"]
    thinking = [
        call for call in child_records if (call.get("response") or "").startswith("[thinking]")
    ]
    assert [call["response"] for call in thinking] == [
        "[thinking] Inspect the parser first.",
        "[thinking] Apply the fix.",
    ]


def test_codex_agent_reasoning_is_used_when_response_item_summary_is_absent(tmp_path: Path):
    collector = CodexCollector(None)
    state = collector.create_incremental_state(tmp_path / "rollout-fallback.jsonl")
    collector.process_line(
        state,
        _line("2026-07-16T01:00:00Z", "turn_context", {"turn_id": "turn-1", "model": "gpt-5"}),
    )
    collector.process_line(
        state,
        _line(
            "2026-07-16T01:00:01Z",
            "event_msg",
            {"type": "agent_reasoning", "text": "Use the fallback reasoning."},
        ),
    )

    trace = collector.finalize_state(state)[0]
    storage = SQLiteStorage(str(tmp_path / "fallback.db"))
    storage.save_trace(trace)
    session = storage.get_session(trace["session_id"])

    assert session is not None
    assert [
        child["response"]
        for turn in session["llm_calls"]
        for child in turn.get("child_records", [])
    ] == [
        "[thinking] Use the fallback reasoning."
    ]


def test_collector_manager_registers_claude_and_codex():
    assert [collector.get_name() for collector in CollectorManager(None).collectors] == [
        "claude-code",
        "codex",
    ]
