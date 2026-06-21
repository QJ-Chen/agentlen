# AgentLens

**Local-first session intelligence for Claude Code.**

AgentLens turns raw local Claude Code session logs into:

- searchable session inboxes
- replayable tool / LLM timelines
- token & cost analytics
- debugging views for “what actually happened?”

It is **not** a remote-control platform or a general-purpose LLM observability stack. The core niche is:

> **inspect, replay, and analyze Claude Code sessions from local artifacts — privately, quickly, and without a cloud dependency.**

---

## Why AgentLens exists

Claude Code leaves behind valuable evidence in local session logs:

- prompts and responses
- tool calls and outputs
- model usage
- token consumption
- session timing
- project paths and working context

But these logs are hard to inspect directly.

AgentLens provides a lightweight local pipeline:

```text
Claude Code session logs
        ↓
Claude Code collector
        ↓
normalized session records
        ↓
SQLite
        ↓
API + dashboard
```

The result is a practical **forensic replay + analytics layer** for Claude Code workflows.

---

## Core product surfaces

### 1. Sessions Inbox
Find recent sessions quickly and filter by:
- project path
- model
- status
- text query
- cost / tokens / duration

### 2. Session Inspector
Open a single session and inspect:
- cleaned prompt / response previews
- tool-call sequence
- LLM call sequence
- timestamps and duration
- source session file path
- project/workdir context

### 3. Analytics
Answer questions like:
- where did token/cost go?
- which projects were most active?
- which models were used most?
- which tools show up most often?
- which sessions failed or were unusually expensive?

---

## Supported source

### Local session-log ingestion (core path)
- **Claude Code** — `~/.claude/projects/.../*.jsonl` (same logical location on Windows, under the current user's home directory)

### Secondary ingestion path
- **Manual Claude-oriented trace ingestion** through the compatibility API endpoints

> The local Claude Code session-log pipeline is the main product. Compatibility ingestion remains available only through the existing API contract; old manual tracing modules are no longer part of the supported runtime.

---

## Architecture

```text
┌──────────────────────────────────────────────────────┐
│ Local sources                                        │
│  - Claude Code session logs                          │
│  - optional compatibility trace payloads             │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│ Canonical ingestion                                   │
│  CollectorManager + Claude Code collector             │
│  - historical scan                                    │
│  - polling watch mode                                 │
│  - normalized session records                         │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│ Local storage                                         │
│  SQLite (~/.agentlens/agentlens.db)                  │
└──────────────────────────┬───────────────────────────┘
                           │
                           ▼
┌──────────────────────────────────────────────────────┐
│ API + UI                                              │
│  FastAPI backend + React dashboard                    │
└──────────────────────────────────────────────────────┘
```

---

## Quick start

### 1. Install

```bash
git clone git@github.com:QJ-Chen/agentlen.git
cd agentlen

pip install -e .
cd dashboard && npm install && cd ..
```

> On Windows, use PowerShell or CMD equivalents as needed. `python` or `py -3` may be available instead of `python3`.

### 2. Start the backend API

```bash
python3 -m src.agentlens.api
```

### 3. Start the dashboard

```bash
cd dashboard
npm run dev
```

### 4. Backfill and watch local Claude Code sessions

```bash
python3 session_scanner.py --watch --interval 5
```

Then open:
- API: `http://localhost:8080`
- Dashboard: check the Vite dev server URL printed by `npm run dev`

On native Windows, the dashboard's **Open project** / **Open folder** actions now use the backend to launch Explorer for valid local session paths.

---

## Canonical runtime mode

Use this when you want to inspect real Claude Code history.

```bash
python3 -m src.agentlens.api
python3 session_scanner.py --watch
cd dashboard && npm run dev
```

### Removed experimental paths

The old manual tracing / orchestration experiment files have been removed from the supported repo surface. AgentLens should now be understood primarily as a Claude Code session-log ingestion and inspection tool.

---

## Project structure

```text
agentlen/
├── src/agentlens/
│   ├── api.py              # FastAPI backend
│   ├── storage.py          # SQLite storage + query helpers
│   ├── collectors.py       # canonical Claude Code ingestion pipeline
│   ├── realtime.py         # collector watch service
│   └── adapters/           # optional adapters / experiments
├── dashboard/
│   └── src/
│       ├── App.tsx         # main dashboard shell
│       └── components/     # inspector / activity / analytics UI
├── session_scanner.py      # thin CLI wrapper for CollectorManager
├── docs/
└── tests/
```

---

## API overview

### Session APIs
- `GET /api/v1/sessions`
- `GET /api/v1/sessions/{session_id}`

### Stats APIs
- `GET /api/v1/stats/overview`
- `GET /api/v1/stats/projects`
- `GET /api/v1/platforms` (returns Claude Code only)

### Ingestion APIs
- `POST /api/v1/traces`
- `POST /api/v1/traces/batch`
- `POST /api/v1/ingest/rescan`

Compatibility trace endpoints remain available, but only accept Claude Code payloads.

---

## Development status

### Stable direction
- local-first Claude Code session ingestion
- SQLite-backed storage
- session-centric API
- dashboard for inbox / inspector / analytics
- real local parsing for Claude Code session logs

### In-progress opportunities
- better full-text search
- richer project rollups
- better diff/tool-output inspection
- improved parser fixtures/tests

### Explicit non-goal for this phase
- becoming a full mission-control / remote-control system for running agents

---

## Verification checklist

After changes, verify:

1. backend starts and backfills Claude Code session data
2. scanner/watch mode detects new Claude Code session activity
3. dashboard shows sessions list and detail view correctly
4. project / model / tool analytics render from real data
5. non-Claude traces are rejected or purged from the supported runtime path

---

## Related docs

- [Architecture](docs/architecture.md)
- [Data sources](DATA_SOURCES.md)
- [Claude Code log notes](docs/PLATFORM_LOGS.md)
- [Claude Code session log reference](docs/session-log-formats.md)

---

## License

MIT
