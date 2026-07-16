import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from agentlens import api


class StubStorage:
    def __init__(self, session):
        self._session = session

    def get_session(self, session_id: str, detail: str = "full"):
        if session_id != "session-1":
            return None
        return self._session


class ActivityStubStorage(StubStorage):
    def __init__(self):
        super().__init__({"session_id": "session-1"})
        self.page_calls = []
        self.neighborhood_calls = []
        self.conversation_calls = []

    def get_session_conversation(self, session_id, **kwargs):
        self.conversation_calls.append({"session_id": session_id, **kwargs})
        if session_id != "session-1":
            return None
        return {
            "llm_calls": [{"id": "turn-2"}],
            "tool_calls": [],
            "next_cursor": "1",
            "has_more": True,
            "total_llm_calls": 2,
            "total_tool_calls": 0,
            "source": "activity-v1",
        }

    def get_activity_nodes(self, session_id, **kwargs):
        self.page_calls.append({"session_id": session_id, **kwargs})
        return {
            "nodes": [{"id": "event:a", "sequence": 0, "kind": "user-message"}],
            "next_cursor": "0:event:a",
        }

    def get_activity_node(self, session_id, node_id):
        if node_id != "event:a":
            return None
        return {"node": {"id": node_id}, "inbound_edges": [], "outbound_edges": []}

    def get_activity_neighborhood(self, session_id, node_id, **kwargs):
        self.neighborhood_calls.append(
            {"session_id": session_id, "node_id": node_id, **kwargs}
        )
        if node_id == "missing":
            return None
        return {
            "center_node_id": node_id,
            "depth": kwargs["depth"],
            "depth_reached": kwargs["depth"],
            "direction": kwargs["direction"],
            "nodes": [{"id": node_id}],
            "edges": [],
            "truncated": False,
        }


class RangeCaptureStorage:
    def __init__(self):
        self.sessions_calls = []
        self.overview_calls = []
        self.projects_calls = []
        self.session_detail = {
            "session_id": "session-1",
            "project_path": "/demo/project",
            "agent_name": "claude-code",
            "status": "completed",
            "llm_calls": [
                {"id": "turn-1", "is_assistant_turn": True},
                {"id": "turn-2", "is_assistant_turn": True},
            ],
            "metadata": {
                "subagent_logs": [{"id": "subagent-1"}],
                "task_summary": {"tasks": [{"taskId": "1"}, {"taskId": "2"}]},
            },
        }

    def list_sessions(self, **kwargs):
        self.sessions_calls.append(kwargs)
        return {
            "sessions": [
                {
                    "session_id": "session-1",
                    "project_path": "/demo/project",
                    "agent_name": "claude-code",
                    "status": "completed",
                    "start_time": "2026-07-08T00:00:00Z",
                    "last_updated": "2026-07-08T00:01:00Z",
                    "metadata": {
                        "llm_call_count": 2,
                        "recap_text": "Goal is improving AgentLens session previews.",
                    },
                }
            ],
            "count": 1,
            "total": 1,
        }

    def get_session(self, session_id: str, detail: str = "full"):
        if session_id == self.session_detail["session_id"]:
            return self.session_detail
        return None

    def get_overview_stats(self, period_hours, start_time=None, end_time=None):
        self.overview_calls.append(
            {
                "period_hours": period_hours,
                "start_time": start_time,
                "end_time": end_time,
            }
        )
        return {
            "period_hours": period_hours,
            "total_sessions": 0,
            "total_projects": 0,
            "total_traces": 0,
            "total_llm_calls": 0,
            "total_tool_calls": 0,
            "total_tokens": 0,
            "total_cost": 0,
            "avg_duration_ms": 0,
            "platforms": [],
            "platform_counts": {},
            "models": [],
            "status_counts": {},
            "top_tools": [],
            "active_days": [],
        }

    def get_project_stats(self, period_hours, start_time=None, end_time=None):
        self.projects_calls.append(
            {
                "period_hours": period_hours,
                "start_time": start_time,
                "end_time": end_time,
            }
        )
        return []


