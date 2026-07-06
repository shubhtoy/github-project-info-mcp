/**
 * Client for reading public GitHub Projects (v2) data without authentication.
 *
 * GitHub's official REST API for Projects v2 has an authentication gap: item-level data
 * (status, custom fields, labels) is unauthenticated only for ORG-owned projects. For
 * USER-owned projects, `GET /users/{user}/projectsV2/{n}/items` returns 401 even when the
 * project itself is public — confirmed live, not just from docs. Metadata-only reads
 * (title, state, dates) DO work unauthenticated for both owner types.
 *
 * This client fills that gap for user-owned projects using a public, unauthenticated
 * fallback: GitHub's project board page embeds full item data as JSON in a
 * `<script id="memex-paginated-items-data">` tag, and a sibling endpoint
 * (`github.com/memexes/{projectNodeId}/items?memexProjectItemId={id}`) returns the same
 * shape per-item. Both are undocumented, unofficial, and not part of GitHub's supported
 * API surface — they can change or disappear without notice. Prefer the official REST
 * paths whenever they apply; only fall back to these for the specific user-owned-items gap.
 */

const GITHUB_API = 'https://api.github.com'
const GITHUB_WEB = 'https://github.com'

export interface ProjectMetadata {
  id: number
  nodeId: string
  title: string
  description: string | null
  public: boolean
  state: string
  number: number
  ownerLogin: string
  createdAt: string
  updatedAt: string
  closedAt: string | null
}

export interface ProjectFieldValue {
  name: string
  dataType: string
  value: unknown
}

export interface ProjectItem {
  id: number
  contentId: number
  contentType: string
  state: string
  title: string | null
  issueNumber: number | null
  url: string | null
  updatedAt: string
  createdAt: string
  closedAt: string | null
  fields: ProjectFieldValue[]
}

export interface ListItemsResult {
  items: ProjectItem[]
  totalCount: number
  hasMore: boolean
  source: 'rest' | 'board-scrape'
}

export class GitHubProjectNotFoundError extends Error {
  constructor(owner: string, projectNumber: number) {
    super(`Project ${projectNumber} not found for owner "${owner}", or it is private`)
    this.name = 'GitHubProjectNotFoundError'
  }
}

export class GitHubProjectItemsUnavailableError extends Error {
  constructor(owner: string, projectNumber: number, reason: string) {
    super(
      `Could not read items for ${owner}'s project ${projectNumber}: ${reason}. ` +
        `This can happen if the project is private, has no items, or GitHub changed ` +
        `the internal page structure this library depends on for user-owned projects.`,
    )
    this.name = 'GitHubProjectItemsUnavailableError'
  }
}

export interface ProjectField {
  id: string
  databaseId: number
  name: string
  dataType: string
  visible: boolean
  options: { id: string; name: string; color: string; description: string | null }[] | null
}

export interface ProjectView {
  id: number
  number: number
  name: string
  layout: string
}

/**
 * Fetch a public project's field definitions (including single-select option ID→name
 * mappings) and saved views, by reading the same embedded data the board page uses to
 * render itself. UNOFFICIAL / UNDOCUMENTED, same caveats as listItemsViaBoardScrape below —
 * this is what lets item field values (like a Status option ID) be resolved to human-readable
 * names without hardcoding option IDs per-project.
 */
export async function getProjectFieldsAndViews(
  username: string,
  projectNumber: number,
): Promise<{ fields: ProjectField[]; views: ProjectView[] }> {
  const html = await fetchBoardPageHtml(username, projectNumber)
  const columnsRaw = extractEmbeddedJson(html, 'memex-columns-data') ?? []
  const viewsRaw = extractEmbeddedJson(html, 'memex-views') ?? []
  const fields: ProjectField[] = columnsRaw.map((c: any) => ({
    id: c.id,
    databaseId: c.databaseId,
    name: c.name,
    dataType: c.dataType,
    visible: c.visible,
    options: c.settings?.options?.map((o: any) => ({
      id: o.id,
      name: o.name,
      color: o.color,
      description: o.description ?? null,
    })) ?? null,
  }))
  const views: ProjectView[] = viewsRaw.map((v: any) => ({
    id: v.id,
    number: v.number,
    name: v.name,
    layout: v.layout,
  }))
  return { fields, views }
}

function extractEmbeddedJson(html: string, scriptId: string): any {
  const re = new RegExp(`<script type="application/json" id="${scriptId}">([\\s\\S]*?)</script>`)
  const match = html.match(re)
  if (!match) return null
  try {
    return JSON.parse(match[1])
  } catch {
    return null
  }
}

async function fetchBoardPageHtml(username: string, projectNumber: number): Promise<string> {
  const url = `${GITHUB_WEB}/users/${encodeURIComponent(username)}/projects/${projectNumber}`
  const res = await fetch(url, { headers: { 'User-Agent': 'github-project-info-mcp' } })
  if (!res.ok) {
    throw new GitHubProjectItemsUnavailableError(username, projectNumber, `board page returned ${res.status}`)
  }
  return res.text()
}

