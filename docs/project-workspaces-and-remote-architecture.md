# Project Workspaces and Remote Connections

## Summary

AgentLens should evolve from a global session inbox into a workspace-oriented
review tool:

1. Start with no project loaded and make opening a workspace explicit.
2. Let the user choose a detected project or inspect a custom local path.
3. Scope sessions, hierarchy, search, statistics, and project metadata to that
   context.
4. Add the opened project to the hierarchy even when it has no indexed sessions.
5. Model the source of the data as a connection, so a future remote log source
   can be used without redesigning the dashboard.

The first implementation should be local-only. Remote support should be
designed into the contracts, but not mixed into the first project-selector
release.

## What Exists Today

The repository already has most of the domain primitives:

- Claude Code projects are inferred from `~/.claude/projects/` log directory
  names.
- Codex sessions are normalized into the same session model.
- Sessions carry `project_path` and `session_file_path` provenance.
- The hierarchy groups sessions under project nodes.
- `/api/v1/projects/by-path` exposes project instructions, memory, local
  settings, skills, worktrees, and artifact counts.
- Session queries support a loose `project` text filter and exact
  `project_path` workspace scope.
- The collector watches all supported local log sources; it is not configured
  per project.

This means “open a project” is initially a review-context change, not an
ingestion change. The collector can continue indexing all local sessions while
the user focuses the UI on one project. That preserves complete history and
avoids repeatedly rebuilding the database when the user changes projects.

## Product Model

### Initial states

The dashboard should have an explicit workspace state in the header:

- **Closed**: no session, stats, or hierarchy workspace is loaded.
- **A project**: one project’s sessions, hierarchy, metadata, and stats.

The existing hierarchy remains useful inside a project. In project mode, the
project node can become the root and global Claude Code/Codex configuration can
be shown as a secondary context rather than occupying the primary tree.

### Project selection flow

The first useful flow is:

1. Open the project selector.
2. Show recently active and discovered projects, with session counts and last
   activity, plus a custom local path input.
3. Inspect custom paths for directory validity, indexed sessions, instructions,
   memory, skills, and worktrees.
4. Select a project and add it to the left hierarchy, including projects with
   zero indexed sessions.
5. Update the URL so the explicit context can be bookmarked.
6. Refresh all project-scoped data in one coordinated request cycle.

The header should expose **Open Project** while closed and the active project
with change/close actions while open. A project should be identified by a
stable ID, while its normalized path is displayed as
provenance. The path should not be the only identity because remote paths and
two machines with similar directory layouts will eventually collide.

### “Open project” versus “Open folder”

These are different actions:

- **Open project in AgentLens** changes the review context.
- **Open project folder** asks the operating system to reveal the folder.

The current browser dashboard can support the first action immediately. A web
page cannot reliably open a native folder picker and receive an arbitrary local
path back because of browser filesystem permissions. Therefore the first
“open” implementation should use discovered projects and a validated path
input, or be exposed through a small desktop wrapper later. It should not
pretend that the existing OS file-manager action is a project picker.

## Recommended Local Architecture

### API contract

Add exact project scoping alongside the existing compatibility filter:

```text
GET /api/v1/projects
GET /api/v1/sessions?project_path=<normalized-path>
GET /api/v1/stats/overview?project_path=<normalized-path>
GET /api/v1/stats/projects?project_path=<normalized-path>
GET /api/v1/hierarchy?project_path=<normalized-path>
GET /api/v1/projects/by-path?project_path=<normalized-path>
```

`project_path` should mean exact normalized identity, not substring matching.
The current `project` parameter can remain for backwards compatibility and
search-like behavior.

`GET /api/v1/projects` should return a lightweight catalog such as:

```json
{
  "projects": [
    {
      "id": "local:<stable-id>",
      "name": "agentlens",
      "path": "/Users/findai/workspace/tools/agentlens",
      "session_count": 42,
      "last_activity": "2026-07-28T08:00:00Z",
      "connection_id": "local"
    }
  ]
}
```