class ProjectMetadataApiTests(unittest.TestCase):
    def test_project_metadata_endpoint_returns_memory_and_config(self):
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            project_path = root / "project"
            project_path.mkdir()
            (project_path / "CLAUDE.md").write_text("# Demo project\n\nInstruction line\n", encoding="utf-8")
            repo_claude = project_path / ".claude"
            repo_claude.mkdir()
            (repo_claude / "settings.local.json").write_text(
                json.dumps({"permissions": {"allow": ["Bash(python3:*)", "Skill(run)"]}}),
                encoding="utf-8",
            )
            worktrees_dir = repo_claude / "worktrees"
            worktrees_dir.mkdir()
            worktree = worktrees_dir / "demo-worktree"
            worktree.mkdir(parents=True)
            (worktree / ".git").mkdir()
            (worktree / ".git" / "HEAD").write_text("ref: refs/heads/demo-branch\n", encoding="utf-8")

            project_store_root = root / "home" / ".claude" / "projects"
            tasks_root = root / "home" / ".claude" / "tasks"
            project_key = api._encode_project_path(str(project_path.resolve()))
            project_store = project_store_root / project_key
            memory_dir = project_store / "memory"
            memory_dir.mkdir(parents=True)
            (memory_dir / "MEMORY.md").write_text(
                "- [Demo](demo-memory.md) — demo entry\n",
                encoding="utf-8",
            )
            (memory_dir / "demo-memory.md").write_text(
                "---\ndescription: demo memory\n---\n\nDemo body\n",
                encoding="utf-8",
            )
            (project_store / "session-1.jsonl").write_text("{}\n", encoding="utf-8")
            subagents_dir = project_store / "session-1" / "subagents"
            subagents_dir.mkdir(parents=True)
            (subagents_dir / "agent-1.jsonl").write_text("{}\n", encoding="utf-8")
            (subagents_dir / "agent-1.meta.json").write_text("{}\n", encoding="utf-8")
            tool_results_dir = project_store / "session-1" / "tool-results"
            tool_results_dir.mkdir(parents=True)
            (tool_results_dir / "result.txt").write_text("ok\n", encoding="utf-8")
            task_dir = tasks_root / "session-1"
            task_dir.mkdir(parents=True)
            (task_dir / "1.json").write_text('{"id":"1"}\n', encoding="utf-8")

            original_projects_root = api.PROJECTS_ROOT
            original_tasks_root = api.TASKS_ROOT
            api.PROJECTS_ROOT = project_store_root
            api.TASKS_ROOT = tasks_root
            try:
                client = TestClient(api.app)
                response = client.get(
                    "/api/v1/projects/by-path",
                    params={"project_path": str(project_path.resolve())},
                )
            finally:
                api.PROJECTS_ROOT = original_projects_root
                api.TASKS_ROOT = original_tasks_root

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["identity"]["project_key"], project_key)
        self.assertTrue(payload["instructions"]["exists"])
        self.assertTrue(payload["memory"]["exists"])
        self.assertEqual(payload["memory"]["note_count"], 1)
        self.assertTrue(payload["local_config"]["exists"])
        self.assertEqual(payload["local_config"]["allow_rule_count"], 2)
        self.assertEqual(payload["worktrees"]["count"], 1)
        self.assertEqual(payload["session_artifacts"]["session_count"], 1)
        self.assertEqual(payload["session_artifacts"]["subagent_log_count"], 1)
        self.assertEqual(payload["session_artifacts"]["subagent_meta_count"], 1)
        self.assertEqual(payload["session_artifacts"]["tool_result_count"], 1)
        self.assertEqual(payload["task_artifacts"]["directory_count"], 1)
        self.assertEqual(payload["task_artifacts"]["task_file_count"], 1)


class StubRealtimeUpdater:
    def __init__(self, storage, interval=5.0):
        self.storage = storage
        self.interval = interval
        self.started = False
        self.stopped = False
        self.rescan_requested = False
        self.status = {
            "running": True,
            "watching": False,
            "job_type": "startup_backfill",
            "job_state": "queued",
            "startup_backfill_completed": False,
            "collectors": [],
        }

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def request_rescan(self):
        self.rescan_requested = True
        return {
            "status": "accepted",
            "job_type": "manual_rescan",
            "job_state": "queued",
        }

    def get_status(self):
        return dict(self.status)