/**
 * Resolve single-select field values (which are option IDs, not names) to their human
 * -readable names/colors using field definitions from getProjectFieldsAndViews. Mutates
 * nothing; returns new field values with `value.name`/`value.color` filled in where possible.
 */
export function resolveFieldOptionNames(items: ProjectItem[], fields: ProjectField[]): ProjectItem[] {
  const optionsByFieldName = new Map(fields.map(f => [f.name, f.options]))
  return items.map(item => ({
    ...item,
    fields: item.fields.map(f => {
      const options = optionsByFieldName.get(f.name)
      const value = f.value as any
      if (options && value && typeof value === 'object' && 'id' in value) {
        const matched = options.find(o => o.id === value.id)
        if (matched) {
          return { ...f, value: { ...value, name: matched.name, color: matched.color } }
        }
      }
      return f
    }),
  }))
}

export interface UserProjectSummary {
  databaseId: number
  number: number
  title: string
  updatedAt: string
  url: string
}

/**
 * List all public projects owned by a user, by reading their profile page's Projects tab.
 * There is no official REST/GraphQL/Search API for enumerating a user's projects — GitHub's
 * Search API has no `type:project` (or equivalent) qualifier at all, confirmed against
 * GitHub's own search docs, which only cover code/commits/issues/labels/repos/topics/users.
 * This is a plain HTML scrape of server-rendered project cards (no embedded JSON payload
 * involved, unlike the board page) — see docs/investigation.md.
 *
 * UNOFFICIAL / UNDOCUMENTED, same caveats as the other fallback methods in this module.
 */
export async function listUserProjects(username: string): Promise<UserProjectSummary[]> {
  const url = `${GITHUB_WEB}/${encodeURIComponent(username)}?tab=projects&query=${encodeURIComponent('is:open sort:updated-desc')}`
  const res = await fetch(url, { headers: { 'User-Agent': 'github-project-info-mcp' } })
  if (!res.ok) {
    throw new Error(`Failed to list projects for ${username}: ${res.status} ${res.statusText}`)
  }
  const html = await res.text()
  const cardRe =
    /id="project_(\d+)"\s+href="\/users\/[^/]+\/projects\/(\d+)"[^>]*>([^<]*)<\/a>[\s\S]{0,400}?datetime="([^"]+)"/g
  const results: UserProjectSummary[] = []
  let match: RegExpExecArray | null
  while ((match = cardRe.exec(html)) !== null) {
    const [, databaseId, number, title, updatedAt] = match
    results.push({
      databaseId: Number(databaseId),
      number: Number(number),
      title: title.trim(),
      updatedAt,
      url: `${GITHUB_WEB}/users/${username}/projects/${number}`,
    })
  }
  return results
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'github-project-info-mcp',
      // Optional: if GITHUB_TOKEN is set in the environment (e.g. CI's automatic token),
      // authenticate this specific request to raise GitHub's rate limit from 60/hr to
      // 5000/hr. This ONLY applies to fetchJson, used by the official REST metadata/items
      // endpoints — never added to the board-scrape or memex fallback functions below, since
      // proving those work fully unauthenticated is the entire point of this library and
      // silently authenticating them would mask a real regression if GitHub ever locks them
      // down. Never required for normal (non-CI) use — everything works unauthenticated.
      ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      ...(init?.headers ?? {}),
    },
  })
  if (!res.ok) {
    throw new Error(`GitHub request failed: ${res.status} ${res.statusText} (${url})`)
  }
  return (await res.json()) as T
}

/**
 * Fetch project metadata (title, description, state, dates) for a project owned by a user
 * or organization. Works unauthenticated for public projects, per GitHub's official REST API.
 */
export async function getProjectMetadata(
  ownerType: 'users' | 'orgs',
  owner: string,
  projectNumber: number,
): Promise<ProjectMetadata> {
  const url = `${GITHUB_API}/${ownerType}/${owner}/projectsV2/${projectNumber}`
  let raw: any
  try {
    raw = await fetchJson<any>(url)
  } catch {
    throw new GitHubProjectNotFoundError(owner, projectNumber)
  }
  return {
    id: raw.id,
    nodeId: raw.node_id,
    title: raw.title,
    description: raw.description,
    public: raw.public,
    state: raw.state,
    number: raw.number,
    ownerLogin: raw.owner?.login ?? owner,
    createdAt: raw.created_at,
    updatedAt: raw.updated_at,
    closedAt: raw.closed_at,
  }
}

/**
 * Fetch full item-level data for an org-owned project via GitHub's official, documented
 * REST endpoint. This endpoint is unauthenticated for public org projects per GitHub's docs.
 */
async function listItemsViaRest(org: string, projectNumber: number): Promise<ListItemsResult> {
  const url = `${GITHUB_API}/orgs/${org}/projectsV2/${projectNumber}/items?per_page=100`
  const raw = await fetchJson<any[]>(url)
  const items: ProjectItem[] = raw.map(mapRestItem)
  return { items, totalCount: items.length, hasMore: false, source: 'rest' }
}

