# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product definition

AgentLens is a **local-first session intelligence tool for Claude Code sessions**.

Its canonical job is to:
- ingest local Claude Code session logs
- normalize them into structured session records
- store them locally in SQLite
- expose searchable inspection and analytics views through a FastAPI backend and React dashboard

Keep the product language centered on **Claude Code session replay, inspection, provenance, cost, and analytics**.

Do **not** casually reposition AgentLens as:
- a hosted telemetry platform
- a remote-control or mission-control system
- a generic tracing backend
- a multi-agent runtime

## Canonical runtime flow

```text
Claude Code session logs
        ↓
CollectorManager + Claude Code collector
        ↓
normalized session-level records
        ↓
SQLite (`~/.agentlens/agentlens.db`)
        ↓
FastAPI session/stats endpoints
        ↓
React dashboard for inbox / inspector / analytics
```

## Core code paths

### Backend and ingestion
- `src/agentlens/collectors.py`
  - canonical ingestion pipeline
  - historical backfill + polling watch mode
  - Claude Code log parsing
  - session aggregation of tool calls, LLM calls, token counts, provenance, and task summaries
- `src/agentlens/storage.py`
  - canonical SQLite persistence
  - keeps a backward-compatible `traces` table even though the product is session-centric
  - powers session list/detail and overview/project stats queries
- `src/agentlens/api.py`
  - canonical FastAPI runtime
  - on startup it backfills historical sessions and starts log watching automatically
  - serves session/stats APIs and compatibility ingestion endpoints
- `session_scanner.py`
  - standalone CLI wrapper around `CollectorManager`
  - use for one-shot backfills or a dedicated local watch process outside the API server
- `src/agentlens/realtime.py`
  - thin background wrapper around the same collector pipeline
  - secondary helper, not the main product entrypoint

### Frontend
- `dashboard/src/main.tsx`
  - frontend entrypoint
  - mounts `App.tsx`
- `dashboard/src/App.tsx`
  - current dashboard shell
  - fetches API data, normalizes session records for the UI, and drives sessions / analytics / activity views
- `dashboard/src/components/EnhancedTraceDetail.tsx`
  - session inspector
- `dashboard/src/components/RealtimeStatusPanel.tsx`
  - recent activity / freshness view
- `dashboard/src/components/AgentInteractionGraph.tsx`
  - graph-style visualization

## Important architecture distinctions

### 1. The product is session-centric, but storage is still trace-shaped
The backend stores data in a backward-compatible `traces` table with JSON columns such as `tool_calls` and `llm_calls`. The UI and higher-level API treat those rows as **session records**. Preserve both:
- session-centric UX and queries
- compatibility for existing trace ingestion paths

### 2. API startup already runs ingestion watchers
`src/agentlens/api.py` does a historical backfill and then starts collector watch mode on boot. `session_scanner.py --watch` and `src/agentlens/realtime.py` use the same underlying collector flow. Do not add a second parallel watcher unless duplicate work is intentional.

### 3. The active dashboard is `App.tsx`, not every dashboard-looking file
`dashboard/src/main.tsx` mounts `App.tsx`. If you find alternate UI ideas or older dashboard code, verify they are actually wired into `main.tsx` before changing product behavior around them.

### 4. The frontend assumes the backend is on port 8080
`dashboard/src/App.tsx` hardcodes `API_URL = 'http://localhost:8080'`. Backend port changes require matching frontend changes.

### 5. `src/agentlens/cli.py` is not the main app workflow
The Poetry console script points at `agentlens.cli:main`, but that file is a small Rich terminal monitor that reads from a running API. It is secondary to the main backend + dashboard flow and should not drive product architecture decisions.

## Supported source

The canonical ingestion path is local Claude Code session-log parsing from:
- `~/.claude/projects/.../*.jsonl`

There is also a secondary pushed-trace path through:
- `POST /api/v1/traces`
- `POST /api/v1/traces/batch`

Keep those compatibility endpoints working when changing backend models, but treat local Claude Code log parsing as the primary product path.

## Common commands

### Install
```bash
pip install -e .
cd dashboard && npm install
```

### Run the backend API
```bash
python3 -m src.agentlens.api
```

### Run the frontend
```bash
cd dashboard
npm run dev
```

### Refresh the local database from Claude Code logs
```bash
python3 session_scanner.py
```

### Watch Claude Code sessions continuously
```bash
python3 session_scanner.py --watch --interval 5
```

### Backend quality checks
```bash
pytest
pytest path/to/test_file.py::test_name
ruff check .
black .
mypy
```

### Frontend quality checks
```bash
cd dashboard
npm run lint
npm run build
npm run preview
```

## Reference docs worth reading first

- `README.md`
  - current product framing and quick-start flow
- `docs/architecture.md`
  - session-centric architecture and product-boundary rationale
- `docs/session-log-formats.md`
  - concrete Claude Code log examples and extraction targets
- `docs/PLATFORM_LOGS.md`
  - source-log notes and platform-specific context

## Refactor guardrails

Preserve these behaviors during backend or UI changes:
- real parser support for Claude Code logs
- provenance fields such as `session_file_path` and `project_path`
- fidelity of tool-call and LLM-call detail
- task-summary extraction from session tool activity
- compatibility for `POST /api/v1/traces` ingestion
- local-first operation without requiring external services

Prefer simplifying:
- duplicate or stale dashboard variants
- overlapping ingestion entrypoints when one canonical path is enough
- product language that implies remote control instead of local session inspection
- secondary monitor/CLI surfaces trying to become the main product story
