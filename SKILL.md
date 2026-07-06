---
name: github-project-info
description: Read public GitHub Projects (v2) boards — metadata, items, fields, and a user's full project list — without needing a GitHub token. Use when asked to check, summarize, or embed a public GitHub project board, especially one owned by a personal user account, where GitHub's official API alone returns 401 for item data.
---

# github-project-info

Reads public GitHub Projects (v2) boards without authentication, including item-level data
(status, custom fields, story points) that GitHub's own official API can't return
unauthenticated for **user-owned** projects (only org-owned projects have that carve-out in
GitHub's docs — confirmed, see this repo's `docs/investigation.md`).

## When to use this skill

- The user asks to check status, summarize, or display a **public** GitHub Projects (v2) board.
- `gh project item-list` or GitHub's REST/GraphQL API is failing with 401 for a project the
  user says is public — that's expected for user-owned projects, not a bug; use this instead.
- Building a dashboard, status page, or bot that needs live project data without storing a
  GitHub token.

## What it can't do

- **Private** projects. This only works for public projects; private ones genuinely need a
  real authenticated token — use GitHub's official API/CLI for those.
- Write operations (creating/updating items). This is read-only by design.

## How to use it

This skill wraps the `github-project-info-mcp` MCP server
(https://github.com/shubhtoy/github-project-info-mcp). If the MCP server is connected, call its
tools directly:

- `list_user_projects(username)` — find a user's public projects and their numbers, when you
  only have a username, not a project number.
- `get_project_metadata(ownerType, owner, projectNumber)` — title, description, state, dates.
- `list_project_items(ownerType, owner, projectNumber)` — all items with status/fields/points.
- `get_project_fields(owner, projectNumber)` — field/status option definitions (for resolving
  option IDs to names, and for building filters).
- `get_project_item(projectId, itemId, owner?, projectNumber?)` — single item detail,
  **including custom fields (Priority, Story Points, etc) that `list_project_items` omits** —
  that one only reflects the board's default view. Use the numeric `id` field from
  `get_project_metadata` (not `nodeId`) as `projectId`. Pass `owner`/`projectNumber` to get
  custom field names resolved instead of raw numeric IDs.

If the MCP server isn't connected, install/run it first:

```bash
npx -y github-project-info-mcp
```

Or call the equivalent hosted HTTP API (no install needed) if a Worker URL is configured for
this environment — see the parent repo's README for routes.

## Typical flow

1. If you only have a username: call `list_user_projects` to find the project number.
2. Call `get_project_metadata` for the summary (title, state, last updated).
3. Call `list_project_items` for the board's default-view contents (status, labels,
   sub-issues progress). Status/select values are already resolved to names automatically.
4. If the user asks about a field not shown by step 3 (Priority, Story Points, or any other
   custom field), call `get_project_item` for that specific item instead — pass
   `owner`/`projectNumber` so field names are resolved rather than raw numeric IDs.

## Caveats to pass along to the user

Some of what this relies on is undocumented GitHub internals (see the parent repo's README and
`docs/investigation.md`) — it works today, unauthenticated, for public projects, but isn't a
published API contract. If a call starts failing unexpectedly, say so plainly rather than
guessing at a fix; check the parent repo's issues for known breakage before assuming user error.