function mapRestItem(raw: any): ProjectItem {
  const titleField = (raw.fields ?? []).find((f: any) => f.name === 'Title')
  return {
    id: raw.id,
    contentId: raw.content?.id ?? 0,
    contentType: raw.content_type ?? 'Issue',
    state: raw.content?.state ?? 'unknown',
    title: titleField?.value?.raw ?? raw.content?.title ?? null,
    issueNumber: titleField?.value?.number ?? null,
    url: titleField?.value?.url ?? raw.content?.html_url ?? null,
    updatedAt: raw.updated_at,
    createdAt: raw.created_at,
    closedAt: raw.closed_at ?? null,
    fields: (raw.fields ?? []).map((f: any) => ({
      name: f.name,
      dataType: f.data_type,
      value: f.value,
    })),
  }
}

/**
 * Fetch full item-level data for a USER-owned project by scraping the public board page's
 * embedded JSON. Fallback used only because GitHub's official REST API returns 401 for
 * user-owned project items even when the project is public — see module docstring.
 *
 * UNOFFICIAL / UNDOCUMENTED: relies on GitHub's page markup
 * (`<script id="memex-paginated-items-data">`), not a published API contract.
 */
async function listItemsViaBoardScrape(username: string, projectNumber: number): Promise<ListItemsResult> {
  const html = await fetchBoardPageHtml(username, projectNumber)
  const parsed = extractEmbeddedJson(html, 'memex-paginated-items-data')
  if (!parsed) {
    throw new GitHubProjectItemsUnavailableError(
      username,
      projectNumber,
      'expected data script tag not found or failed to parse',
    )
  }
  const nodes: any[] = parsed.nodes ?? []
  let items = nodes.map(mapMemexItem)

  const columnsRaw = extractEmbeddedJson(html, 'memex-columns-data')
  if (columnsRaw) {
    const fields: ProjectField[] = columnsRaw.map((c: any) => ({
      id: c.id,
      databaseId: c.databaseId,
      name: c.name,
      dataType: c.dataType,
      visible: c.visible,
      options:
        c.settings?.options?.map((o: any) => ({
          id: o.id,
          name: o.name,
          color: o.color,
          description: o.description ?? null,
        })) ?? null,
    }))
    items = resolveFieldOptionNames(items, fields)
  }

  const totalCount = parsed.totalCount?.value ?? items.length
  const hasMore = Boolean(parsed.pageInfo?.hasNextPage)
  return { items, totalCount, hasMore, source: 'board-scrape' }
}

function mapMemexItem(node: any): ProjectItem {
  const cols: any[] = node.memexProjectColumnValues ?? []
  const titleCol = cols.find(c => c.memexProjectColumnId === 'Title')
  const fields: ProjectFieldValue[] = cols
    .filter(c => typeof c.memexProjectColumnId === 'string')
    .map(c => ({
      name: c.memexProjectColumnId,
      dataType: typeof c.value,
      value: c.value,
    }))
  return {
    id: node.id,
    contentId: node.contentId,
    contentType: node.contentType ?? 'Issue',
    state: node.state ?? 'unknown',
    title: titleCol?.value?.title?.raw ?? null,
    issueNumber: titleCol?.value?.number ?? null,
    url: titleCol?.value?.url ?? null,
    updatedAt: node.updatedAt,
    createdAt: node.createdAt,
    closedAt: node.issueClosedAt ?? null,
    fields,
  }
}

/**
 * List all items in a public project, automatically choosing the right strategy:
 * - Org-owned: official REST API (documented, unauthenticated for public projects).
 * - User-owned: board-page scrape fallback (unofficial, see module docstring), because
 *   the official REST API for user-owned project items requires auth even when public.
 */
export async function listProjectItems(
  ownerType: 'users' | 'orgs',
  owner: string,
  projectNumber: number,
): Promise<ListItemsResult> {
  if (ownerType === 'orgs') {
    return listItemsViaRest(owner, projectNumber)
  }
  return listItemsViaBoardScrape(owner, projectNumber)
}

/**
 * Fetch a single item's full field data via GitHub's undocumented per-item endpoint.
 * Works for public projects of either owner type, unauthenticated. Requires the project's
 * plain numeric database ID (from `getProjectMetadata().id` — NOT `.nodeId`, which is the
 * GraphQL node ID and does not work with this endpoint, confirmed by testing both) and the
 * item's numeric ID (from `listProjectItems()`).
 *
 * UNOFFICIAL / UNDOCUMENTED: this is an internal endpoint used by GitHub's own web UI,
 * not a published API. It may change or be removed without notice.
 */
export async function getProjectItem(projectId: number, itemId: number): Promise<ProjectItem> {
  const url = `${GITHUB_WEB}/memexes/${projectId}/items?memexProjectItemId=${itemId}`
  const res = await fetch(url, {
    headers: {
      Accept: 'application/json',
      'X-Requested-With': 'XMLHttpRequest',
      'User-Agent': 'github-project-info-mcp',
    },
  })
  if (!res.ok) {
    throw new Error(`Failed to fetch project item ${itemId}: ${res.status} ${res.statusText}`)
  }
  const raw = await res.json() as any
  const item = raw.memexProjectItem
  if (!item) {
    throw new Error(`Unexpected response shape for project item ${itemId}`)
  }
  return mapMemexItem(item)
}
