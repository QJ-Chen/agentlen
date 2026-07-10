# Changelog

All notable changes to AgentLens are recorded here. Dates use the project clock (Asia/Shanghai) and reflect when the commit landed on `main`.

The format is loosely based on [Keep a Changelog](https://keepachangelog.com), grouped by release window instead of strict semver.

---

## Unreleased

Nothing in flight on `main` beyond the items below. The next batch of work is tracked in `TODOLIST.md`.

## 2026-07-10 — Session recap, control-plane parsing, slash-command threads

### Highlights

- **Session recap surfaces in the hierarchy and session overview.** Claude Code's `system` / `away_summary` events are captured into `metadata.recap_text`, exposed through the API, and rendered both as the label of the corresponding hierarchy node and as a dedicated Recap card in the per-session overview panel.
- **Structured control-plane cards replace tag-stripping.** A new left-to-right tolerant parser in `dashboard/src/lib/sessionUtils.ts` replaces the brittle regex pipeline. It detects `<task-notification>`, `<bash-stdout>`, `<bash-stderr>`, `<bash-input>`, `<bash-output>`, `<bash-exit-code>` wrappers (including truncated ones, because the collector truncates `last_user_prompt` to 500 chars) and renders them as first-class UI cards: a `任务通知` card with status pill and truncated badge, and a `Bash 输出` card with separate stdout/stderr, exit code, and explicit empty states.
- **Slash commands become first-class prompt-thread rows.** `/loop`, `/clear`, `/model`, `/compact`, etc. are preserved with their `command-name`, `command-args`, and `command-message` fields and surface as standalone rows in the prompt-thread list. A `/loop` invocation now also dedupes correctly across the `isMeta: true` skill expansion that follows it — the assistant turn picks up the command and the fallback `command_only_records` entry is removed, eliminating the previous prompt-thread duplication.

### Added

- `recap_text` propagated end-to-end: collector (`latest_away_summary`) → `SQLiteStorage.get_session` metadata → API → frontend `Trace.recapText` → UI.
- `parseSessionText` and `SessionControlBlock` types in `dashboard/src/lib/sessionUtils.ts`.
- `ControlPlanePromptBlock` component for task-notification and Bash output cards.
- Hierarchy node label prefers recap text over session ID.
- Recap card in `renderOverview()` of `EnhancedTraceDetail.tsx`.

### Changed

- `dashboard/src/App.tsx`: removed the stale `selectedTraceVisible` gate that hid session/llm/subagent/vision/task node details when the selected trace was filtered out of the inbox.
- `attachCommandOnlyRecordsToThreads`: dedupes by prompt ID; standalone rows render the command via `commandOnlyRecords` only (no duplicate `command` field on the thread).
- `cleanSessionText` now delegates to `parseSessionText` and joins text blocks, dropping any embedded control-plane payloads.
- Command-only prompt-thread previews show the slash command label (e.g. `/loop 1m ...`) instead of `无提示词`.

### Fixed

- Collector cleared `pending_user_command` on the `isMeta: true` expanded `/loop` prompt; now preserves it across same-prompt skill expansion and widens the assistant matcher to accept an empty assistant prompt ID when the pending command has a valid one. `/loop` no longer appears as a duplicate row beside the real thread.
- Loop dedup covered by two new regression tests in `tests/test_collectors.py` (`test_loop_command_threads_attach_through_meta_expansion`, `test_command_only_stays_standalone_after_unrelated_user_prompt`).

## 2026-07-09 — Slash-command ingest

- `pending_user_command` and `command_only_records` collector state.
- `command` field on assistant LLM calls (name/args/message).
- Typed `command?` and `commandOnlyRecords?` on prompt threads; slash-command standalone rows render with a compact command pill.

## 2026-07-08 — Hierarchy explorer + session detail rewrite

- New lightweight `/api/v1/hierarchy` and `/api/v1/hierarchy/children` endpoints backed by a "light session projection" table.
- Lazy `NodeDetailPane` mounted per node type: `session`, `session-llm`, `session-subagents`, `session-vision`, `session-tasks`, `assistant-turn`.
- Vision node surfaces pasted and attached image references.
- Expand/collapse assistant turn cards in the replay view.
- Overview stats and short response cache refresh tuned down for big sessions.

## 2026-07-07 — Project metadata panel + date range filter

- `/api/v1/projects/by-path` exposes CLAUDE.md instructions, `MEMORY.md` index, local `.claude/settings.local.json`, git worktrees, and counts of session/subagent/tool-result/task artifacts for a project path.
- Date-range filter on `/api/v1/sessions`, `/api/v1/stats/overview`, `/api/v1/stats/projects`, and the compatibility `/api/v1/stats` endpoint.
- Async ingest startup: API no longer blocks on the initial backfill.

## 2026-07-04 — Sessions-only dashboard

- Dropped the legacy Dashboard/TraceList shell; `dashboard/src/main.tsx` now mounts `App.tsx`.
- Project metadata panel rendered in the project detail pane.
- Stage-one hierarchy explorer shipped behind a feature flag and rolled out by default shortly after.