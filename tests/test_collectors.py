from pathlib import Path

from agentlens import collectors
from agentlens.collectors import ClaudeCodeCollector, extract_vision_references


class DummyStorage:
    def save_traces(self, traces):
        self.traces = traces


def test_extract_vision_references_supports_pasted_images_and_top_level_attachments(tmp_path: Path):
    cache_root = tmp_path / ".claude" / "image_cache"
    session_dir = cache_root / "session-1"
    session_dir.mkdir(parents=True)
    cached_image = session_dir / "3.png"
    cached_image.write_bytes(b"png")

    original_dirs = collectors.CLAUDE_IMAGE_CACHE_DIRS
    collectors.CLAUDE_IMAGE_CACHE_DIRS = [cache_root]
    try:
        content = [
            {
                "type": "text",
                "text": "Look through the UI [Image #3]",
            },
            {
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": "image/png",
                    "uuid": "caa4f722-300f-4234-91b9-72e6a9b81e47",
                    "imagePasteIds": [3],
                },
            },
            {
                "attachment": {
                    "type": "file",
                    "filename": "/Users/findai/workspace/tools/agentlens/agentlens-ui-review.png",
                    "content": {
                        "type": "image",
                        "file": {
                            "type": "image/png",
                        },
                    },
                    "displayPath": "../agentlens-ui-review.png",
                },
            },
        ]

        references = extract_vision_references(content, "session-1", {
            "type": "attachment",
            "attachment": {
                "type": "file",
                "filename": "/Users/findai/workspace/tools/agentlens/agentlens-ui-review.png",
                "content": {
                    "type": "image",
                    "file": {
                        "type": "image/png",
                    },
                },
                "displayPath": "../agentlens-ui-review.png",
            },
            "imagePasteIds": [3],
            "uuid": "caa4f722-300f-4234-91b9-72e6a9b81e47",
            "sessionId": "session-1",
        })
    finally:
        collectors.CLAUDE_IMAGE_CACHE_DIRS = original_dirs

    assert references == [
        {
            "path": str(cached_image),
            "origin": "pasted",
            "source_uuid": "caa4f722-300f-4234-91b9-72e6a9b81e47",
            "mime_type": "image/png",
            "image_paste_ids": [3],
            "pasted_id": 3,
            "cache_path": str(cached_image),
        },
        {
            "path": "../agentlens-ui-review.png",
            "absolute_path": "/Users/findai/workspace/tools/agentlens/agentlens-ui-review.png",
            "origin": "attached",
            "mime_type": "image/png",
        },
    ]


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


def test_process_line_preserves_structured_command_on_assistant_turn(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"user","uuid":"cmd1","promptId":"prompt-cmd-1","timestamp":"2026-07-08T00:00:00Z","message":{"role":"user","content":"<command-name>/recap</command-name>\\n<command-message>recap</command-message>\\n<command-args></command-args>"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a1","promptId":"prompt-cmd-1","timestamp":"2026-07-08T00:00:01Z","message":{"id":"msg_turn_1","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":10,"output_tokens":2}}}',
    )

    trace = state["aggregator"].get_traces()[0]
    turn = trace["llm_calls"][0]

    assert turn["command"] == {
        "name": "/recap",
        "args": "",
        "message": "recap",
    }
    assert turn["child_records"][0]["command"] == {
        "name": "/recap",
        "args": "",
        "message": "recap",
    }


def test_command_only_entry_preserves_record_when_assistant_turn_prompt_id_differs(tmp_path: Path):
    """Command-only events that don't match a later assistant turn by promptId
    should still be visible as a standalone command record (modeled as a
    separate sibling on the prompt thread that follows)."""
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    # /compact command-only
    collector.process_line(
        state,
        '{"type":"user","uuid":"cmd1","promptId":"prompt-compact","timestamp":"2026-07-08T00:00:00Z","message":{"role":"user","content":"<command-name>/compact</command-name>\\n<command-message>compact</command-message>\\n<command-args></command-args>"}}',
    )
    # A normal user prompt with a different promptId follows
    collector.process_line(
        state,
        '{"type":"user","uuid":"u2","promptId":"prompt-next","timestamp":"2026-07-08T00:00:01Z","message":{"role":"user","content":"continue"}}',
    )
    # And its assistant turn
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a1","promptId":"prompt-next","timestamp":"2026-07-08T00:00:02Z","message":{"id":"msg_turn_1","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"continuing"}],"usage":{"input_tokens":12,"output_tokens":3}}}',
    )

    trace = state["aggregator"].get_traces()[0]

    # Assistant turn was not tagged with /compact (different promptId)
    assert trace["llm_calls"][0]["command"] is None
    # But the command-only record survives in metadata
    command_only = trace["metadata"]["command_only_records"]
    assert len(command_only) == 1
    assert command_only[0]["name"] == "/compact"
    assert command_only[0]["message"] == "compact"
    assert command_only[0]["prompt_id"] == "prompt-compact"
    assert command_only[0]["source_event_id"] == "cmd1"


def test_command_only_entry_removed_when_matching_assistant_turn_consumes_it(tmp_path: Path):
    """If a command-only event is followed by a same-promptId assistant turn,
    the command should attach to the turn AND not also appear as a
    standalone command-only record."""
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"user","uuid":"cmd1","promptId":"prompt-compact","timestamp":"2026-07-08T00:00:00Z","message":{"role":"user","content":"<command-name>/compact</command-name>\\n<command-message>compact</command-message>\\n<command-args></command-args>"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a1","promptId":"prompt-compact","timestamp":"2026-07-08T00:00:01Z","message":{"id":"msg_turn_1","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"compacted"}],"usage":{"input_tokens":10,"output_tokens":2}}}',
    )

    trace = state["aggregator"].get_traces()[0]

    # Command is on the assistant turn
    assert trace["llm_calls"][0]["command"] == {
        "name": "/compact",
        "args": "",
        "message": "compact",
    }
    # And not also as a standalone record
    assert trace["metadata"]["command_only_records"] == []


def test_command_only_entry_applies_only_to_matching_next_assistant_turn(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"user","uuid":"cmd1","promptId":"prompt-compact","timestamp":"2026-07-08T00:00:00Z","message":{"role":"user","content":"<command-name>/compact</command-name>\\n<command-message>compact</command-message>\\n<command-args></command-args>"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a1","promptId":"prompt-compact","timestamp":"2026-07-08T00:00:01Z","message":{"id":"msg_turn_1","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"compacted"}],"usage":{"input_tokens":10,"output_tokens":2}}}',
    )
    collector.process_line(
        state,
        '{"type":"user","uuid":"u2","promptId":"prompt-next","timestamp":"2026-07-08T00:00:02Z","message":{"role":"user","content":"continue"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a2","promptId":"prompt-next","timestamp":"2026-07-08T00:00:03Z","message":{"id":"msg_turn_2","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"continuing"}],"usage":{"input_tokens":12,"output_tokens":3}}}',
    )

    trace = state["aggregator"].get_traces()[0]

    assert trace["llm_calls"][0]["command"] == {
        "name": "/compact",
        "args": "",
        "message": "compact",
    }
    assert trace["llm_calls"][1]["command"] is None
    assert trace["llm_calls"][1]["child_records"][0]["command"] is None


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