The exact stable-ID algorithm can be a versioned hash of the connection ID
and normalized path. Do not expose a raw path encoding as the long-term public
identity; the current encoded Claude directory name is a source-format detail.

### UI state

Add one active context state, for example:

```text
activeConnectionId: string
activeProjectId: string | null
```

Persist an explicitly opened context in the URL. A
URL such as `/project/local:<stable-id>` makes refresh, bookmarks, and future
multi-connection navigation predictable. The current inbox and hierarchy
requests should derive their query parameters from this state, rather than
each component implementing its own project filter.

The project selector belongs in the top application header. The hierarchy is
then a navigation surface inside the selected context, not the only way to
discover or enter a project.

### Storage and ingestion

Do not make the selected project control the collector in the first release.
Continue to ingest all supported local logs and use exact project filtering at
query time. This gives:

- complete history after changing projects;
- no data loss when a new project becomes active;
- simpler watcher behavior;
- a clean path to cross-project analytics.

Only consider per-project ingestion when users need explicit privacy or
performance boundaries. That would be a separate feature with a clear import
root and lifecycle.

## Remote Design Boundary

Remote support should keep the AgentLens server and dashboard on the local
machine. The local backend will use an SSH connection to discover and fetch
remote Claude Code and Codex log files, then run the existing normalization and
storage pipeline locally:

```text
AgentLens dashboard
        │ local HTTP
        ▼
Local AgentLens API + SQLite
        │
        ├── local filesystem adapter
        └── SSH connection adapter
              │ SSH commands / SFTP reads
              ▼
        Remote agent log directories
        ~/.claude/projects/ and ~/.codex/sessions/
```

There is no AgentLens worker on the remote host. The remote machine only needs
SSH access and the agent's existing log files. The local backend owns project
discovery, parsing, normalization, indexing, caching, and query serving.

An SSH port forward alone is not sufficient for remote file retrieval: it
forwards TCP connections to a service. The remote-log adapter should use the
authenticated SSH connection's command execution and/or SFTP subsystem to
list files, read appended ranges, and fetch bounded provenance records.

The dashboard should still not mount or directly browse a remote
`~/.claude` directory. All remote filesystem access stays behind the local API
and connection adapter, which avoids exposing SSH credentials to the browser
and keeps path translation, partial-file reads, and caching in one backend.

### Connection model

Introduce the concept now in API types, even if only `local` is implemented:

```text
Connection
  id
  kind: local | ssh
  label
  host
  user
  port
  status
  capabilities
  last_seen

Project
  id = connection_id + normalized target path
  connection_id
  name
  target_path
  session_count
  last_activity
```

Use `target_path` instead of assuming every path is local. In the UI, display
the connection label with the path when it is useful, for example
`build-server · /workspaces/api`. Keep remote target paths as provenance; do
not resolve them against the local filesystem.

### Remote log adapter

The adapter should expose the same conceptual operations as the local
collector, without requiring the collector to know whether a file is local or
remote:

```text
list_sources(connection) -> source metadata
read_source(source, offset, limit) -> bytes + next offset
read_source_snapshot(source) -> bounded stream or temporary local file
stat_source(source) -> size + modified time
```

For the first implementation, use SSH/SFTP to:

- enumerate only the configured Claude and Codex log roots;
- read file metadata before downloading content;
- fetch new byte ranges for active sessions;
- rebuild a session when a remote file is truncated or rotated;
- cache remote source state locally, keyed by connection and remote path.

Avoid arbitrary remote shell commands assembled from user input. Remote roots
should be configured and validated, and path arguments should be passed using
the SSH library's structured APIs or safely escaped command arguments.

### Recommended remote rollout

1. **SSH connection first.** Store an SSH connection profile locally and use
   SFTP or SSH commands to discover the configured remote log roots. The local
   AgentLens API remains the only dashboard endpoint.
