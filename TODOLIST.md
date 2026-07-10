# TODOLIST

Tracking open work for AgentLens. Items already shipped on `main` have been moved out of this file (see `CHANGELOG.md` and `FEATURES.md`).

## Backend

- [ ] Harden SQLite for concurrent watcher writes and API reads
- [ ] Fix cost accounting to preserve cache-token usage and actual session totals
- [ ] Move session aggregation/querying out of Python-side collapse logic and remove silent backend caps
- [ ] Centralize ingestion lifecycle to avoid drift between API, scanner, and realtime modes
- [ ] Expose ingest health, lag, parse quality, and last-error observability
- [ ] Populate real session status and error state instead of hardcoding success
- [ ] Add a real non-destructive verification path with fixture-based ingestion/API smoke tests
- [ ] Better full-text search across prompts, responses, tool I/O, and recap text
- [ ] Add static HTML / Markdown session export, including a compact handoff mode for feeding past sessions back into an LLM

## Frontend

- [ ] Custom session listing windows in frontend
- [ ] Remove the silent 200-session frontend ceiling and align inbox data with overview totals
- [ ] Centralize frontend API fetching with env-based config and partial-failure handling
- [ ] Auto-select the first visible session after filter/search changes to avoid blank detail panes
- [ ] Strengthen recent-activity freshness cues and reduce unnecessary 1-second recomputation
- [ ] Add detail-level and message-type filtering for session replay surfaces (e.g. user-only, minimal, interaction-focused, full)
- [ ] Add a session timeline view for prompt threads, assistant turns, tools, and subagent activity
- [ ] Add snapshot-style regression tests for long-session rendering and inspector/export readability

## Docs & onboarding

- [ ] Resolve the API-vs-scanner watcher workflow contradiction in docs and runtime guidance
- [ ] Add explicit prerequisites and configurable frontend backend URL setup docs
- [ ] Clarify which scripts and entrypoints are canonical versus compatibility utilities
- [ ] Quarantine or demote legacy docs/scripts that compete with the current product story
- [ ] Add screenshot tour of the dashboard (inbox, hierarchy, session detail with recap, control-plane cards, slash-command row)

## Refactors

- [ ] Extract frontend session normalization and API types out of `App.tsx`
- [ ] Tighten session detail readability and provenance/cost surfacing in `EnhancedTraceDetail.tsx`
- [ ] Preserve richer session provenance for replay and long-session inspection
- [ ] Fix install/run entrypoints so the packaged app matches the docs and working CLI surface