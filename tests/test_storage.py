import tempfile
import json
import sqlite3
from pathlib import Path

from agentlens.collectors import ClaudeCodeCollector
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


def _activity_graph() -> dict:
    return {
        "version": 1,
        "session_id": "abc",
        "nodes": [
            {"id": "event:a", "kind": "user-message", "sequence": 0, "payload": {}},
            {
                "id": "content:a:0",
                "kind": "content-text",
                "sequence": 0,
                "payload": {"text": "a"},
            },
            {
                "id": "event:b",
                "kind": "assistant-message",
                "sequence": 1,
                "payload": {},
            },
            {
                "id": "tool-use:t1",
                "kind": "tool-use",
                "sequence": 1,
                "payload": {},
            },
        ],
        "edges": [
            {
                "id": "contains:event:a:content:a:0",
                "source": "event:a",
                "target": "content:a:0",
                "kind": "contains",
            },
            {
                "id": "parent:event:a:event:b",
                "source": "event:a",
                "target": "event:b",
                "kind": "parent",
            },
            {
                "id": "invokes:event:b:tool-use:t1",
                "source": "event:b",
                "target": "tool-use:t1",
                "kind": "invokes-tool",
            },
        ],
    }


def test_activity_persistence_pages_shared_sequences_without_skipping():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        trace = _sample_trace()
        trace["activity_graph"] = _activity_graph()
        storage.save_trace(trace)

        first = storage.get_activity_nodes("abc", limit=1)
        sequence_text, node_id = first["next_cursor"].partition(":")[::2]
        second = storage.get_activity_nodes(
            "abc", after_sequence=int(sequence_text), after_node_id=node_id, limit=3
        )

        assert first["nodes"][0]["id"] == "content:a:0"
        assert [node["id"] for node in second["nodes"]] == [
            "event:a",
            "event:b",
            "tool-use:t1",
        ]
        detail = storage.get_activity_node("abc", "event:a")
        assert detail is not None
        assert detail["outbound_edges"][0]["target"] == "content:a:0"


def test_activity_neighborhood_respects_depth_direction_and_limits():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        trace = _sample_trace()
        trace["activity_graph"] = _activity_graph()
        storage.save_trace(trace)

        outbound = storage.get_activity_neighborhood(
            "abc", "event:a", depth=2, direction="outbound"
        )
        assert outbound is not None
        assert {node["id"] for node in outbound["nodes"]} == {
            "event:a",
            "content:a:0",
            "event:b",
            "tool-use:t1",
        }
        assert outbound["depth_reached"] == 2
        assert not outbound["truncated"]

        inbound = storage.get_activity_neighborhood(
            "abc", "tool-use:t1", depth=2, direction="inbound"
        )
        assert inbound is not None
        assert {node["id"] for node in inbound["nodes"]} == {
            "event:a",
            "event:b",
            "tool-use:t1",
        }

        limited = storage.get_activity_neighborhood(
            "abc", "event:a", depth=2, direction="outbound", node_limit=2
        )
        assert limited is not None
        assert len(limited["nodes"]) == 2
        assert limited["truncated"]


def test_activity_neighborhood_returns_none_for_missing_center():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        storage.save_trace(_sample_trace())

        assert storage.get_activity_neighborhood("abc", "missing") is None


def test_activity_resave_replaces_graph_but_absent_graph_preserves_it():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        trace = _sample_trace()
        trace["activity_graph"] = _activity_graph()
        storage.save_trace(trace)

        replacement = _activity_graph()
        replacement["nodes"] = replacement["nodes"][:1]
        replacement["edges"] = []
        trace["activity_graph"] = replacement
        storage.save_trace(trace)
        assert [node["id"] for node in storage.get_activity_nodes("abc")["nodes"]] == ["event:a"]

        trace.pop("activity_graph")
        storage.save_trace(trace)
        assert storage.has_activity("abc")


def test_activity_resave_does_not_rewrite_unchanged_graph():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        trace = _sample_trace()
        trace["activity_graph"] = _activity_graph()
        storage.save_trace(trace)

        with sqlite3.connect(storage.db_path) as conn:
            conn.executescript(
                """
                CREATE TEMP TABLE writes(kind TEXT);
                CREATE TEMP TRIGGER node_update AFTER UPDATE ON activity_nodes
                BEGIN INSERT INTO writes VALUES ('node-update'); END;
                CREATE TEMP TRIGGER node_delete AFTER DELETE ON activity_nodes
                BEGIN INSERT INTO writes VALUES ('node-delete'); END;
                CREATE TEMP TRIGGER edge_update AFTER UPDATE ON activity_edges
                BEGIN INSERT INTO writes VALUES ('edge-update'); END;
                CREATE TEMP TRIGGER edge_delete AFTER DELETE ON activity_edges
                BEGIN INSERT INTO writes VALUES ('edge-delete'); END;
                """
            )
            storage._replace_activity_graph(conn, trace)
            assert conn.execute("SELECT COUNT(*) FROM writes").fetchone()[0] == 0


