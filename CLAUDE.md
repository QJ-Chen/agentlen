# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AgentLens is a lightweight multi-platform Agent observability platform for tracking execution traces, token usage, and API costs across OpenClaw, Claude Code, Kimi Code, and Cursor.

## Architecture

```
agentlens/
├── src/agentlens/          # Python backend
│   ├── api.py              # FastAPI REST API server (port 8080)
│   ├── storage.py          # SQLite/JSONL storage layer
│   ├── collector.py        # Data collection SDK
│   ├── collectors.py       # Collector manager for platform adapters
│   ├── realtime.py        # Real-time log watching
│   └── adapters/           # Platform-specific adapters
├── dashboard/              # React TypeScript frontend (Vite, port 5177)
│   └── src/
│       ├── App.tsx         # Main app
│       ├── Dashboard.tsx   # Dashboard component
│       └── components/     # UI components (TraceTimeline, CostPanel, etc.)
├── session_scanner.py      # Scans historical sessions from all platforms
├── workflow_tracer.py      # SDK for manual tracing
└── tests/                  # Test files
```

## Commands

### Backend (Python)
```bash
# Start API server
python3 -m src.agentlens.api

# Run tests
pytest

# Lint/format
ruff check .
black .

# Type check
mypy
```

### Frontend (Dashboard)
```bash
cd dashboard

# Install dependencies
npm install

# Start dev server (http://localhost:5177)
npm run dev

# Build for production
npm run build

# Lint
npm run lint
```

### Data Collection
```bash
# Scan historical sessions (one-shot)
python3 session_scanner.py

# Scan with continuous watching
python3 session_scanner.py --watch --interval 30
```

## Data Sources

| Platform | Path | Data |
|----------|------|------|
| Claude Code | `~/.claude/projects/*.jsonl` | Full conversations, tool calls, token usage |
| Kimi Code | `~/.kimi/sessions/*/wire.jsonl` | Tool calls, LLM interactions |
| OpenClaw | `~/.openclaw/subagents/runs.json` | Subagent execution records |
| SDK | Manual via `workflow_tracer.py` | Custom tracing |

## API Endpoints

- `POST /api/v1/traces` - Create trace
- `POST /api/v1/traces/batch` - Batch create traces
- `GET /api/v1/traces?platform=&limit=` - Query traces
- `GET /api/v1/stats?period_hours=` - Get cost/token statistics
- `GET /api/v1/platforms` - List all platforms
- `GET /api/v1/sessions` - List all sessions

## Storage

Default storage is SQLite at `~/.agentlens/agentlens.db`. The `traces` table stores all execution data including `tool_calls` and `llm_calls` as JSON columns.

## Key Files

- `src/agentlens/api.py` - FastAPI app with startup/shutdown events that collect historical data and start real-time watching
- `src/agentlens/storage.py` - SQLiteStorage class handles all DB operations with JSON serialization for nested fields
- `src/agentlens/collectors.py` - CollectorManager coordinates multiple platform collectors
- `dashboard/src/Dashboard.tsx` - Main dashboard React component
