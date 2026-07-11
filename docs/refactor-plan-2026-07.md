# Refactor Plan — July 2026

Grounded survey of the codebase as of `46a212a` (plus the uncommitted code-review fixes to
`EnhancedTraceDetail.tsx` / `TraceDetailBlocks.tsx` / `sessionUtils.ts`). Every item below was
verified against the running code, not just read from the source.

## P0 — Broken compatibility endpoints: `POST /api/v1/traces` (+ `/batch`)

**Evidence.** Commit `d3c390f` ("feat: lighten hierarchy and tree-backed session detail")
deleted the `TraceIn` / `TraceBatchIn` Pydantic models, but `api.py:584` and `api.py:593`
still annotate with them. Because the module has `from __future__ import annotations`, import
does not crash — instead FastAPI silently degrades the body parameter to a **required query
parameter**. Probed live:

```
POST /api/v1/traces  {"trace_id": ...}
→ 422 {"detail":[{"type":"missing","loc":["query","trace"],"msg":"Field required"}]}
```

So both push-ingestion endpoints have been non-functional since early July. CLAUDE.md's
refactor guardrails explicitly require: *"compatibility for `POST /api/v1/traces` ingestion"*.

**Fix.** Restore the two models (git history has them in `d3c390f^`), or replace with a
minimal `TraceIn(BaseModel)` matching `storage.save_trace`'s expected dict shape.
**Add endpoint tests** — `tests/test_api.py` never exercises these routes, which is why the
breakage went unnoticed.

## P1 — `_decode_path` host-OS dependence (failing test on Windows)

**Evidence.** `pytest` fails on this machine:
`test_decode_path_preserves_posix_shape` expects
`-Users-wangwen-...` → `/Users/wangwen/...`, but `collectors.py:1239-1241` branches on
`os.name == "nt"` and produces `\Users\wangwen\...`.

The drive-letter branch (`collectors.py:1234-1237`) already handles genuine Windows project
dirs (`E--workspace-agentlen` → `E:\workspace\agentlen`). The `os.name` fallback only
mis-decodes POSIX-shaped dirs (e.g. logs synced from a Mac) on Windows hosts, corrupting
`project_path` provenance.

**Fix.** Delete the `os.name == "nt"` branch; keep drive-letter detection + POSIX fallback.
Decode should be a pure function of the encoded name, not of the host OS. This makes the
test suite green on Windows.

## P1 — Migrate `@app.on_event` → lifespan handler

`api.py:556` / `api.py:565` emit FastAPI deprecation warnings on every boot. Mechanical
migration to a `lifespan` async context manager; also gives a single place for
startup-ingestion wiring.

## P2 — Centralize the frontend API base URL

`API_URL = 'http://localhost:8080'` in `App.tsx:28`, plus a second hardcoded
`http://localhost:8080/...` fetch in `EnhancedTraceDetail.tsx:113`. CLAUDE.md documents this
coupling as a known footgun. Move to `dashboard/src/lib/api.ts`:

```ts
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8080';
```

and route the `/open` fetch through it. Low effort, removes the two-file drift risk.

## P2 — Split `EnhancedTraceDetail.tsx` (1,241 lines)

Largest frontend file; one component holds all tab state plus five render closures
(`renderOverview`, `renderPromptThreadGroup` with nested `renderChildRecord`, subagents,
task-status, raw). Everything re-renders on any `expandedLLMs`/`copiedId` state change, and
`getCallRenderState` (related-tool scan + classification) still runs unmemoized per visible
row per render — the code-review fixes removed the worst of it (the visibility pass now uses
cheap `classifyResponseKind`), but the structural pattern remains.

Suggested shape, in order of payoff:
1. Extract `renderChildRecord` into a memoized `<CallRecordRow>` component (props: call,
   toolScope, expanded, detailLevel, callbacks). This alone stops whole-tree recomputation
   on expand/collapse/copy.
2. Extract per-tab views: `LLMReplayView`, `SubagentsView`, `TaskStatusView`, `RawView`
   into `dashboard/src/components/trace-detail/`.
3. Move `classifyResponseKind` / `classifyCallResponse` / `getRelatedToolCalls` into a lib
   module so the subagents view stops reaching into closures.

## P3 — Backend module hygiene (optional)

- **`collectors.py` (1,537 lines, 59 functions)**: natural seams exist —
  pure parsing helpers (lines ~34-490), `SessionAggregator`, `LogCollector`/
  `ClaudeCodeCollector`, `CollectorManager`. If it keeps growing, split into
  `parsing.py` / `aggregator.py` / `collector.py` with `collectors.py` as a re-exporting
  facade. Not urgent; the file is cohesive today.
- **`JSONLStorage` (`storage.py:854-947`)**: exported in `__init__.py` but unused by the
  product (API uses `SQLiteStorage`; no other reference in the repo). Either delete it in a
  minor-version bump or mark deprecated. ~90 lines of parallel implementation to maintain.
- **Test coverage**: 3 test files, 19 tests. Missing: traces POST endpoints (see P0),
  session list/detail endpoints, and any frontend tests. `pytest` was not installed in this
  environment until now — consider a `dev` extra in `pyproject.toml`.

## Explicitly not recommended

- No new ingestion watcher paths — `api.py` startup + `session_scanner.py` + `realtime.py`
  already share the one canonical collector flow (CLAUDE.md architecture distinction #2).
- No repositioning of `cli.py` — it stays a secondary Rich monitor.
- `traces`-table schema stays backward-compatible per CLAUDE.md; session-centric queries
  continue to live on top of it.