def test_session_detail_projects_compatibility_arrays_from_activity():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        log_path = project_dir / "projection.jsonl"
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(log_path)
        records = [
            {
                "type": "user",
                "uuid": "u1",
                "promptId": "p1",
                "timestamp": "2026-07-15T01:00:00Z",
                "message": {"role": "user", "content": "inspect this"},
            },
            {
                "type": "assistant",
                "uuid": "a1",
                "promptId": "p1",
                "timestamp": "2026-07-15T01:00:01Z",
                "message": {
                    "id": "m1",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "content": [{"type": "text", "text": "checking"}],
                    "usage": {"input_tokens": 10, "output_tokens": 2},
                },
            },
            {
                "type": "assistant",
                "uuid": "a2",
                "promptId": "p1",
                "timestamp": "2026-07-15T01:00:02Z",
                "message": {
                    "id": "m1",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "content": [
                        {
                            "type": "tool_use",
                            "id": "t1",
                            "name": "Read",
                            "input": {"file_path": "README.md"},
                        }
                    ],
                    "usage": {"input_tokens": 12, "output_tokens": 3},
                },
            },
            {
                "type": "user",
                "uuid": "r1",
                "timestamp": "2026-07-15T01:00:03Z",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "t1", "content": "contents"}
                    ],
                },
            },
        ]
        for record in records:
            collector.process_line(state, json.dumps(record))

        legacy = state["aggregator"].get_traces()[0]
        trace = collector.finalize_state(state)[0]
        storage = _make_storage(tmp_dir)
        storage.save_trace(trace)
        with sqlite3.connect(storage.db_path) as conn:
            stored_tool_calls, stored_llm_calls = conn.execute(
                "SELECT tool_calls, llm_calls FROM traces WHERE session_id = ?",
                ("projection",),
            ).fetchone()
        assert stored_tool_calls == "[]"
        assert stored_llm_calls == "[]"
        session = storage.get_session("projection")

        assert session is not None
        assert session["metadata"]["detail_source"] == "activity-v1"
        assert len(session["llm_calls"]) == 1
        projected_turn = session["llm_calls"][0]
        legacy_turn = legacy["llm_calls"][0]
        assert projected_turn["id"] == legacy_turn["id"] == "m1"
        assert projected_turn["prompt"] == legacy_turn["prompt"] == "inspect this"
        assert projected_turn["child_record_count"] == 2
        assert projected_turn["input_tokens"] == legacy_turn["input_tokens"] == 12
        assert projected_turn["child_records"][0]["response"] == "checking"
        assert session["tool_calls"] == [
            {
                "tool_use_id": "t1",
                "name": "Read",
                "input": {"file_path": "README.md"},
                "timestamp": "2026-07-15T01:00:02Z",
                "assistant_turn_id": "m1",
                "assistant_message_id": "m1",
                "assistant_record_id": "a2",
                "output": "contents",
            }
        ]


def test_session_summary_omits_heavy_call_histories_and_marks_detail_level():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        trace = _sample_trace()
        trace["metadata"]["subagent_logs"] = [
            {
                "agent_id": "child",
                "description": "Inspect code",
                "llm_calls": [{"id": "child-turn"}],
                "tool_calls": [{"tool_use_id": "child-tool"}],
            }
        ]
        storage.save_trace(trace)

        session = storage.get_session("abc", detail="summary")

        assert session is not None
        assert session["llm_calls"] == []
        assert session["tool_calls"] == []
        assert session["metadata"]["detail_level"] == "summary"
        assert session["metadata"]["has_full_detail"] is True
        assert session["metadata"]["subagent_logs"] == [
            {"agent_id": "child", "description": "Inspect code"}
        ]


