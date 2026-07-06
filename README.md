# github-project-info-mcp

[![CI](https://github.com/shubhtoy/github-project-info-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/shubhtoy/github-project-info-mcp/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/github-project-info-mcp.svg)](https://www.npmjs.com/package/github-project-info-mcp)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](https://nodejs.org)
[![MCP](https://img.shields.io/badge/MCP-server-purple)](https://modelcontextprotocol.io)

An [MCP](https://modelcontextprotocol.io) server for reading **public GitHub Projects (v2)
boards without authentication** — including item-level data (status, custom fields, story
points) for boards that GitHub's own official API can't read unauthenticated.

**Runs entirely locally via stdio** (`npx -y github-project-info-mcp`, no server, no
Cloudflare, no infrastructure of any kind) — this is the primary, standard way to use it. A
browser client and a self-hostable Cloudflare Worker are also included as **optional extras**
for the specific case of calling this from client-side JavaScript (see
[Browser usage](#browser-usage-no-server-no-deploy-required)); neither is needed for normal
MCP usage and neither is a runtime dependency of the stdio server.

Also ships as an [Agent Skill](./SKILL.md) — see [Skill](#skill) below.

## Why this exists

GitHub's official REST API for Projects v2 has an authentication gap:

| Endpoint | Org-owned project | User-owned project |
|---|---|---|
| Project metadata (title, state, dates) | ✅ unauthenticated for public projects | ✅ unauthenticated for public projects |
| Project **items** (status, fields, points) | ✅ unauthenticated for public projects | ❌ **401, even when the project is public** |

This is confirmed live against GitHub's current API, not just inferred from docs — see
[`docs/investigation.md`](./docs/investigation.md) for the full trail. If your project board
is owned by your **personal GitHub user account** (the common case for solo/personal
projects), there is no official, documented, unauthenticated way to read its items.

This library closes that gap for user-owned projects using a public fallback: the project
board's own webpage embeds full item data as JSON, unauthenticated, for any public project.
This tool reads that instead.

## What's official vs. unofficial

- **`get_project_metadata`** — uses GitHub's official, documented REST API
  (`GET /users|orgs/{owner}/projectsV2/{n}`). Stable, unauthenticated, works for any public project.
- **`list_project_items`** — for **org-owned** projects, uses GitHub's official REST API
  (unauthenticated for public projects, per GitHub's docs). For **user-owned** projects, falls
  back to reading the public board page's embedded JSON (`<script id="memex-paginated-items-data">`).
  This fallback is **undocumented and unofficial** — it depends on GitHub's current page markup,
  not a published API contract, and could break without notice if GitHub changes it.
- **`get_project_item`** — fetches a single item via an internal endpoint GitHub's own web UI
  uses (`github.com/memexes/{projectId}/items`). Returns **every field on the project**,
  including custom fields (Priority, Story Points) that the bulk `list_project_items` above
  can't see. Also **undocumented and unofficial**, same caveats as above.

Use this if you need it and understand the tradeoff. If GitHub ever publishes an official
unauthenticated items API for user-owned projects, switch to that instead — this project
would then be unnecessary for that use case.

## Installation

**As an MCP server (standard path)**: the conventional way to distribute and run an MCP
server is via npm + `npx`, so it can be launched with no manual clone/build step:

```bash
npx -y github-project-info-mcp
```

*(Requires the package to be published to npm first — see [Publishing](#publishing-maintainers)
if you're maintaining a fork.)*

**From source** (for development, or to use the library/Worker/browser-client parts):

```bash
git clone https://github.com/shubhtoy/github-project-info-mcp.git
cd github-project-info-mcp
npm install
npm run build
```

## Usage as an MCP server

Add to your MCP client config (Claude Desktop, Kiro, etc.):

```json
{
  "mcpServers": {
    "github-project-info": {
      "command": "npx",
      "args": ["-y", "github-project-info-mcp"]
    }
  }
}
```

Or, running from a local clone instead of the published package:

```json
{
  "mcpServers": {
    "github-project-info": {
      "command": "node",
      "args": ["/path/to/github-project-info-mcp/dist/index.js"]
    }
  }
}
```

### Tools

- **`get_project_metadata(ownerType, owner, projectNumber)`** — project title, description,
  state, dates.
- **`list_project_items(ownerType, owner, projectNumber)`** — all items with their fields
  (status, labels, sub-issue progress, etc — whatever's visible in the board's default view).
  Status/select field values are resolved to human-readable names automatically for
  user-owned projects. Custom fields outside the default view (Priority, Story Points, etc)
  are **not** included here — use `get_project_item` for those.
- **`get_project_item(projectId, itemId, owner?, projectNumber?)`** — single item's full field
  data, **including custom fields** (Priority, Story Points, etc) that `list_project_items`
  doesn't return — confirmed live: the bulk endpoint only reflects the board's active view,
  while this per-item endpoint returns every field defined on the project. Get `projectId`
  from `get_project_metadata`'s `id` field (the plain numeric database ID — NOT `nodeId`, the
  GraphQL node ID, which does not work with this endpoint), and `itemId` from
  `list_project_items`. Pass `owner`/`projectNumber` too to resolve custom field names and
  single-select option names (adds one extra request); omit them to get raw field/option IDs
  instead.
- **`get_project_fields(owner, projectNumber)`** — field definitions for a user-owned
  project, including single-select option names/colors (e.g. Status: Todo/In Progress/Done)
  and saved views.
- **`list_user_projects(username)`** — list all public projects owned by a user account.
  There's no official API for this at all (Projects aren't a GitHub Search API resource
  type); this reads the user's profile page Projects tab.

## Browser usage (no server, no deploy required)

None of the fallback endpoints this library calls send `Access-Control-Allow-Origin`, so a
browser can't call them directly — see [CORS note](#cors-note). `src/browser-client.ts`
solves this with zero setup by default, routing through a free public CORS proxy
([AllOrigins](https://allorigins.win)):

```js
import { getProjectItemsBrowser, getProjectMetadataBrowser } from 'github-project-info-mcp/browser'

const metadata = await getProjectMetadataBrowser('users', 'someuser', 4) // no proxy needed — official API already sends CORS headers
const items = await getProjectItemsBrowser('someuser', 4) // routed through the public proxy by default
```

This works immediately, no account or deploy needed. The tradeoff: you're depending on a
third-party proxy service — it's rate-limited and its uptime isn't guaranteed. Fine for
prototyping, demos, or low-traffic pages.

### Upgrade path: self-hosted Worker (more reliable, still free)

For anything you need to be reliable, deploy your own instance instead — same free tier, but
you own it. See [Deploying your own instance](#deploying-your-own-instance-cloudflare-free)
below for the full steps; once deployed, pass the URL to the browser client instead of using
the default proxy:

```js
const items = await getProjectItemsBrowser('someuser', 4, {
  workerBaseUrl: 'https://your-worker.workers.dev',
})
```

Or call the Worker's HTTP API directly:

```
GET /users/:username/projects
GET /projects/:owner/:number/metadata?ownerType=user|org
GET /projects/:owner/:number/items?ownerType=user|org
GET /projects/:owner/:number/fields
```

No secrets or environment variables are needed for either path — every endpoint involved is
public and unauthenticated by design.

## Skill

This repo also ships [`SKILL.md`](./SKILL.md), following the
[Agent Skills](https://github.com/anthropics/skills) format, so agents (Claude, Kiro, etc.)
that support skills can discover when and how to use this MCP server automatically — install
via [skills.sh](https://skills.sh) (`npx skills add shubhtoy/github-project-info-mcp`) or by
pointing an agent at this repo directly.

## Publishing (maintainers)

Publishing to npm is the standard distribution path for MCP servers — once published, anyone
can run `npx -y github-project-info-mcp` with no clone/build step. To publish a new version:

```bash
npm version patch   # or minor/major — bumps package.json AND creates a local git tag
git push --tags
npm publish
gh release create v$(node -p "require('./package.json').version") --generate-notes
```

`npm version` already creates the git tag; `git push --tags` (or `git push --follow-tags`)
pushes it, and `gh release create` turns it into a GitHub Release with auto-generated notes
from commits since the last tag (edit them afterward for a cleaner summary if needed).

The `files` field in `package.json` is already scoped to ship only `dist/`, `README.md`, and
`LICENSE` — no source, tests, or dev config get published. `prepublishOnly` isn't currently
wired to auto-build; run `npm run build` before publishing, or add that hook if you want it
enforced.

There's also an official [MCP Registry](https://modelcontextprotocol.io/registry) (in preview
as of writing) for centralized discovery across clients — worth publishing there too once this
package is stable, via the `mcp-publisher` CLI.

## (Optional) Deploying your own Cloudflare Worker

Not needed for standard MCP usage — this only matters if you want the browser client to skip
the public proxy dependency (see [Browser usage](#browser-usage-no-server-no-deploy-required)
above), or want a remote (non-stdio) MCP endpoint. Nothing in this section is required to run
the server via `npx github-project-info-mcp` or any normal MCP client config.

A demo instance is deployed for quick testing (not an SLA'd service — it's a personal
Cloudflare account's free tier, could go away or hit rate limits with heavy use; deploy your
own per below for anything you depend on):

- CORS-proxy HTTP API: `https://github-project-info-api.shubhmittal-sm.workers.dev`
- Remote MCP server: `https://github-project-info-mcp.shubhmittal-sm.workers.dev/mcp`

To deploy your own instead:

```bash
npx wrangler login      # one-time, opens a browser to authorize a free Cloudflare account
npm run worker:deploy       # deploys the CORS-proxy HTTP API
npm run mcp-worker:deploy   # deploys the remote MCP server (Streamable HTTP, at /mcp)
```

Both deploy independently to Cloudflare's free tier (100,000 requests/day each, no credit
card required) and print your live `*.workers.dev` URL on success. Test locally first with
`npm run worker:dev` / `npm run mcp-worker:dev` before deploying.

## Usage as a library

```typescript
import { getProjectMetadata, listProjectItems } from 'github-project-info-mcp/client'

const metadata = await getProjectMetadata('users', 'someuser', 4)
const { items } = await listProjectItems('users', 'someuser', 4)
```

## CORS note

Only the fallback endpoints for user-owned project **items** lack CORS headers (the board-page
scrape, the memex per-item endpoint) — that's the whole reason `browser-client.ts` and
`worker.ts` exist; see [Browser usage](#browser-usage-no-server-no-deploy-required) above for
the two ways to work around it. GitHub's official metadata endpoint already sends
`Access-Control-Allow-Origin: *` and needs no proxy.

## Limitations

- Only works for **public** projects. Private projects need real authentication — use
  GitHub's official API/SDK/CLI for those.
- The user-owned-items fallback depends on undocumented GitHub internals and may stop working
  if GitHub changes its page structure. If it breaks, please open an issue — this repo will be
  updated if a fix or better path is found.
- Board-scrape pagination: the board page returns whatever items are in GitHub's default view
  for that project. If a project has items excluded from the default view (e.g. archived, or
  filtered out by a saved view), they won't appear via this path.

## Security

Dependencies are pinned to versions with known `npm audit` advisories patched (checked at the
time of writing — re-run `npm audit` yourself before relying on this in anything sensitive).
Notably `@modelcontextprotocol/sdk` is pinned to `1.29.0`+, which patches a DNS-rebinding-
protection gap (CVE-2025-66414) — that specific advisory affects unauthenticated
`localhost`-bound HTTP servers using the SDK's raw transport classes directly; this repo's
`worker-mcp.ts` runs on Cloudflare Workers (not localhost) via the `agents` package's own
`WorkerTransport`, a different code path, so the advisory's exact preconditions likely don't
apply here — noted for transparency, not as a claim this repo was specifically audited against
it.

## License

MIT
