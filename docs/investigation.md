# Investigation notes

How the auth gap this library works around was found and confirmed, for anyone auditing or
maintaining this later.

## The gap

GitHub's REST API docs for
["List items for a user owned project"](https://docs.github.com/en/rest/projects/items#list-items-for-a-user-owned-project)
do **not** include the "This endpoint can be used without authentication... if only public
resources are requested" note that appears on the equivalent **org-owned** endpoints
("List items for an organization owned project", etc). This was confirmed live, not just
read from docs:

```
$ curl -s "https://api.github.com/users/{user}/projectsV2/{n}/items" \
    -H "Accept: application/vnd.github+json"
{"message":"Requires authentication","documentation_url":"https://docs.github.com/rest","status":"401"}
```

...on a project that is confirmed public (its metadata endpoint, and its board webpage, both
return 200 with real data, unauthenticated).

## The fallback

GitHub's own web UI needs to render this data somehow without asking a logged-out visitor to
authenticate — because the board page itself is publicly viewable. Inspecting the page (and a
HAR capture of the logged-in UI's own network calls) revealed two things:

1. The board page's HTML embeds the full item list as JSON in
   `<script type="application/json" id="memex-paginated-items-data">`, unauthenticated.
2. The UI also calls a per-item endpoint,
   `GET github.com/memexes/{projectNodeId}/items?memexProjectItemId={id}`, which returns the
   same item shape and also works fully unauthenticated (tested with zero cookies/headers
   beyond `Accept` and `X-Requested-With`).

Both were confirmed to return real data via direct `curl`, no auth, no cookies.

## CORS

Both fallback endpoints return **no** `Access-Control-Allow-Origin` header (confirmed via
`curl -I` with an `Origin` header set). This means they work fine server-side (this library,
any backend, an MCP server) but will be blocked by browsers if called directly from
client-side JavaScript on a different origin. GitHub's official REST API endpoints (like the
metadata endpoint) *do* send `Access-Control-Allow-Origin: *` and work fine from a browser.

## Why not just move the project to an org?

GitHub Projects (v2) have no built-in transfer between a user account and an organization in
either direction. The only third-party tool found
([`timrogers/gh-migrate-project`](https://github.com/timrogers/gh-migrate-project))
*duplicates* a project rather than moving it — new project number, new item IDs, breaks
existing links. For an already-established project, that's a bigger, riskier change than
building this workaround.

## Stability

None of this is documented or supported by GitHub. It works today (checked against GitHub's
API as of the dates in this repo's commit history). If it stops working, it's most likely
because GitHub changed the board page's markup or retired the internal endpoint — check for an
updated `id` attribute on the embedded script tag, or watch for GitHub publishing an official
unauthenticated items API for user-owned projects (which would make this whole library
unnecessary for that case).