2. **Local remote-log cache.** Cache source metadata and normalized sessions in
   the local SQLite database, with connection and remote-path provenance.
3. **Incremental synchronization.** Fetch appended ranges for active remote
   logs and rebuild files after truncation or rotation. Add explicit rescan and
   connection health states.
4. **Remote actions last.** “Open folder” needs a remote-aware action, such as
   copying an SSH path or opening an IDE terminal, and should not be silently
   mapped to a local OS command.

## Security and Privacy Constraints

- Keep the AgentLens API local; do not expose remote SSH credentials to the
  browser.
- Prefer the user's existing SSH config, agent, and host-key verification.
- Limit remote reads to configured Claude Code and Codex log roots.
- Treat remote file contents as sensitive data when caching them locally.
- Treat project paths, prompts, tool inputs, and raw logs as sensitive data.
- Custom local path inspection must validate that the target is a directory
  and read only the fixed metadata allowlist (`CLAUDE.md`, `.claude` settings,
  skills, worktrees, and matching AgentLens/Claude artifact roots).
- Keep the local dashboard’s `noindex` behavior; project/session content must
  never become part of the public SEO site.
- Make remote capabilities explicit. Read-only review should be separate from
  launching commands, editing files, or controlling agents.

## Phased Implementation

### Phase 1: Project context, complete

- Add `GET /api/v1/projects` based on indexed session rollups.
- Add exact `project_path` filtering to sessions, stats, and hierarchy.
- Start with no project loaded and add an Open Project dialog with detected
  projects, counts, and paths.
- Persist an explicitly opened project in the URL.
- Add tests proving that sessions, stats, and hierarchy all apply the same
  project scope.

### Phase 2: Local project onboarding, partially complete

- Add a validated custom local project path flow. (Complete)
- Verify the directory exists and report indexed session history and project
  metadata. (Complete)
- Offer a rescan without changing the global collector behavior.
- Make open-folder behavior explicit and platform-aware.

### Phase 3: Connection abstraction

- Add connection and capability types to the API and frontend.
- Treat the existing local backend as a `local` connection.
- Include connection identity in project IDs, cache keys, and URL state.
- Replace path-only assumptions in provenance and open-folder actions.

### Phase 4: Remote review

- Register an SSH connection in the local AgentLens backend.
- Discover and incrementally fetch remote Claude Code and Codex logs through
  SFTP or SSH commands.
- Add connection health, reconnect, read progress, and stale-cache states.
- Keep the first remote surface read-only: projects, sessions, hierarchy,
  metadata, search, and analytics.
- Add bounded event streaming only if polling is insufficient for live review.

## Remaining Decisions

1. Should a desktop wrapper later add a native folder picker alongside the
   implemented typed-path flow?
2. Should project mode hide global configuration or keep it as a secondary
   branch?
3. Should the first remote feature target one developer's SSH hosts, or a
   broader connection manager? A single-user SSH profile is the lower-risk
   default.
4. Should custom directories be persisted in an explicit registration store so
   they reappear in the detected catalog before they have session history?

## Recommendation

Implement Phase 1 first. It gives users the IDE-like “open a project to review”
workflow with a small, testable change and makes the dashboard substantially
more focused. Keep ingestion global, make query scope exact, and introduce
connection-aware IDs at the contract boundary. That preserves the local-first
product while leaving a credible path to remote review through local
normalization of logs fetched over SSH.

## Reference Scan

The initial scan looked at adjacent public projects returned for searches such
as “Claude Code session viewer” and “AI coding agent observability”, including
`RustingSword/claude_code_session_viewer`, `mrsekut/ccsv`, `23min/agent-lens`,
and `milkoor/causetrace`. The GitHub search endpoint was available for repository
discovery, but detailed repository API/readme requests were unavailable in the
current network environment. The architectural recommendation above is
therefore grounded primarily in AgentLens’s current code and the category
boundaries visible from the search results.
