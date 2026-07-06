#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import {
  getProjectMetadata,
  listProjectItems,
  getProjectItem,
  getProjectFieldsAndViews,
  listUserProjects,
} from './github-projects-client.js'

const server = new McpServer({
  name: 'github-project-info-mcp',
  version: '0.1.0',
})

const ownerTypeSchema = z
  .enum(['user', 'org'])
  .describe('Whether the project is owned by a personal GitHub user account or an organization')

server.tool(
  'get_project_metadata',
  'Get metadata (title, description, state, dates) for a public GitHub Projects (v2) board. ' +
    'Works unauthenticated for both user-owned and org-owned public projects.',
  {
    ownerType: ownerTypeSchema,
    owner: z.string().describe('GitHub username or organization name that owns the project'),
    projectNumber: z.number().int().positive().describe('The project number, e.g. 4 for .../projects/4'),
  },
  async ({ ownerType, owner, projectNumber }) => {
    const metadata = await getProjectMetadata(ownerType === 'org' ? 'orgs' : 'users', owner, projectNumber)
    return { content: [{ type: 'text', text: JSON.stringify(metadata, null, 2) }] }
  },
)

server.tool(
  'list_project_items',
  'List all items (issues/PRs/draft issues) in a public GitHub Projects (v2) board, including ' +
    'their status, custom field values, and other metadata. For org-owned projects this uses ' +
    "GitHub's official REST API. For user-owned projects, GitHub's official API requires " +
    'authentication even for public projects, so this falls back to reading the public board ' +
    "page's embedded data — an unofficial method that could break if GitHub changes its page " +
    'structure.',
  {
    ownerType: ownerTypeSchema,
    owner: z.string().describe('GitHub username or organization name that owns the project'),
    projectNumber: z.number().int().positive().describe('The project number, e.g. 4 for .../projects/4'),
  },
  async ({ ownerType, owner, projectNumber }) => {
    const result = await listProjectItems(ownerType === 'org' ? 'orgs' : 'users', owner, projectNumber)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'get_project_item',
  'Get full field data for a single item in a public GitHub Projects (v2) board. Requires the ' +
    "project's numeric database ID (from get_project_metadata's `id` field — NOT `nodeId`, " +
    'which does not work with this endpoint) and the item\'s numeric ID (from ' +
    'list_project_items). Uses an unofficial, undocumented GitHub endpoint — works today for ' +
    'public projects but is not a published API contract.',
  {
    projectId: z.number().int().positive().describe('The project\'s numeric database ID, from get_project_metadata\'s `id` field'),
    itemId: z.number().int().positive().describe('The numeric item ID, from list_project_items'),
  },
  async ({ projectId, itemId }) => {
    const item = await getProjectItem(projectId, itemId)
    return { content: [{ type: 'text', text: JSON.stringify(item, null, 2) }] }
  },
)

server.tool(
  'get_project_fields',
  "Get a public GitHub Projects (v2) board's field definitions — including single-select " +
    'field option names/colors (e.g. Status: Todo/In Progress/Done) and saved views. Useful ' +
    'for resolving the option IDs found in list_project_items results to human-readable names. ' +
    'Currently only supported for user-owned projects (uses the same board-page data source ' +
    'as list_project_items for those).',
  {
    owner: z.string().describe('GitHub username that owns the project'),
    projectNumber: z.number().int().positive().describe('The project number, e.g. 4 for .../projects/4'),
  },
  async ({ owner, projectNumber }) => {
    const result = await getProjectFieldsAndViews(owner, projectNumber)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }
  },
)

server.tool(
  'list_user_projects',
  'List all public GitHub Projects (v2) boards owned by a user account. There is no official ' +
    "GitHub API for this (Projects aren't a Search API resource type, and the REST API " +
    'requires already knowing a project number) — this reads the same project list shown on ' +
    "a user's profile page (the Projects tab).",
  {
    username: z.string().describe('GitHub username'),
  },
  async ({ username }) => {
    const projects = await listUserProjects(username)
    return { content: [{ type: 'text', text: JSON.stringify(projects, null, 2) }] }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

main().catch(err => {
  console.error('Fatal error starting github-project-info-mcp:', err)
  process.exit(1)
})