def test_canonical_session_projects_subagent_detail_from_activity():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        log_path = project_dir / "parent.jsonl"
        log_path.write_text(
            '{"type":"user","uuid":"parent-u","message":{"role":"user",'
            '"content":"delegate"}}\n'
            '{"type":"assistant","uuid":"parent-a","message":{"id":"parent-m",'
            '"role":"assistant","model":"claude-opus-4-8","content":['
            '{"type":"tool_use","id":"agent-tool","name":"Agent","input":{}}]}}\n',
            encoding="utf-8",
        )
        subagent_dir = project_dir / "parent" / "subagents"
        subagent_dir.mkdir(parents=True)
        (subagent_dir / "agent-child.jsonl").write_text(
            '{"type":"user","uuid":"child-u","message":{"role":"user",'
            '"content":"inspect"}}\n'
            '{"type":"assistant","uuid":"child-a","message":{"id":"child-m",'
            '"role":"assistant","model":"claude-opus-4-8","content":['
            '{"type":"tool_use","id":"read-tool","name":"Read",'
            '"input":{"file_path":"README.md"}}],'
            '"usage":{"input_tokens":5,"output_tokens":2}}}\n'
            '{"type":"user","uuid":"child-r","message":{"role":"user","content":['
            '{"type":"tool_result","tool_use_id":"read-tool","content":"contents"}]}}\n',
            encoding="utf-8",
        )
        (subagent_dir / "agent-child.meta.json").write_text(
            '{"agentType":"Explore","description":"Inspect code",'
            '"toolUseId":"agent-tool","spawnDepth":1}',
            encoding="utf-8",
        )

        collector = ClaudeCodeCollector(None)
        trace = collector.parse_session_file(log_path)[0]
        storage = _make_storage(tmp_dir)
        storage.save_trace(trace)

        with sqlite3.connect(storage.db_path) as conn:
            stored_metadata = json.loads(
                conn.execute(
                    "SELECT metadata FROM traces WHERE session_id = ?", ("parent",)
                ).fetchone()[0]
            )
        assert "llm_calls" not in stored_metadata["subagent_logs"][0]
        assert "tool_calls" not in stored_metadata["subagent_logs"][0]

        session = storage.get_session("parent")
        subagent = session["metadata"]["subagent_logs"][0]
        assert subagent["llm_calls"][0]["id"] == "child-m"
        assert subagent["tool_calls"][0]["name"] == "Read"
        assert subagent["tool_calls"][0]["output"] == "contents"


def test_session_detail_excludes_namespaced_subagent_activity():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        trace = _sample_trace()
        graph = _activity_graph()
        graph["nodes"].append(
            {
                "id": "subagent:child:event:a1",
                "kind": "assistant-message",
                "sequence": 5,
                "message_id": "child-message",
                "payload": {"role": "assistant", "model": "claude-opus-4-8"},
            }
        )
        trace["activity_graph"] = graph
        storage.save_trace(trace)

        session = storage.get_session("abc")

        assert session is not None
        assert all(turn.get("message_id") != "child-message" for turn in session["llm_calls"])


def test_activity_projection_tool_result_does_not_split_assistant_turn():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        log_path = project_dir / "projection.jsonl"
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(log_path)
        records = [
            {
                "type": "assistant",
                "uuid": "a1",
                "timestamp": "2026-07-15T01:00:01Z",
                "message": {
                    "id": "m1",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "content": [
                        {"type": "tool_use", "id": "t1", "name": "Read", "input": {}}
                    ],
                    "usage": {},
                },
            },
            {
                "type": "user",
                "uuid": "r1",
                "timestamp": "2026-07-15T01:00:02Z",
                "message": {
                    "role": "user",
                    "content": [
                        {"type": "tool_result", "tool_use_id": "t1", "content": "ok"}
                    ],
                },
            },
            {
                "type": "assistant",
                "uuid": "a2",
                "timestamp": "2026-07-15T01:00:03Z",
                "message": {
                    "id": "m1",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "content": [{"type": "text", "text": "done"}],
                    "usage": {},
                },
            },
        ]
        for record in records:
            collector.process_line(state, json.dumps(record))

        legacy = state["aggregator"].get_traces()[0]
        trace = collector.finalize_state(state)[0]
        storage = _make_storage(tmp_dir)
        storage.save_trace(trace)
        session = storage.get_session("projection")

        assert session is not None
        assert len(legacy["llm_calls"]) == len(session["llm_calls"]) == 1
        assert session["llm_calls"][0]["child_record_count"] == 2
        assert session["tool_calls"][0]["output"] == "ok"


