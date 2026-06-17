# AgentLens Dashboard

Claude Code session inspection dashboard for AgentLens.

## What it does

The dashboard is the UI for the current supported AgentLens product path:
- browse imported Claude Code sessions
- inspect prompt / response / tool / LLM details
- review recent activity
- explore project and cost rollups

## Main views

### Sessions Inbox
- grouped sessions list by project
- search by session / project / prompt
- status filtering
- session detail panel

### Analytics
- tool frequency
- project rollups
- grouped session/project exploration

### Recent Activity
- recently refreshed sessions
- quick jump into a selected session

## Development

```bash
cd dashboard
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Backend expectations

The active frontend expects the backend at:
- `http://localhost:8080`

It currently reads:
- `GET /api/v1/sessions`
- `GET /api/v1/stats/overview`
- `GET /api/v1/stats/projects`

## Notes

- This dashboard is now Claude-Code-only in product positioning.
- It no longer documents the removed timeline tab or old multi-platform trace UI.
