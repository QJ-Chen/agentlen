from agentlens.activity import (
    ActivityGraphBuilder,
    merge_subagent_graphs,
    validate_activity_graph,
)


def _record(uuid, record_type, content, **extra):
    return {
        "uuid": uuid,
        "type": record_type,
        "message": {"role": record_type, "content": content},
        **extra,
    }


def test_parent_lineage_and_tool_result_relationships():
    builder = ActivityGraphBuilder("session-1")
    builder.add_record(_record("user-1", "user", "run it"), "session.jsonl")
    builder.add_record(
        _record(
            "assistant-1",
            "assistant",
            [{"type": "tool_use", "id": "tool-1", "name": "Bash", "input": {}}],
            parentUuid="user-1",
        ),
        "session.jsonl",
    )
    builder.add_record(
        _record(
            "result-1",
            "user",
            [{"type": "tool_result", "tool_use_id": "tool-1", "content": "ok"}],
            parentUuid="assistant-1",
            sourceToolAssistantUUID="assistant-1",
        ),
        "session.jsonl",
    )

    graph = builder.build()
    kinds = {node["id"]: node["kind"] for node in graph["nodes"]}
    relationships = {(edge["source"], edge["target"], edge["kind"]) for edge in graph["edges"]}

    assert kinds["event:result-1"] == "tool-result-record"
    assert ("event:user-1", "event:assistant-1", "parent") in relationships
    assert ("event:assistant-1", "event:result-1", "source-lineage") in relationships
    assert any(
        source == "tool-use:tool-1" and kind == "returns-result"
        for source, _, kind in relationships
    )
    assert validate_activity_graph(graph) == []


def test_string_content_and_meta_flag_are_preserved_for_projection():
    builder = ActivityGraphBuilder("session-1")
    builder.add_record(
        _record("user-1", "user", "plain prompt", isMeta=True)
    )

    event = next(node for node in builder.build()["nodes"] if node["id"] == "event:user-1")

    assert event["payload"]["content"] == "plain prompt"
    assert event["payload"]["is_meta"] is True
    assert event["payload"]["projection_version"] == 1


def test_result_before_use_is_paired_when_tool_use_arrives():
    builder = ActivityGraphBuilder("session-1")
    builder.add_record(
        _record(
            "result-1",
            "user",
            [{"type": "tool_result", "tool_use_id": "tool-1", "content": "ok"}],
        )
    )
    builder.add_record(
        _record(
            "assistant-1",
            "assistant",
            [{"type": "tool_use", "id": "tool-1", "name": "Bash", "input": {}}],
        )
    )

    graph = builder.build()
    result_node = next(node["id"] for node in graph["nodes"] if node["kind"] == "tool-result")
    assert any(
        edge["source"] == "tool-use:tool-1"
        and edge["target"] == result_node
        and edge["kind"] == "returns-result"
        for edge in graph["edges"]
    )


def test_validation_allows_parent_outside_partial_log():
    builder = ActivityGraphBuilder("session-1")
    builder.add_record(_record("child", "assistant", [], parentUuid="missing-parent"))

    assert validate_activity_graph(builder.build()) == []


def test_merge_subagent_graph_namespaces_nodes_and_links_launch_tool():
    parent = ActivityGraphBuilder("session-1")
    parent.add_record(
        _record(
            "parent-assistant",
            "assistant",
            [{"type": "tool_use", "id": "agent-tool", "name": "Agent", "input": {}}],
        )
    )
    child = ActivityGraphBuilder("session-1")
    child.add_record(_record("shared-uuid", "user", "inspect"), "agent-child.jsonl")
    child.add_record(
        _record("child-assistant", "assistant", [], parentUuid="shared-uuid"),
        "agent-child.jsonl",
    )

    graph = merge_subagent_graphs(
        parent.build(),
        [
            {
                "agent_id": "child",
                "agent_type": "Explore",
                "tool_use_id": "agent-tool",
                "session_file_path": "agent-child.jsonl",
                "activity_graph": child.build(),
            }
        ],
    )
    node_ids = {node["id"] for node in graph["nodes"]}
    relationships = {(edge["source"], edge["target"], edge["kind"]) for edge in graph["edges"]}

    assert "subagent:child" in node_ids
    assert "subagent:child:event:shared-uuid" in node_ids
    assert ("tool-use:agent-tool", "subagent:child", "spawns") in relationships
    assert (
        "subagent:child",
        "subagent:child:event:shared-uuid",
        "contains",
    ) in relationships
    assert validate_activity_graph(graph) == []