def test_activity_projection_attaches_skill_context_without_replacing_prompt():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(project_dir / "skill.jsonl")
        records = [
            {"type": "user", "uuid": "u1", "promptId": "p1", "timestamp": "2026-07-16T00:00:00Z",
             "message": {"role": "user", "content": "Original request"}},
            {"type": "assistant", "uuid": "a1", "promptId": "p1", "timestamp": "2026-07-16T00:00:01Z",
             "message": {"id": "m1", "role": "assistant", "model": "claude-opus-4-8", "usage": {},
                         "content": [{"type": "tool_use", "id": "skill-1", "name": "Skill",
                                      "input": {"skill": "review"}}]}},
            {"type": "user", "uuid": "r1", "promptId": "p1", "timestamp": "2026-07-16T00:00:02Z",
             "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "skill-1",
                                                          "content": "Launching skill: review"}]}},
            {"type": "user", "uuid": "s1", "promptId": "p1", "isMeta": True,
             "sourceToolUseID": "skill-1", "timestamp": "2026-07-16T00:00:03Z",
             "message": {"role": "user", "content": [{"type": "text",
                                                          "text": "Base directory for this skill: /skills/review\nRules"}]}},
            {"type": "assistant", "uuid": "a2", "promptId": "p1", "timestamp": "2026-07-16T00:00:04Z",
             "message": {"id": "m2", "role": "assistant", "model": "claude-opus-4-8", "usage": {},
                         "content": [{"type": "text", "text": "done"}]}},
        ]
        for record in records:
            collector.process_line(state, json.dumps(record))
        trace = collector.finalize_state(state)[0]
        storage = _make_storage(tmp_dir)
        storage.save_trace(trace)

        projection = storage.get_activity_session_projection("skill", llm_limit=None)
        assert projection is not None
        assert {turn["prompt"] for turn in projection["llm_calls"]} == {"Original request"}
        skill = next(tool for tool in projection["tool_calls"] if tool.get("name") == "Skill")
        assert skill["output"] == "Launching skill: review"
        assert skill["skill_content"].startswith("Base directory for this skill: /skills/review")


def test_activity_projection_ignores_skill_reinvocation_marker_before_api_error():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(project_dir / "skill-error.jsonl")
        records = [
            {"type": "user", "uuid": "u1", "promptId": "p1",
             "message": {"role": "user", "content": "Original request"}},
            {"type": "assistant", "uuid": "a1", "promptId": "p1",
             "message": {"id": "m1", "role": "assistant", "model": "claude-opus-4-8",
                         "usage": {}, "content": [{"type": "tool_use", "id": "skill-1",
                         "name": "Skill", "input": {"skill": "claude-api"}}]}},
            {"type": "user", "uuid": "r1", "promptId": "p1",
             "message": {"role": "user", "content": [{"type": "tool_result",
                         "tool_use_id": "skill-1", "content": "Launching skill: claude-api"}]}},
            {"type": "user", "uuid": "marker", "promptId": "p1", "isMeta": True,
             "sourceToolUseID": "skill-1", "message": {"role": "user", "content": (
                 "(Re-invocation of /claude-api — the skill instructions were previously loaded; "
                 "the arguments or dynamic output below are new.)"
             )}},
            {"type": "user", "uuid": "instructions", "promptId": "p1", "isMeta": True,
             "sourceToolUseID": "skill-1", "message": {"role": "user", "content": [{
                 "type": "text", "text": "Base directory for this skill: /skills/claude-api\nRules"
             }]}},
            {"type": "assistant", "uuid": "error", "promptId": "p1",
             "message": {"id": "m2", "role": "assistant", "model": "claude-opus-4-8",
                         "usage": {}, "content": [{"type": "text",
                         "text": "API Error: 500 invalid request"}]}},
        ]
        for record in records:
            collector.process_line(state, json.dumps(record))
        storage = _make_storage(tmp_dir)
        storage.save_trace(collector.finalize_state(state)[0])

        projection = storage.get_activity_session_projection("skill-error", llm_limit=None)
        assert projection is not None
        error = next(turn for turn in projection["llm_calls"] if turn["id"] == "m2")
        assert error["prompt"] == "Original request"
        skill = next(tool for tool in projection["tool_calls"] if tool.get("name") == "Skill")
        assert skill["skill_content"].startswith("Base directory for this skill:")


