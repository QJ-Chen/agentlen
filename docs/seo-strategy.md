# AgentLens SEO Strategy

Updated: 2026-07-23

## Objective

Make AgentLens discoverable to developers looking for a local viewer for Claude Code or Codex CLI history, while keeping the local dashboard and its private session data out of search indexes.

The canonical public URL is <https://qj-chen.github.io/agentlen/>. The source repository is <https://github.com/QJ-Chen/agentlen>.

## Search intent

Repository search research shows three relevant clusters:

| Priority | Intent cluster | Representative terms | AgentLens answer |
| --- | --- | --- | --- |
| Primary | Session and log replay | Claude Code log viewer, Codex session viewer, AI agent session viewer | Unified local search and detailed replay for both formats |
| Secondary | Usage analysis | Claude Code usage dashboard, Codex usage analytics, AI coding agent cost | Tokens, recorded costs, models, tools, active days, and project totals |
| Supporting | Local agent observability | local AI agent observability, coding agent history | Private SQLite-backed forensic history without hosted telemetry |

“Observability” should remain supporting language. AgentLens does not provide remote control, hosted telemetry, or a generic OpenTelemetry backend, so targeting those broad terms as the primary promise would bring mismatched traffic.

## Indexing architecture

- `site/` is the only indexable product website. It has a canonical URL, crawler directives, sitemap, social metadata, JSON-LD, descriptive screenshots, and `llms.txt`.
- `dashboard/` is a private local application. Its HTML uses `noindex, nofollow`, and its `robots.txt` disallows all crawling. Do not remove either control when changing dashboard metadata.
- `README.md` and `pyproject.toml` repeat the same product category and canonical links for GitHub and package-index discovery.

## Content rules

- Lead with “Claude Code and Codex session log viewer.” It is concrete and matches the product.
- Use “local-first,” “open source,” and “no cloud upload” as differentiators, not as the entire category description.
- Describe replay depth with specific entities: prompts, assistant turns, tool calls, slash commands, subagents, tasks, vision references, and source JSONL provenance.
- Say “recorded cost data” unless the implementation explicitly estimates missing prices.
- Keep the public feature copy aligned with `FEATURES.md` and the current collectors.

## Off-page setup

The repository owner should keep GitHub metadata aligned with the page:

- Description: `Local-first Claude Code and Codex session log viewer with search, replay, and usage analytics.`
- Website: `https://qj-chen.github.io/agentlen/`
- Suggested topics: `ai-agents`, `agent-observability`, `claude-code`, `codex`, `developer-tools`, `log-viewer`, `local-first`, `session-replay`

After the Pages deployment is live:

1. Add the site to Google Search Console and Bing Webmaster Tools.
2. Submit `https://qj-chen.github.io/agentlen/sitemap.xml`.
3. Request indexing for the canonical home page once, after checking the deployed canonical and social image.
4. Link to the website from release notes, relevant project listings, and genuine technical write-ups. Avoid directory spam and repetitive keyword anchors.

## Measurement

Review every four weeks:

- Search impressions and clicks by query cluster.
- Indexed canonical URL and sitemap status.
- GitHub referral traffic and install-oriented clicks.
- Queries with impressions but weak click-through rate; improve title or description only when the page actually satisfies that intent.
- New features that warrant a focused documentation page. Add a page only when it provides substantial standalone value, then include it in the sitemap and internal navigation.

Run `pytest tests/test_site_seo.py` after changing public metadata, canonical URLs, crawler rules, or structured data.
