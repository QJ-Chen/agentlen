# Features

A user-facing tour of what AgentLens exposes today. Every entry maps to one or more surfaces in the dashboard, the FastAPI backend, or the collector pipeline.

## Inbox

- **Sessions list** with searchable, filterable rows for project path, model, status, and text query.
- **Date-range filter** with explicit `start_time` / `end_time` parameters that flow from the dashboard through `/api/v1/sessions`, `/api/v1/stats/overview`, `/api/v1/stats/projects`, and the compatibility `/api/v1/stats` endpoint.
- **Cost / token / duration sortable columns** so expensive and slow sessions are easy to triage.
- **Slash-command standalone rows** — `/loop`, `/clear`, `/model`, `/compact`, etc. are surfaced as their own prompt-thread rows with a compact command pill.

## Hierarchy explorer

A lazy tree of the recent local Claude Code activity.

- **Root → projects → project → project-sessions → session → {llm, subagents, vision, tasks}** — every level fetches its own children via `/api/v1/hierarchy/children` so opening a session never pays for the full subtree.
- **Recap-driven labels** — when a session has an `away_summary` recap, the hierarchy node label uses that text instead of the bare session ID.
- **Node detail panes** mounted per node type, so opening a subagent node does not re-render the LLM timeline.

## Session inspector

- **Overview card** with project path, agent name, status, timing, model, totals (tokens, cost, duration), and a Recap card when `recap_text` is set.
- **Prompt-thread list** with mixed rendering: ordinary user prompt cards, `任务通知` task-notification cards, and `Bash 输出` / `Bash 错误` bash-output cards. Each control-plane card has explicit empty-state labels (`无输出`, `无错误输出`) and an `不完整` badge for truncated wrappers.
- **Expand/collapse assistant turn** so each prompt thread can show or hide its tool calls and response on demand.
- **Tool-call sequence** with input/output preview, exit code, and copy-to-clipboard for raw payloads.
- **Subagent summary** with per-subagent LLM calls and tool activity.
- **Vision node** lists pasted and attached image references, with click-through to the underlying file.
- **Task summary** derived from Task tool activity.
- **Provenance** — every session exposes its source `session_file_path` and `project_path` so you can jump straight back to the JSONL evidence on disk.
- **Copy-to-clipboard** on every block (commands, prompts, responses, structured JSON payloads) using a shared `onCopy` flow with a `已复制` confirmation state.

## Analytics

- **Overview stats** — total sessions / traces / LLM calls / tool calls / tokens / cost, average duration, platform mix (Claude Code only), model mix, status counts, top tools, active days.
- **Project rollups** — token and cost totals grouped by project path.
- **Lightweight projections** — heavy counters live in a side table so the inbox stays responsive on long sessions.

## Project metadata panel

Surfaced from `/api/v1/projects/by-path`:

- **Identity** — encoded project key plus the resolved absolute path.
- **Instructions** — the project's `CLAUDE.md` exists flag and content (truncated).
- **Memory** — `MEMORY.md` index entries and per-file body excerpts.
- **Local config** — `.claude/settings.local.json` parsed permissions (allow/deny rules).
- **Worktrees** — git worktree list with active branch detection.
- **Session artifacts** — count of session JSONLs, subagent logs, subagent metadata, tool results stored under the project's storage directory.
- **Task artifacts** — count of Task tool result directories and JSON files.

## Slash-command modeling

- **Command-only rows** keep standalone commands (`/clear`, `/model`) as their own prompt-thread entries rather than disappearing into `prompt` text.
- **Loop deduplication** — `/loop <interval> <message>` attaches to the assistant turn that follows its `isMeta: true` skill expansion, instead of producing a duplicate row.

## Control-plane parsing

- **Tolerant parser** replaces regex stripping and handles truncated wrappers (the collector truncates `last_user_prompt` to 500 chars).
- **Structured blocks** — `<task-notification>`, `<bash-stdout>`, `<bash-stderr>`, `<bash-input>`, `<bash-output>`, `<bash-exit-code>` are decoded into typed blocks with explicit `truncated` flags and surfaced as labeled UI cards.

## Backend & runtime

- **FastAPI** with auto backfill on startup; ingest watch mode kicks off in the background and does not block the HTTP listener.
- **SQLite** at `~/.agentlens/agentlens.db` (or the configured path), with a lightweight session-projection table for hierarchy reads and a backward-compatible `traces` table for session records.
- **Compatibility endpoints** `POST /api/v1/traces` and `POST /api/v1/traces/batch` still accept Claude Code-shaped payloads for downstream consumers.
- **Rescan endpoint** — `POST /api/v1/ingest/rescan` enqueues an out-of-band manual rescan without blocking.
- **Ingest status** — `GET /api/v1/ingest/status` reports job state, watching flag, and per-collector health.
- **Open in OS file manager** — `POST /api/v1/sessions/{id}/open` opens the project or session folder via `xdg-open` / `open` / `startfile` depending on platform, with proper 404 and 501 handling.

## Session scan / watch

- `session_scanner.py` — thin CLI around `CollectorManager` for one-shot backfills.
- `session_scanner.py --watch --interval 5` — continuous polling watch mode for use outside the API server.

## Refactor guardrails

- The legacy `cli.py` Rich monitor still works for ad-hoc inspection but is not the canonical entrypoint.
- Manual tracing / orchestration experiment files (`src/agentlens/orchestrator.py`, `src/agentlens/tracer.py`, configs, simulate scripts) were pruned from the supported runtime surface. They are not imported by `api.py` or `session_scanner.py`.