class OpenSessionPathTests(unittest.TestCase):
    def setUp(self):
        self.original_storage = api.storage
        self.original_updater = api.realtime_updater
        self.realtime_patcher = patch.object(api, "RealtimeUpdater", StubRealtimeUpdater)
        self.realtime_patcher.start()
        api.realtime_updater = None
        self.tmp_dir = Path(self._testMethodName)
        self.tmp_dir.mkdir(exist_ok=True)
        self.project_dir = self.tmp_dir / "project"
        self.project_dir.mkdir(exist_ok=True)
        self.session_file = self.project_dir / "session-1.jsonl"
        self.session_file.write_text("{}\n", encoding="utf-8")
        api.storage = StubStorage(
            {
                "project_path": str(self.project_dir.resolve()),
                "session_file_path": str(self.session_file.resolve()),
            }
        )
        self.client = TestClient(api.app)

    def tearDown(self):
        api.storage = self.original_storage
        api.realtime_updater = self.original_updater
        self.realtime_patcher.stop()
        if self.tmp_dir.exists():
            for child in sorted(self.tmp_dir.rglob("*"), reverse=True):
                if child.is_file():
                    child.unlink()
                elif child.is_dir():
                    child.rmdir()
            self.tmp_dir.rmdir()

    def test_open_session_path_uses_windows_startfile(self):
        opened = []

        with patch.object(api.sys, "platform", "win32"):
            with patch.object(api.os, "startfile", lambda value: opened.append(value), create=True):
                response = self.client.post("/api/v1/sessions/session-1/open", params={"target": "project"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(opened, [response.json()["opened_path"]])

    def test_open_session_path_uses_macos_open(self):
        popen_calls = []

        with patch.object(api.sys, "platform", "darwin"):
            with patch.object(api.shutil, "which", side_effect=lambda name: "/usr/bin/open" if name == "open" else None):
                with patch.object(api.subprocess, "Popen", lambda args: popen_calls.append(args)):
                    response = self.client.post("/api/v1/sessions/session-1/open", params={"target": "project"})

        self.assertEqual(response.status_code, 200)
        self.assertEqual(popen_calls, [["open", response.json()["opened_path"]]])

    def test_open_session_path_uses_xdg_open(self):
        popen_calls = []

        with patch.object(api.sys, "platform", "linux"):
            with patch.object(
                api.shutil,
                "which",
                side_effect=lambda name: "/usr/bin/xdg-open" if name == "xdg-open" else None,
            ):
                with patch.object(api.subprocess, "Popen", lambda args: popen_calls.append(args)):
                    response = self.client.post(
                        "/api/v1/sessions/session-1/open",
                        params={"target": "session_folder"},
                    )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(popen_calls, [["xdg-open", response.json()["opened_path"]]])

    def test_open_session_path_returns_501_when_no_launcher(self):
        with patch.object(api.sys, "platform", "linux"):
            with patch.object(api.shutil, "which", side_effect=lambda name: None):
                response = self.client.post("/api/v1/sessions/session-1/open", params={"target": "project"})

        self.assertEqual(response.status_code, 501)
        self.assertEqual(response.json()["detail"], "Opening paths is not supported on this platform")

    def test_open_session_path_returns_404_for_missing_path(self):
        api.storage = StubStorage(
            {
                "project_path": str((self.tmp_dir / "missing-project").resolve()),
                "session_file_path": str((self.tmp_dir / "missing-project" / "session-1.jsonl").resolve()),
            }
        )

        with patch.object(api.sys, "platform", "linux"):
            with patch.object(api.shutil, "which", side_effect=lambda name: "/usr/bin/xdg-open"):
                response = self.client.post("/api/v1/sessions/session-1/open", params={"target": "project"})

        self.assertEqual(response.status_code, 404)
        self.assertIn("Path does not exist", response.json()["detail"])


class DateRangeApiTests(unittest.TestCase):
    def setUp(self):
        self.original_storage = api.storage
        self.original_updater = api.realtime_updater
        self.realtime_patcher = patch.object(api, "RealtimeUpdater", StubRealtimeUpdater)
        self.realtime_patcher.start()
        self.storage = RangeCaptureStorage()
        api.storage = self.storage
        api.realtime_updater = None
        self.client = TestClient(api.app)

    def tearDown(self):
        api.storage = self.original_storage
        api.realtime_updater = self.original_updater
        self.realtime_patcher.stop()

    def test_sessions_endpoint_passes_explicit_date_range(self):
        response = self.client.get(
            "/api/v1/sessions",
            params={
                "start_time": "2026-06-01T00:00:00Z",
                "end_time": "2026-06-29T23:59:59Z",
                "period_hours": 24,
                "limit": 20,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.storage.sessions_calls), 1)
        self.assertEqual(
            self.storage.sessions_calls[0]["start_time"],
            "2026-06-01T00:00:00Z",
        )
        self.assertEqual(
            self.storage.sessions_calls[0]["end_time"],
            "2026-06-29T23:59:59Z",
        )
        self.assertEqual(self.storage.sessions_calls[0]["period_hours"], 24)

    def test_sessions_endpoint_supports_partial_date_range(self):
        response = self.client.get(
            "/api/v1/sessions",
            params={"end_time": "2026-06-29T23:59:59Z"},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(self.storage.sessions_calls), 1)
        self.assertIsNone(self.storage.sessions_calls[0]["start_time"])
        self.assertEqual(
            self.storage.sessions_calls[0]["end_time"],
            "2026-06-29T23:59:59Z",
        )

    def test_overview_stats_endpoint_passes_explicit_date_range(self):
        response = self.client.get(
            "/api/v1/stats/overview",
            params={
                "start_time": "2026-06-01T00:00:00Z",
                "end_time": "2026-06-29T23:59:59Z",
                "period_hours": 720,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["total_projects"], 0)
        self.assertEqual(
            self.storage.overview_calls,
            [
                {
                    "period_hours": 720,
                    "start_time": "2026-06-01T00:00:00Z",
                    "end_time": "2026-06-29T23:59:59Z",
                }
            ],
        )

    def test_project_stats_endpoint_passes_explicit_date_range(self):
        response = self.client.get(
            "/api/v1/stats/projects",
            params={
                "start_time": "2026-06-01T00:00:00Z",
                "end_time": "2026-06-29T23:59:59Z",
                "period_hours": 720,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.storage.projects_calls,
            [
                {
                    "period_hours": 720,
                    "start_time": "2026-06-01T00:00:00Z",
                    "end_time": "2026-06-29T23:59:59Z",
                }
            ],
        )

    def test_compat_stats_endpoint_passes_explicit_date_range(self):
        response = self.client.get(
            "/api/v1/stats",
            params={
                "start_time": "2026-06-01T00:00:00Z",
                "end_time": "2026-06-29T23:59:59Z",
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            self.storage.overview_calls,
            [
                {
                    "period_hours": 720,
                    "start_time": "2026-06-01T00:00:00Z",
                    "end_time": "2026-06-29T23:59:59Z",
                }
            ],
        )


class HierarchyApiTests(unittest.TestCase):
    def setUp(self):
        self.original_storage = api.storage
        self.original_updater = api.realtime_updater
        self.realtime_patcher = patch.object(api, "RealtimeUpdater", StubRealtimeUpdater)
        self.realtime_patcher.start()
        self.storage = RangeCaptureStorage()
        api.storage = self.storage
        api.realtime_updater = None
        self.client = TestClient(api.app)

    def tearDown(self):
        api.storage = self.original_storage
        api.realtime_updater = self.original_updater
        self.realtime_patcher.stop()

    def test_hierarchy_root_returns_lightweight_structure(self):
        response = self.client.get("/api/v1/hierarchy")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["root"]
        self.assertEqual(payload["type"], "global-root")
        self.assertIn("children", payload)
        self.assertNotIn("detail", payload)

    def test_hierarchy_root_uses_recap_text_as_session_label(self):
        response = self.client.get("/api/v1/hierarchy")

        self.assertEqual(response.status_code, 200)
        payload = response.json()["root"]
        projects_root = next(child for child in payload["children"] if child["type"] == "projects-root")
        project_nodes = [child for child in projects_root["children"] if child["type"] == "project"]
        self.assertEqual(len(project_nodes), 1)
        sessions_bucket = next(child for child in project_nodes[0]["children"] if child["type"] == "project-sessions")
        session_nodes = [child for child in sessions_bucket["children"] if child["type"] == "session"]
        self.assertEqual(len(session_nodes), 1)
        self.assertEqual(session_nodes[0]["label"], "Goal is improving AgentLens session previews.")
        self.assertEqual(session_nodes[0]["sessionId"], "session-1")

    def test_hierarchy_children_returns_session_summaries(self):
        response = self.client.get(
            "/api/v1/hierarchy/children",
            params={"node_id": "session:session-1"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["node_id"], "session:session-1")
        self.assertEqual([child["type"] for child in payload["children"]], [
            "session-llm",
            "session-subagents",
            "session-vision",
            "session-tasks",
        ])


class SessionEventsApiTests(unittest.TestCase):
    def setUp(self):
        self.original_storage = api.storage
        self.original_updater = api.realtime_updater
        self.realtime_patcher = patch.object(api, "RealtimeUpdater", StubRealtimeUpdater)
        self.realtime_patcher.start()
        api.realtime_updater = None
        self.tmp_dir = Path(self._testMethodName)
        self.tmp_dir.mkdir(exist_ok=True)
        self.log_path = self.tmp_dir / "session-1.jsonl"
        self.log_path.write_text(
            '{"uuid":"evt-1","type":"user","message":{"role":"user","content":"hello"}}\n'
            "not json at all\n"
            '{"uuid":"evt-2","type":"assistant","message":{"role":"assistant","content":[]}}\n',
            encoding="utf-8",
        )
        subagents_dir = self.tmp_dir / "session-1" / "subagents"
        subagents_dir.mkdir(parents=True, exist_ok=True)
        (subagents_dir / "agent-abc.jsonl").write_text(
            '{"uuid":"evt-sub","type":"assistant","message":{"role":"assistant","content":[]}}\n',
            encoding="utf-8",
        )
        api.storage = StubStorage(
            {
                "project_path": str(self.tmp_dir.resolve()),
                "session_file_path": str(self.log_path.resolve()),
            }
        )
        self.client = TestClient(api.app)

    def tearDown(self):
        api.storage = self.original_storage
        api.realtime_updater = self.original_updater
        self.realtime_patcher.stop()
        for child in sorted(self.tmp_dir.rglob("*"), reverse=True):
            if child.is_file():
                child.unlink()
            elif child.is_dir():
                child.rmdir()
        self.tmp_dir.rmdir()

    def test_returns_raw_records_for_known_uuids(self):
        response = self.client.get(
            "/api/v1/sessions/session-1/events",
            params={"ids": "evt-1,evt-2,evt-nope"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        returned = {event["uuid"]: event for event in payload["events"]}
        self.assertEqual(set(returned), {"evt-1", "evt-2"})
        self.assertEqual(returned["evt-1"]["record"]["message"]["content"], "hello")
        self.assertEqual(payload["missing"], ["evt-nope"])

    def test_falls_back_to_subagent_logs(self):
        response = self.client.get(
            "/api/v1/sessions/session-1/events",
            params={"ids": "evt-sub"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(len(payload["events"]), 1)
        self.assertIn("agent-abc.jsonl", payload["events"][0]["source_file"])
        self.assertEqual(payload["missing"], [])

    def test_rejects_unknown_session_and_oversized_requests(self):
        response = self.client.get(
            "/api/v1/sessions/missing/events", params={"ids": "evt-1"}
        )
        self.assertEqual(response.status_code, 404)

        too_many = ",".join(f"evt-{idx}" for idx in range(51))
        response = self.client.get(
            "/api/v1/sessions/session-1/events", params={"ids": too_many}
        )
        self.assertEqual(response.status_code, 400)


class SessionActivitiesApiTests(unittest.TestCase):
    def setUp(self):
        self.original_storage = api.storage
        self.original_updater = api.realtime_updater
        self.realtime_patcher = patch.object(api, "RealtimeUpdater", StubRealtimeUpdater)
        self.realtime_patcher.start()
        self.storage = ActivityStubStorage()
        api.storage = self.storage
        api.realtime_updater = None
        self.client = TestClient(api.app)

    def tearDown(self):
        api.storage = self.original_storage
        api.realtime_updater = self.original_updater
        self.realtime_patcher.stop()

    def test_returns_page_and_decodes_composite_cursor(self):
        response = self.client.get(
            "/api/v1/sessions/session-1/activities",
            params={"cursor": "4:content:a:0", "kind": "tool-use", "limit": 25},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["next_cursor"], "0:event:a")
        self.assertEqual(
            self.storage.page_calls[0],
            {
                "session_id": "session-1",
                "kind": "tool-use",
                "after_sequence": 4,
                "after_node_id": "content:a:0",
                "limit": 25,
            },
        )

    def test_returns_bounded_conversation_page(self):
        response = self.client.get(
            "/api/v1/sessions/session-1/conversation",
            params={"cursor": "2", "limit": 1},
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["llm_calls"][0]["id"], "turn-2")
        self.assertEqual(
            self.storage.conversation_calls[0],
            {"session_id": "session-1", "limit": 1, "before": 2},
        )
        self.assertEqual(
            self.client.get(
                "/api/v1/sessions/session-1/conversation", params={"cursor": "bad"}
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.get("/api/v1/sessions/missing/conversation").status_code,
            404,
        )

    def test_returns_node_detail_and_not_found_responses(self):
        response = self.client.get("/api/v1/sessions/session-1/activities/event:a")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["node"]["id"], "event:a")

        self.assertEqual(
            self.client.get("/api/v1/sessions/session-1/activities/missing").status_code,
            404,
        )
        self.assertEqual(
            self.client.get("/api/v1/sessions/missing/activities").status_code,
            404,
        )

    def test_rejects_invalid_cursor_and_limit(self):
        self.assertEqual(
            self.client.get(
                "/api/v1/sessions/session-1/activities", params={"cursor": "bad"}
            ).status_code,
            400,
        )
        self.assertEqual(
            self.client.get(
                "/api/v1/sessions/session-1/activities", params={"limit": 501}
            ).status_code,
            422,
        )

    def test_returns_bounded_activity_neighborhood(self):
        response = self.client.get(
            "/api/v1/sessions/session-1/activities/event:a/neighborhood",
            params={
                "depth": 2,
                "direction": "outbound",
                "node_limit": 40,
                "edge_limit": 80,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["center_node_id"], "event:a")
        self.assertEqual(
            self.storage.neighborhood_calls[0],
            {
                "session_id": "session-1",
                "node_id": "event:a",
                "depth": 2,
                "direction": "outbound",
                "node_limit": 40,
                "edge_limit": 80,
            },
        )

    def test_neighborhood_rejects_invalid_bounds_and_missing_activity(self):
        self.assertEqual(
            self.client.get(
                "/api/v1/sessions/session-1/activities/event:a/neighborhood",
                params={"depth": 4},
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.get(
                "/api/v1/sessions/session-1/activities/event:a/neighborhood",
                params={"direction": "sideways"},
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.get(
                "/api/v1/sessions/session-1/activities/missing/neighborhood"
            ).status_code,
            404,
        )


class TraceSaveCaptureStorage:
    def __init__(self):
        self.saved_traces = []
        self.saved_batches = []

    def save_trace(self, trace):
        self.saved_traces.append(trace)

    def save_traces(self, traces):
        self.saved_batches.append(traces)


class TraceIngestApiTests(unittest.TestCase):
    def setUp(self):
        self.original_storage = api.storage
        self.original_updater = api.realtime_updater
        self.realtime_patcher = patch.object(api, "RealtimeUpdater", StubRealtimeUpdater)
        self.realtime_patcher.start()
        self.storage = TraceSaveCaptureStorage()
        api.storage = self.storage
        api.realtime_updater = None
        self.client = TestClient(api.app)

    def tearDown(self):
        api.storage = self.original_storage
        api.realtime_updater = self.original_updater
        self.realtime_patcher.stop()

    def test_create_trace_accepts_json_body(self):
        response = self.client.post(
            "/api/v1/traces",
            json={
                "trace_id": "trace-1",
                "agent_name": "claude-code",
                "session_id": "session-1",
                "start_time": "2026-07-11T00:00:00Z",
                "tool_calls": [{"name": "Read", "input": {"file_path": "E:\\demo\\a.txt"}}],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "trace_id": "trace-1"})
        self.assertEqual(len(self.storage.saved_traces), 1)
        saved = self.storage.saved_traces[0]
        self.assertEqual(saved["trace_id"], "trace-1")
        self.assertEqual(saved["platform"], "claude-code")
        self.assertEqual(saved["tool_calls"][0]["name"], "Read")

    def test_create_trace_rejects_missing_required_fields(self):
        response = self.client.post("/api/v1/traces", json={"trace_id": "trace-1"})

        self.assertEqual(response.status_code, 422)
        self.assertEqual(self.storage.saved_traces, [])

    def test_create_traces_batch_accepts_json_body(self):
        response = self.client.post(
            "/api/v1/traces/batch",
            json={
                "session_id": "session-1",
                "traces": [
                    {
                        "trace_id": "trace-1",
                        "agent_name": "claude-code",
                        "session_id": "session-1",
                        "start_time": "2026-07-11T00:00:00Z",
                    },
                    {
                        "trace_id": "trace-2",
                        "agent_name": "claude-code",
                        "session_id": "session-1",
                        "start_time": "2026-07-11T00:01:00Z",
                    },
                ],
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"status": "ok", "count": 2})
        self.assertEqual(len(self.storage.saved_batches), 1)
        self.assertEqual(
            [trace["trace_id"] for trace in self.storage.saved_batches[0]],
            ["trace-1", "trace-2"],
        )


class AsyncIngestApiTests(unittest.TestCase):
    def setUp(self):
        self.original_storage = api.storage
        self.original_updater = api.realtime_updater
        api.realtime_updater = None

    def tearDown(self):
        api.storage = self.original_storage
        api.realtime_updater = self.original_updater

    def test_startup_schedules_background_ingest_without_blocking(self):
        created = []

        class SlowStartUpdater(StubRealtimeUpdater):
            def start(self):
                created.append(self)
                self.started = True

        with patch.object(api, "RealtimeUpdater", SlowStartUpdater):
            with TestClient(api.app) as client:
                response = client.get("/")
                self.assertEqual(response.status_code, 200)
                self.assertTrue(created)
                self.assertTrue(created[0].started)

    def test_rescan_endpoint_returns_quickly_with_accepted_status(self):
        updater = StubRealtimeUpdater(api.storage)
        api.realtime_updater = updater
        client = TestClient(api.app)

        response = client.post("/api/v1/ingest/rescan")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {
                "status": "accepted",
                "job_type": "manual_rescan",
                "job_state": "queued",
            },
        )
        self.assertTrue(updater.rescan_requested)

    def test_ingest_status_reports_lifecycle_fields(self):
        updater = StubRealtimeUpdater(api.storage)
        updater.status = {
            "running": True,
            "watching": True,
            "job_type": "startup_backfill",
            "job_state": "running",
            "startup_backfill_completed": False,
            "collectors": [{"name": "claude-code", "is_watching": True}],
        }
        api.realtime_updater = updater
        client = TestClient(api.app)

        response = client.get("/api/v1/ingest/status")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["job_type"], "startup_backfill")
        self.assertEqual(response.json()["job_state"], "running")
        self.assertTrue(response.json()["watching"])


if __name__ == "__main__":
    unittest.main()
