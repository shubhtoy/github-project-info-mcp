/**
 * Remote MCP server entry point for Cloudflare Workers, using the `agents` package's
 * `createMcpHandler()` — the stateless option (our tools are all pure reads, no per-session
 * state needed, so this is a better fit than the Durable-Object-backed `McpAgent` class).
 *
 * This is a genuinely different deployable from src/worker.ts (the plain CORS-proxying HTTP
 * API): this one speaks the actual MCP protocol over Streamable HTTP, so MCP clients can
 * connect to it directly as a remote server — no local `node dist/index.js` process needed.
 *
 * Deploy: `npx wrangler deploy -c wrangler.mcp.toml`
 * Connect: point any MCP client at `https://<your-worker>.workers.dev/mcp`
 *
 * Per the installed `agents` package's actual implementation (createMcpHandler expects an
 * already-constructed McpServer instance, not a configurator callback, and creates a fresh
 * transport per call since this is a stateless/no-Durable-Object handler) a new McpServer +
 * tool registration happens on every request. This is cheap (tools are just closures over
 * already-imported functions) and required — the handler throws if a server instance is
 * reused across requests ("Create a new McpServer instance per request for stateless handlers").
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { createMcpHandler } from 'agents/mcp'
import { z } from 'zod'
import {
  getProjectMetadata,
  listProjectItems,
  getProjectItem,
  getProjectFieldsAndViews,
  listUserProjects,
} from './github-projects-client.js'

const ownerTypeSchema = z.enum(['user', 'org'])

function buildServer(): McpServer {
  const server = new McpServer({ name: 'github-project-info-mcp', version: '0.1.0' })

  server.tool(
    'get_project_metadata',
    'Get metadata (title, description, state, dates) for a public GitHub Projects (v2) board.',
    {
      ownerType: ownerTypeSchema,
      owner: z.string(),
      projectNumber: z.number().int().positive(),
    },
    async ({ ownerType, owner, projectNumber }) => {
      const metadata = await getProjectMetadata(ownerType === 'org' ? 'orgs' : 'users', owner, projectNumber)
      return { content: [{ type: 'text', text: JSON.stringify(metadata, null, 2) }] }
    },
  )

  server.tool(
    'list_project_items',
    'List all items in a public GitHub Projects (v2) board, including status and fields.',
    {
      ownerType: ownerTypeSchema,
      owner: z.string(),
      projectNumber: z.number().int().positive(),
    },
    async ({ ownerType, owner, projectNumber }) => {
      const result = await listProjectItems(ownerType === 'org' ? 'orgs' : 'users', owner, projectNumber)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'get_project_item',
    "Get full field data for a single item, using the project's numeric ID (from " +
      'get_project_metadata\'s `id` field, not `nodeId`) and item ID.',
    {
      projectId: z.number().int().positive(),
      itemId: z.number().int().positive(),
    },
    async ({ projectId, itemId }) => {
      const item = await getProjectItem(projectId, itemId)
      return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] }
    },
  )

  server.tool(
    'get_project_fields',
    "Get a user-owned project's field/status option definitions and saved views.",
    {
      owner: z.string(),
      projectNumber: z.number().int().positive(),
    },
    async ({ owner, projectNumber }) => {
      const result = await getProjectFieldsAndViews(owner, projectNumber)
      return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
    },
  )

  server.tool(
    'list_user_projects',
    'List all public GitHub Projects (v2) boards owned by a user account.',
    { username: z.string() },
    async ({ username }) => {
      const projects = await listUserProjects(username)
      return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] }
    },
  )

  return server
}

export default {
  fetch(request: Request, env: unknown, ctx: ExecutionContext) {
    // A fresh McpServer per request — required by createMcpHandler's stateless contract
    // (it throws if the same server instance is connected to a transport twice).
    const handler = createMcpHandler(buildServer(), { route: '/mcp' })
    return handler(request, env, ctx)
  },
}
