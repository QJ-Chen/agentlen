import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi.testclient import TestClient

from agentlens import api


class StubStorage:
    def __init__(self, session):
        self._session = session

    def get_session(self, session_id: str):
        if session_id != "session-1":
            return None
        return self._session


class OpenSessionPathTests(unittest.TestCase):
    def setUp(self):
        self.original_storage = api.storage
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


if __name__ == "__main__":
    unittest.main()
