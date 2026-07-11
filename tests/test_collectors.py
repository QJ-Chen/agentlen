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
    # Real Claude Code encoding of C:\Users\real\repo (colon-free so the
    # directory name survives pathlib joins on Windows hosts too)
    project_dir = tmp_path / "C--Users-real-repo"
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


def test_child_records_carry_cache_tokens_and_derived_durations(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"user","timestamp":"2026-07-11T08:00:00Z","message":{"role":"user","content":"do a thing"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"rec-1","timestamp":"2026-07-11T08:00:01.000Z","message":{"id":"msg_cache","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"working"}],"usage":{"input_tokens":100,"output_tokens":50,"cache_read_input_tokens":40000,"cache_creation_input_tokens":2000}}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"rec-2","timestamp":"2026-07-11T08:00:03.500Z","message":{"id":"msg_cache","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":100,"output_tokens":80,"cache_read_input_tokens":40000,"cache_creation_input_tokens":2000}}}',
    )

    turn = state["aggregator"].get_traces()[0]["llm_calls"][0]

    assert turn["cache_read_tokens"] == 40000
    assert turn["cache_creation_tokens"] == 2000
    children = turn["child_records"]
    assert children[0]["cache_read_tokens"] == 40000
    assert children[0]["cache_creation_tokens"] == 2000
    assert children[0]["cost_usd"] > 0
    # first record's duration spans to the next record's timestamp
    assert children[0]["duration_ms"] == 2500
    assert children[0]["end_time"] == "2026-07-11T08:00:03.500Z"


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


def test_process_line_stores_latest_away_summary_as_recap_text(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"system","subtype":"away_summary","timestamp":"2026-07-08T00:00:00Z","content":"Goal is improving AgentLens session previews. Next, verify the session list shows recap text.","sessionId":"session-1"}',
    )
    collector.process_line(
        state,
        '{"type":"user","timestamp":"2026-07-08T00:00:01Z","message":{"role":"user","content":"continue"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a1","timestamp":"2026-07-08T00:00:02Z","message":{"id":"msg_turn_1","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":12,"output_tokens":3}}}',
    )

    trace = state["aggregator"].get_traces()[0]

    assert trace["metadata"]["recap_text"] == "Goal is improving AgentLens session previews. Next, verify the session list shows recap text."


def test_latest_away_summary_wins_when_multiple_system_recaps_exist(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"system","subtype":"away_summary","timestamp":"2026-07-08T00:00:00Z","content":"Old recap","sessionId":"session-1"}',
    )
    collector.process_line(
        state,
        '{"type":"system","subtype":"away_summary","timestamp":"2026-07-08T00:00:01Z","content":"New recap","sessionId":"session-1"}',
    )
    collector.process_line(
        state,
        '{"type":"user","timestamp":"2026-07-08T00:00:02Z","message":{"role":"user","content":"continue"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a1","timestamp":"2026-07-08T00:00:03Z","message":{"id":"msg_turn_1","role":"assistant","model":"claude-opus-4-8","content":[{"type":"text","text":"done"}],"usage":{"input_tokens":12,"output_tokens":3}}}',
    )

    trace = state["aggregator"].get_traces()[0]

    assert trace["metadata"]["recap_text"] == "New recap"


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


def test_loop_command_threads_attach_through_meta_expansion(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    command_event = (
        '{"type":"user","uuid":"7ef95e8f","promptId":"07fb4dd9-0310-4550-81c4-cc59ce091388",'
        '"timestamp":"2026-07-08T03:39:41.904Z",'
        '"message":{"role":"user","content":"<command-message>loop</command-message>'
        '\\n<command-name>/loop</command-name>'
        '\\n<command-args>1m This is just a test, do nothing</command-args>"}}'
    )
    collector.process_line(state, command_event)

    expansion_event = (
        '{"type":"user","uuid":"643c82fb","promptId":"07fb4dd9-0310-4550-81c4-cc59ce091388",'
        '"isMeta":true,'
        '"timestamp":"2026-07-08T03:39:41.904Z",'
        '"message":{"role":"user","content":[{"type":"text","text":"# /loop — schedule a recurring prompt\\nParse the input below..."}]}}'
    )
    collector.process_line(state, expansion_event)

    assistant_event = (
        '{"type":"assistant","uuid":"38864803","timestamp":"2026-07-08T03:39:53.545Z",'
        '"message":{"id":"msg_loop_1","role":"assistant","model":"claude-opus-4-8",'
        '"content":[{"type":"tool_use","id":"toolu_cron","name":"CronCreate","input":{"cron":"*/1 * * * *","prompt":"This is just a test, do nothing","recurring":true}}],'
        '"usage":{"input_tokens":100,"output_tokens":50}}}'
    )
    collector.process_line(state, assistant_event)

    final_event = (
        '{"type":"assistant","uuid":"49e4c961","timestamp":"2026-07-08T03:40:05.125Z",'
        '"message":{"id":"msg_loop_2","role":"assistant","model":"claude-opus-4-8",'
        '"content":[{"type":"text","text":"Scheduled"}],"usage":{"input_tokens":100,"output_tokens":50}}}'
    )
    collector.process_line(state, final_event)

    trace = state["aggregator"].get_traces()[0]

    assert trace["metadata"]["command_only_records"] == []
    assistant_turns = trace["llm_calls"]
    loop_turn = next(turn for turn in assistant_turns if turn["command"] is not None)
    assert loop_turn["command"]["name"] == "/loop"
    assert loop_turn["command"]["args"] == "1m This is just a test, do nothing"
    assert loop_turn["command"]["message"] == "loop"
    assert {"CronCreate"} <= {tool["name"] for tool in trace["tool_calls"]}


def test_command_only_stays_standalone_after_unrelated_user_prompt(tmp_path: Path):
    project_dir = tmp_path / "-Users-example-repo"
    project_dir.mkdir()
    log_path = project_dir / "session-1.jsonl"

    collector = ClaudeCodeCollector(DummyStorage())
    state = collector.create_incremental_state(log_path)

    collector.process_line(
        state,
        '{"type":"user","uuid":"cmd1","promptId":"prompt-cmd",'
        '"timestamp":"2026-07-08T03:00:00Z",'
        '"message":{"role":"user","content":"<command-message>recap</command-message>'
        '\\n<command-name>/recap</command-name>\\n<command-args></command-args>"}}',
    )
    collector.process_line(
        state,
        '{"type":"user","uuid":"u2","promptId":"prompt-next",'
        '"timestamp":"2026-07-08T03:00:01Z","message":{"role":"user","content":"continue"}}',
    )
    collector.process_line(
        state,
        '{"type":"assistant","uuid":"a1","promptId":"prompt-next",'
        '"timestamp":"2026-07-08T03:00:02Z",'
        '"message":{"id":"msg_next","role":"assistant","model":"claude-opus-4-8",'
        '"content":[{"type":"text","text":"continuing"}],'
        '"usage":{"input_tokens":10,"output_tokens":2}}}',
    )

    trace = state["aggregator"].get_traces()[0]

    command_only = trace["metadata"]["command_only_records"]
    assert len(command_only) == 1
    assert command_only[0]["name"] == "/recap"
    assistant_turns = trace["llm_calls"]
    assert all(turn["command"] is None for turn in assistant_turns)
