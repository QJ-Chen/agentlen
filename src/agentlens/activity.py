"""Canonical activity graph construction for supported coding-agent logs.

The compatibility session projection intentionally remains in ``collectors.py``.
This module preserves identities and relationships needed for precise, lazy
inspection without requiring the dashboard to infer them from flattened calls.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


def _text(value: Any) -> Optional[str]:
    if value in (None, ""):
        return None
    return str(value)


@dataclass
class ActivityGraphBuilder:
    """Incrementally build a normalized graph from raw JSONL records."""

    session_id: str
    nodes: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    edges: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    tool_use_nodes: Dict[str, str] = field(default_factory=dict)
    pending_results: Dict[str, List[str]] = field(default_factory=dict)
    sequence: int = 0

    def add_record(self, record: Dict[str, Any], source_file: str = "") -> None:
        if not isinstance(record, dict):
            return
        sequence = self.sequence
        self.sequence += 1
        raw_uuid = _text(record.get("uuid"))
        event_id = f"event:{raw_uuid}" if raw_uuid else f"event:{sequence}"
        message = record.get("message") if isinstance(record.get("message"), dict) else {}
        record_type = _text(record.get("type")) or "unknown"
        role = _text(message.get("role"))
        kind = self._event_kind(record_type, role, message.get("content"))
        node = {
            "id": event_id,
            "session_id": self.session_id,
            "kind": kind,
            "sequence": sequence,
            "timestamp": _text(record.get("timestamp")),
            "raw_uuid": raw_uuid,
            "parent_uuid": _text(record.get("parentUuid")),
            "prompt_id": _text(
                record.get("promptId") or message.get("prompt_id") or message.get("promptId")
            ),
            "message_id": _text(message.get("id") or record.get("messageId")),
            "tool_use_id": _text(record.get("parentToolUseID") or record.get("toolUseID")),
            "source_tool_assistant_uuid": _text(record.get("sourceToolAssistantUUID")),
            "source_file": source_file,
            "payload": self._event_payload(record, message),
        }
        self.nodes[event_id] = node

        parent_uuid = node["parent_uuid"]
        if parent_uuid:
            self._add_edge(f"event:{parent_uuid}", event_id, "parent")
        source_uuid = node["source_tool_assistant_uuid"]
        if source_uuid:
            self._add_edge(f"event:{source_uuid}", event_id, "source-lineage")

        content = message.get("content")
        if isinstance(content, list):
            for index, block in enumerate(content):
                if isinstance(block, dict):
                    self._add_content_block(event_id, block, index, node)

        parent_tool_use_id = _text(record.get("parentToolUseID"))
        if parent_tool_use_id:
            tool_node = self.tool_use_nodes.get(
                parent_tool_use_id, f"tool-use:{parent_tool_use_id}"
            )
            self._add_edge(tool_node, event_id, "annotates")

    def build(self) -> Dict[str, Any]:
        return {
            "version": 1,
            "session_id": self.session_id,
            "nodes": sorted(self.nodes.values(), key=lambda item: (item["sequence"], item["id"])),
            "edges": list(self.edges.values()),
        }

    def _add_content_block(
        self,
        event_id: str,
        block: Dict[str, Any],
        index: int,
        event_node: Dict[str, Any],
    ) -> None:
        block_type = _text(block.get("type")) or "content"
        tool_use_id = _text(
            block.get("id") if block_type == "tool_use" else block.get("tool_use_id")
        )
        if block_type == "tool_use" and tool_use_id:
            node_id = f"tool-use:{tool_use_id}"
            kind = "tool-use"
        elif block_type == "tool_result":
            node_id = f"tool-result:{event_id.removeprefix('event:')}:{index}"
            kind = "tool-result"
        else:
            node_id = f"content:{event_id.removeprefix('event:')}:{index}"
            kind = f"content-{block_type}"

        self.nodes[node_id] = {
            "id": node_id,
            "session_id": self.session_id,
            "kind": kind,
            "sequence": event_node["sequence"],
            "timestamp": event_node["timestamp"],
            "raw_uuid": event_node["raw_uuid"],
            "parent_uuid": None,
            "prompt_id": event_node["prompt_id"],
            "message_id": event_node["message_id"],
            "tool_use_id": tool_use_id,
            "source_tool_assistant_uuid": event_node["source_tool_assistant_uuid"],
            "source_file": event_node["source_file"],
            "payload": {"index": index, "block": block},
        }
        self._add_edge(event_id, node_id, "contains")

        if kind == "tool-use" and tool_use_id:
            self.tool_use_nodes[tool_use_id] = node_id
            self._add_edge(event_id, node_id, "invokes-tool")
            for result_id in self.pending_results.pop(tool_use_id, []):
                self._add_edge(node_id, result_id, "returns-result")
        elif kind == "tool-result" and tool_use_id:
            tool_node = self.tool_use_nodes.get(tool_use_id)
            if tool_node:
                self._add_edge(tool_node, node_id, "returns-result")
            else:
                self.pending_results.setdefault(tool_use_id, []).append(node_id)

    def _add_edge(self, source: str, target: str, kind: str) -> None:
        edge_id = f"{kind}:{source}:{target}"
        self.edges[edge_id] = {
            "id": edge_id,
            "session_id": self.session_id,
            "source": source,
            "target": target,
            "kind": kind,
        }

    @staticmethod
    def _event_kind(record_type: str, role: Optional[str], content: Any) -> str:
        if record_type == "user" and isinstance(content, list):
            if any(
                isinstance(block, dict) and block.get("type") == "tool_result"
                for block in content
            ):
                return "tool-result-record"
        if record_type in {"user", "assistant"}:
            return f"{role or record_type}-message"
        return record_type

    @staticmethod
    def _event_payload(record: Dict[str, Any], message: Dict[str, Any]) -> Dict[str, Any]:
        # Store inspectable evidence fields, not the entire envelope. Exact raw
        # JSON remains available through the provenance endpoint.
        payload = {
            "projection_version": 1,
            "type": record.get("type"),
            "subtype": record.get("subtype"),
            "role": message.get("role"),
            "model": message.get("model"),
            "is_sidechain": record.get("isSidechain"),
            "is_meta": record.get("isMeta"),
            "source_tool_use_id": record.get("sourceToolUseID"),
            "attribution_skill": record.get("attributionSkill")
            or message.get("attributionSkill"),
            "usage": message.get("usage"),
        }
        # List content is represented by inspectable child nodes. String
        # content has no blocks, so retain it here to make the normalized
        # graph sufficient for compatibility projections and search.
        if isinstance(message.get("content"), str):
            payload["content"] = message["content"]
        return {key: value for key, value in payload.items() if value is not None}


@dataclass
class CodexActivityGraphBuilder:
    """Build canonical activities from Codex rollout response items."""

    session_id: str
    nodes: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    edges: Dict[str, Dict[str, Any]] = field(default_factory=dict)
    tool_use_nodes: Dict[str, str] = field(default_factory=dict)
    pending_results: Dict[str, List[str]] = field(default_factory=dict)
    sequence: int = 0

    def add_message(
        self,
        *,
        role: str,
        content: List[Dict[str, Any]],
        timestamp: Any,
        turn_id: Optional[str],
        source_file: str,
        model: Optional[str] = None,
        usage: Optional[Dict[str, Any]] = None,
        record_id: Optional[str] = None,
        assistant_phase_id: Optional[str] = None,
    ) -> str:
        sequence = self.sequence
        self.sequence += 1
        suffix = record_id or f"{sequence}"
        event_id = f"event:codex:{suffix}"
        # Codex turn_id identifies the user-prompt thread. Assistant response
        # items do not share an invocation ID, so the collector supplies a
        # synthetic phase ID for compatibility turn grouping. record_id stays
        # on the event as its item-level provenance identity.
        message_id = (
            _text(assistant_phase_id)
            if role == "assistant"
            else _text(record_id) or f"codex-message-{sequence}"
        )
        payload = {
            "projection_version": 1,
            "type": "codex-response-item",
            "role": role,
            "model": model,
            "usage": usage or {},
        }
        self.nodes[event_id] = {
            "id": event_id,
            "session_id": self.session_id,
            "kind": f"{role}-message",
            "sequence": sequence,
            "timestamp": _text(timestamp),
            "raw_uuid": _text(record_id),
            "parent_uuid": None,
            "prompt_id": _text(turn_id),
            "message_id": message_id,
            "tool_use_id": None,
            "source_tool_assistant_uuid": None,
            "source_file": source_file,
            "payload": {key: value for key, value in payload.items() if value is not None},
        }
        for index, block in enumerate(content):
            self._add_block(event_id, block, index)
        return event_id

    def add_event(
        self, kind: str, payload: Dict[str, Any], timestamp: Any, source_file: str
    ) -> str:
        sequence = self.sequence
        self.sequence += 1
        event_id = f"event:codex:{sequence}"
        self.nodes[event_id] = {
            "id": event_id,
            "session_id": self.session_id,
            "kind": kind,
            "sequence": sequence,
            "timestamp": _text(timestamp),
            "raw_uuid": None,
            "parent_uuid": None,
            "prompt_id": _text(payload.get("turn_id")),
            "message_id": None,
            "tool_use_id": _text(payload.get("call_id")),
            "source_tool_assistant_uuid": None,
            "source_file": source_file,
            "payload": {"projection_version": 1, "type": kind, **payload},
        }
        return event_id

    def remove_message(self, event_id: str) -> None:
        """Remove a provisional message and its content nodes."""
        contained = {
            edge["target"]
            for edge in self.edges.values()
            if edge.get("source") == event_id and edge.get("kind") == "contains"
        }
        removed = {event_id, *contained}
        for node_id in removed:
            self.nodes.pop(node_id, None)
        self.edges = {
            edge_id: edge
            for edge_id, edge in self.edges.items()
            if edge.get("source") not in removed and edge.get("target") not in removed
        }

    def _add_block(self, event_id: str, block: Dict[str, Any], index: int) -> None:
        event = self.nodes[event_id]
        block_type = str(block.get("type") or "content")
        tool_id = _text(block.get("id") if block_type == "tool_use" else block.get("tool_use_id"))
        if block_type == "tool_use" and tool_id:
            node_id, kind = f"tool-use:{tool_id}", "tool-use"
        elif block_type == "tool_result":
            node_id, kind = f"tool-result:codex:{self.sequence - 1}:{index}", "tool-result"
        else:
            node_id, kind = f"content:codex:{self.sequence - 1}:{index}", f"content-{block_type}"
        self.nodes[node_id] = {
            **event,
            "id": node_id,
            "kind": kind,
            "tool_use_id": tool_id,
            "payload": {"index": index, "block": block},
        }
        self._edge(event_id, node_id, "contains")
        if kind == "tool-use" and tool_id:
            self.tool_use_nodes[tool_id] = node_id
            self._edge(event_id, node_id, "invokes-tool")
            for result_id in self.pending_results.pop(tool_id, []):
                self._edge(node_id, result_id, "returns-result")
        elif kind == "tool-result" and tool_id:
            tool_node = self.tool_use_nodes.get(tool_id)
            if tool_node:
                self._edge(tool_node, node_id, "returns-result")
            else:
                self.pending_results.setdefault(tool_id, []).append(node_id)

    def _edge(self, source: str, target: str, kind: str) -> None:
        edge_id = f"{kind}:{source}:{target}"
        self.edges[edge_id] = {
            "id": edge_id,
            "session_id": self.session_id,
            "source": source,
            "target": target,
            "kind": kind,
        }

    def build(self) -> Dict[str, Any]:
        return {
            "version": 1,
            "session_id": self.session_id,
            "nodes": sorted(self.nodes.values(), key=lambda item: (item["sequence"], item["id"])),
            "edges": list(self.edges.values()),
        }


def validate_activity_graph(graph: Dict[str, Any]) -> List[str]:
    """Return invariant violations; an empty list means the graph is valid."""
    errors: List[str] = []
    nodes = graph.get("nodes") if isinstance(graph, dict) else None
    edges = graph.get("edges") if isinstance(graph, dict) else None
    if not isinstance(nodes, list) or not isinstance(edges, list):
        return ["graph must contain node and edge lists"]
    node_ids = [node.get("id") for node in nodes if isinstance(node, dict)]
    if len(node_ids) != len(set(node_ids)):
        errors.append("node ids must be unique")
    known = set(node_ids)
    for edge in edges:
        if not isinstance(edge, dict):
            errors.append("edges must be objects")
            continue
        # Parent/source records can be outside a partial log, but content and
        # tool relationships must always resolve inside this graph.
        if edge.get("kind") not in {"parent", "source-lineage", "annotates"}:
            if edge.get("source") not in known or edge.get("target") not in known:
                errors.append(f"unresolved {edge.get('kind')} edge: {edge.get('id')}")
    return errors


def merge_subagent_graphs(
    parent_graph: Dict[str, Any], subagents: List[Dict[str, Any]]
) -> Dict[str, Any]:
    """Append namespaced subagent graphs and link them to parent Agent tool uses."""
    merged = {
        "version": parent_graph.get("version", 1),
        "session_id": parent_graph.get("session_id"),
        "nodes": [dict(node) for node in parent_graph.get("nodes", [])],
        "edges": [dict(edge) for edge in parent_graph.get("edges", [])],
    }
    known_node_ids = {
        str(node.get("id")) for node in merged["nodes"] if isinstance(node, dict)
    }
    next_sequence = 1 + max(
        (int(node.get("sequence", 0)) for node in merged["nodes"]), default=-1
    )

    for subagent in subagents:
        graph = subagent.get("activity_graph")
        agent_id = _text(subagent.get("agent_id"))
        if not agent_id or not isinstance(graph, dict):
            continue
        child_nodes = graph.get("nodes")
        child_edges = graph.get("edges")
        if not isinstance(child_nodes, list) or not isinstance(child_edges, list):
            continue

        namespace = f"subagent:{agent_id}"
        root_id = namespace
        root_sequence = next_sequence
        root_payload = {
            key: subagent.get(key)
            for key in (
                "agent_id",
                "agent_type",
                "description",
                "tool_use_id",
                "launch_batch_id",
                "launch_prompt_id",
                "status",
                "spawn_depth",
            )
            if subagent.get(key) not in (None, "")
        }
        merged["nodes"].append(
            {
                "id": root_id,
                "session_id": merged["session_id"],
                "kind": "subagent",
                "sequence": root_sequence,
                "timestamp": subagent.get("start_time"),
                "raw_uuid": None,
                "parent_uuid": None,
                "prompt_id": subagent.get("launch_prompt_id") or None,
                "message_id": None,
                "tool_use_id": subagent.get("tool_use_id") or None,
                "source_tool_assistant_uuid": None,
                "source_file": subagent.get("session_file_path") or "",
                "payload": root_payload,
            }
        )
        known_node_ids.add(root_id)

        tool_use_id = _text(subagent.get("tool_use_id"))
        launch_node_id = f"tool-use:{tool_use_id}" if tool_use_id else None
        if launch_node_id and launch_node_id in known_node_ids:
            edge_id = f"spawns:{launch_node_id}:{root_id}"
            merged["edges"].append(
                {
                    "id": edge_id,
                    "session_id": merged["session_id"],
                    "source": launch_node_id,
                    "target": root_id,
                    "kind": "spawns",
                }
            )

        id_map = {
            str(node["id"]): f"{namespace}:{node['id']}"
            for node in child_nodes
            if isinstance(node, dict) and node.get("id")
        }
        child_sequences = [
            int(node.get("sequence", 0)) for node in child_nodes if isinstance(node, dict)
        ]
        child_min_sequence = min(child_sequences, default=0)
        for node in child_nodes:
            if not isinstance(node, dict) or str(node.get("id")) not in id_map:
                continue
            item = dict(node)
            item["id"] = id_map[str(node["id"])]
            item["session_id"] = merged["session_id"]
            item["sequence"] = root_sequence + 1 + int(node.get("sequence", 0)) - child_min_sequence
            payload = dict(item.get("payload") or {})
            payload["agent_id"] = agent_id
            item["payload"] = payload
            merged["nodes"].append(item)
            known_node_ids.add(item["id"])

        child_targets = {
            str(edge.get("target"))
            for edge in child_edges
            if isinstance(edge, dict) and edge.get("kind") == "parent"
        }
        child_root_ids = [
            original_id
            for original_id in id_map
            if original_id not in child_targets and original_id.startswith("event:")
        ]
        for child_root_id in child_root_ids:
            target = id_map[child_root_id]
            merged["edges"].append(
                {
                    "id": f"contains:{root_id}:{target}",
                    "session_id": merged["session_id"],
                    "source": root_id,
                    "target": target,
                    "kind": "contains",
                }
            )

        for edge in child_edges:
            if not isinstance(edge, dict):
                continue
            source = id_map.get(str(edge.get("source")))
            target = id_map.get(str(edge.get("target")))
            if not source or not target:
                # Partial-log references stay intentionally unresolved in the
                # child graph; omitting them avoids cross-transcript ambiguity.
                continue
            item = dict(edge)
            item["source"] = source
            item["target"] = target
            item["id"] = f"{namespace}:{edge.get('id')}"
            item["session_id"] = merged["session_id"]
            merged["edges"].append(item)

        next_sequence = root_sequence + 2 + max(child_sequences, default=-1) - child_min_sequence

    merged["nodes"].sort(key=lambda item: (item["sequence"], item["id"]))
    return merged