def test_activity_projection_links_attributed_work_to_skill_launch():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(project_dir / "attributed-skill.jsonl")
        records = [
            {"type": "assistant", "uuid": "launch", "timestamp": "2026-07-16T00:00:00Z",
             "message": {"id": "launch-message", "role": "assistant", "model": "claude-opus-4-8",
                         "usage": {}, "content": [{"type": "tool_use", "id": "skill-1",
                         "name": "Skill", "input": {"skill": "code-review"}}]}},
            {"type": "user", "uuid": "context", "isMeta": True,
             "sourceToolUseID": "skill-1", "timestamp": "2026-07-16T00:00:01Z",
             "message": {"role": "user", "content": [{"type": "text",
                         "text": "`high effort`\nReview instructions"}]}},
            {"type": "assistant", "uuid": "work", "timestamp": "2026-07-16T00:00:02Z",
             "attributionSkill": "code-review",
             "message": {"id": "work-message", "role": "assistant", "model": "claude-opus-4-8",
                         "usage": {}, "content": [{"type": "text", "text": "done"}]}},
        ]
        for record in records:
            collector.process_line(state, json.dumps(record))
        storage = _make_storage(tmp_dir)
        storage.save_trace(collector.finalize_state(state)[0])

        projection = storage.get_activity_session_projection("attributed-skill", llm_limit=None)
        assert projection is not None
        skill = next(tool for tool in projection["tool_calls"] if tool.get("name") == "Skill")
        assert skill["skill_content"].startswith("`high effort`")
        turn = next(item for item in projection["llm_calls"] if item["id"] == "work-message")
        assert turn["attribution_skill"] == "code-review"
        assert turn["attribution_tool_use_id"] == "skill-1"
        assert turn["child_records"][0]["attribution_skill"] == "code-review"
        assert turn["child_records"][0]["attribution_tool_use_id"] == "skill-1"


def test_activity_projection_keeps_slash_skill_context_out_of_prompt():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(project_dir / "slash-skill.jsonl")
        records = [
            {
                "type": "user", "uuid": "command", "promptId": "p1",
                "timestamp": "2026-07-16T00:00:00Z",
                "message": {"role": "user", "content": (
                    "<command-message>review</command-message>"
                    "<command-name>/review</command-name>"
                    "<command-args>src</command-args>"
                )},
            },
            {
                "type": "user", "uuid": "context", "promptId": "p1", "isMeta": True,
                "timestamp": "2026-07-16T00:00:01Z",
                "message": {"role": "user", "content": [{"type": "text", "text": (
                    "Base directory for this skill: /skills/review\nRules"
                )}]},
            },
            {
                "type": "assistant", "uuid": "answer", "promptId": "p1",
                "timestamp": "2026-07-16T00:00:02Z",
                "message": {"id": "m1", "role": "assistant", "model": "claude-opus-4-8",
                            "usage": {}, "content": [{"type": "text", "text": "done"}]},
            },
        ]
        for record in records:
            collector.process_line(state, json.dumps(record))
        storage = _make_storage(tmp_dir)
        storage.save_trace(collector.finalize_state(state)[0])

        projection = storage.get_activity_session_projection("slash-skill", llm_limit=None)
        assert projection is not None
        assert len(projection["llm_calls"]) == 1
        assert projection["llm_calls"][0]["prompt"] is None
        assert projection["llm_calls"][0]["command"] == {
            "name": "/review", "args": "src", "message": "review"
        }


def test_activity_projection_ignored_event_keeps_turn_and_deduplicates_response():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(project_dir / "projection.jsonl")
        for record in [
            {
                "type": "assistant",
                "uuid": "a1",
                "timestamp": "2026-07-15T01:00:01Z",
                "message": {
                    "id": "m1",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "content": [{"type": "text", "text": "same"}],
                    "usage": {},
                },
            },
            {
                "type": "system",
                "subtype": "progress",
                "uuid": "s1",
                "timestamp": "2026-07-15T01:00:02Z",
            },
            {
                "type": "assistant",
                "uuid": "a2",
                "timestamp": "2026-07-15T01:00:03Z",
                "message": {
                    "id": "m1",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "content": [{"type": "text", "text": "same"}],
                    "usage": {},
                },
            },
        ]:
            collector.process_line(state, json.dumps(record))

        trace = collector.finalize_state(state)[0]
        storage = _make_storage(tmp_dir)
        storage.save_trace(trace)
        session = storage.get_session("projection")

        assert session is not None
        assert len(session["llm_calls"]) == 1
        assert session["llm_calls"][0]["child_record_count"] == 2
        assert session["llm_calls"][0]["response"] == "same"


