/**
 * Cloudflare Worker exposing github-project-info-mcp's client functions as a small,
 * CORS-enabled HTTP API. This exists because the underlying GitHub endpoints this library
 * calls (the board-page scrape, the memex per-item endpoint) send no
 * `Access-Control-Allow-Origin` header, so a browser can't call them directly — see
 * docs/investigation.md. This Worker runs server-side (Cloudflare's edge, not the browser)
 * and adds the CORS header itself, so a frontend can safely call *this* instead.
 *
 * Deploy: `npx wrangler deploy` (see wrangler.toml).
 *
 * Routes:
 *   GET /projects/:owner/:number/metadata?ownerType=user|org
 *   GET /projects/:owner/:number/items?ownerType=user|org
 *   GET /projects/:owner/:number/fields
 *   GET /users/:username/projects
 */

import {
  getProjectMetadata,
  listProjectItems,
  getProjectFieldsAndViews,
  listUserProjects,
} from './github-projects-client.js'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
  })
}

function errorResponse(err: unknown): Response {
  const message = err instanceof Error ? err.message : String(err)
  return json({ error: message }, 502)
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS })
    }

    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    try {
      // /users/:username/projects
      if (parts[0] === 'users' && parts[2] === 'projects' && parts.length === 3) {
        const projects = await listUserProjects(parts[1])
        return json(projects)
      }

      // /projects/:owner/:number/metadata|items|fields
      if (parts[0] === 'projects' && parts.length === 4) {
        const [, owner, numberStr, resource] = parts
        const projectNumber = Number(numberStr)
        const ownerTypeParam = url.searchParams.get('ownerType') === 'org' ? 'orgs' : 'users'

        if (resource === 'metadata') {
          return json(await getProjectMetadata(ownerTypeParam, owner, projectNumber))
        }
        if (resource === 'items') {
          return json(await listProjectItems(ownerTypeParam, owner, projectNumber))
        }
        if (resource === 'fields') {
          return json(await getProjectFieldsAndViews(owner, projectNumber))
        }
      }

      return json({ error: 'Not found. See README for valid routes.' }, 404)
    } catch (err) {
      return errorResponse(err)
    }
  },
}