def test_activity_projection_normal_prompt_clears_unrelated_pending_command():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(project_dir / "projection.jsonl")
        records = [
            {
                "type": "user",
                "uuid": "command",
                "promptId": "command-prompt",
                "message": {
                    "role": "user",
                    "content": (
                        "<command-name>/compact</command-name>"
                        "<command-message>compact</command-message>"
                        "<command-args></command-args>"
                    ),
                },
            },
            {
                "type": "user",
                "uuid": "normal",
                "promptId": "normal-prompt",
                "message": {"role": "user", "content": "continue normally"},
            },
            {
                "type": "assistant",
                "uuid": "answer",
                "promptId": "normal-prompt",
                "message": {
                    "id": "turn",
                    "role": "assistant",
                    "model": "claude-opus-4-8",
                    "content": [{"type": "text", "text": "continued"}],
                    "usage": {},
                },
            },
        ]
        for record in records:
            collector.process_line(state, json.dumps(record))

        trace = collector.finalize_state(state)[0]
        storage = _make_storage(tmp_dir)
        storage.save_trace(trace)
        session = storage.get_session("projection")

        assert session is not None
        assert session["llm_calls"][0]["prompt"] == "continue normally"
        assert session["llm_calls"][0]["command"] is None


def test_activity_projection_matches_legacy_500_turn_retention_window():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(project_dir / "projection.jsonl")
        for index in range(501):
            collector.process_line(
                state,
                json.dumps(
                    {
                        "type": "assistant",
                        "uuid": f"a-{index}",
                        "message": {
                            "id": f"m-{index}",
                            "role": "assistant",
                            "model": "claude-opus-4-8",
                            "content": [{"type": "text", "text": str(index)}],
                            "usage": {},
                        },
                    }
                ),
            )

        trace = collector.finalize_state(state)[0]
        storage = _make_storage(tmp_dir)
        storage.save_trace(trace)
        session = storage.get_session("projection")

        assert session is not None
        assert len(session["llm_calls"]) == 500
        assert session["llm_calls"][0]["id"] == "m-1"
        assert session["llm_calls"][-1]["id"] == "m-500"


def test_session_conversation_pages_backward_without_overlap():
    with tempfile.TemporaryDirectory() as tmp_dir:
        project_dir = Path(tmp_dir) / "-Users-example-repo"
        project_dir.mkdir()
        collector = ClaudeCodeCollector(None)
        state = collector.create_incremental_state(project_dir / "projection.jsonl")
        for index in range(5):
            collector.process_line(
                state,
                json.dumps(
                    {
                        "type": "assistant",
                        "uuid": f"a-{index}",
                        "message": {
                            "id": f"m-{index}",
                            "role": "assistant",
                            "model": "claude-opus-4-8",
                            "content": [{"type": "text", "text": str(index)}],
                            "usage": {},
                        },
                    }
                ),
            )

        storage = _make_storage(tmp_dir)
        storage.save_trace(collector.finalize_state(state)[0])
        newest = storage.get_session_conversation("projection", limit=2)
        older = storage.get_session_conversation(
            "projection", limit=2, before=int(newest["next_cursor"])
        )

        assert [call["id"] for call in newest["llm_calls"]] == ["m-3", "m-4"]
        assert [call["id"] for call in older["llm_calls"]] == ["m-1", "m-2"]
        assert older["next_cursor"] == "1"
        assert newest["total_llm_calls"] == 5


def test_session_detail_falls_back_when_activity_payload_is_malformed():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        trace = _sample_trace()
        graph = _activity_graph()
        graph["nodes"][0]["payload"] = []
        trace["activity_graph"] = graph
        storage.save_trace(trace)

        session = storage.get_session("abc")

        assert session is not None
        assert session["llm_calls"] == trace["llm_calls"]
        assert "detail_source" not in session["metadata"]


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


def test_list_sessions_light_does_not_use_full_trace_decoder():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        storage.save_trace(_sample_trace())

        def fail_if_called(**_kwargs):
            raise AssertionError("light session listing decoded full traces")

        storage.get_traces = fail_if_called
        payload = storage.list_sessions(limit=10, light=True)

        assert payload["total"] == 1
        assert payload["sessions"][0]["metadata"]["recap_text"] is None


def test_list_sessions_light_preserves_deep_json_search():
    with tempfile.TemporaryDirectory() as tmp_dir:
        storage = _make_storage(tmp_dir)
        trace = _sample_trace()
        trace["tool_calls"][0]["input"] = {"command": "unique-deep-search-value"}
        storage.save_trace(trace)

        payload = storage.list_sessions(
            query="unique-deep-search-value", period_hours=100000, limit=10, light=True
        )

        assert payload["total"] == 1
        assert payload["sessions"][0]["session_id"] == "abc"


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
