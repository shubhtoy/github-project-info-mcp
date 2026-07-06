/**
 * Browser-safe client for calling GitHub Projects data through a CORS proxy.
 *
 * The raw GitHub endpoints this library depends on for user-owned projects (the board-page
 * scrape, the memex per-item endpoint) send no `Access-Control-Allow-Origin` header, so a
 * browser can't call them directly — see docs/investigation.md. Something has to sit between
 * the browser and GitHub to add that header.
 *
 * Two ways to get that:
 *   1. Default, zero-setup: route through a free public CORS proxy (AllOrigins). No account,
 *      no deploy, works immediately. Tradeoff: third-party dependency, rate-limited, uptime
 *      not guaranteed — fine for prototyping or low-traffic pages, not for anything you need
 *      to be reliable.
 *   2. Self-hosted, more reliable: deploy `src/worker.ts` to your own Cloudflare account (free
 *      tier, ~5 min, see README "Deployment") and pass its URL as `workerBaseUrl` below.
 *      Recommended for anything beyond quick testing.
 */

const DEFAULT_CORS_PROXY = 'https://api.allorigins.win/raw?url='
const GITHUB_WEB = 'https://github.com'

export interface BrowserClientOptions {
  /**
   * Base URL of your own deployed src/worker.ts instance (e.g.
   * "https://github-project-info-api.your-name.workers.dev"). When set, calls go directly to
   * your Worker instead of through the public CORS proxy — more reliable, no third-party
   * dependency. Omit to use the free public proxy default.
   */
  workerBaseUrl?: string
  /**
   * Override the public CORS proxy URL prefix. Only used when workerBaseUrl is not set.
   * Defaults to AllOrigins (api.allorigins.win). The URL to proxy is appended and
   * URL-encoded automatically.
   */
  corsProxyUrl?: string
}

function proxiedFetch(targetUrl: string, options: BrowserClientOptions): Promise<Response> {
  const proxyPrefix = options.corsProxyUrl ?? DEFAULT_CORS_PROXY
  const url = proxyPrefix + encodeURIComponent(targetUrl)
  return fetch(url)
}

/**
 * Fetch a public project's board page HTML through the default public CORS proxy (or your
 * own Worker, if configured), for client-side parsing. This is the low-level building block;
 * prefer the higher-level helpers (getProjectItemsBrowser, etc.) unless you need raw HTML.
 */
export async function fetchBoardPageViaProxy(
  username: string,
  projectNumber: number,
  options: BrowserClientOptions = {},
): Promise<string> {
  if (options.workerBaseUrl) {
    const res = await fetch(`${options.workerBaseUrl.replace(/\/$/, '')}/projects/${username}/${projectNumber}/items`)
    if (!res.ok) throw new Error(`Worker request failed: ${res.status} ${res.statusText}`)
    return res.text()
  }
  const targetUrl = `${GITHUB_WEB}/users/${encodeURIComponent(username)}/projects/${projectNumber}`
  const res = await proxiedFetch(targetUrl, options)
  if (!res.ok) throw new Error(`CORS proxy request failed: ${res.status} ${res.statusText}`)
  return res.text()
}

/**
 * Browser-friendly: fetch project items for a user-owned project. Uses the public CORS proxy
 * by default (see module docstring), or your own Worker if `workerBaseUrl` is set.
 */
export async function getProjectItemsBrowser(
  username: string,
  projectNumber: number,
  options: BrowserClientOptions = {},
): Promise<unknown> {
  if (options.workerBaseUrl) {
    const res = await fetch(`${options.workerBaseUrl.replace(/\/$/, '')}/projects/${username}/${projectNumber}/items`)
    if (!res.ok) throw new Error(`Worker request failed: ${res.status} ${res.statusText}`)
    return res.json()
  }
  const html = await fetchBoardPageViaProxy(username, projectNumber, options)
  const match = html.match(/<script type="application\/json" id="memex-paginated-items-data">([\s\S]*?)<\/script>/)
  if (!match) {
    throw new Error('Could not find item data in board page — GitHub may have changed its page structure, or the project has no items')
  }
  return JSON.parse(match[1])
}

/**
 * Browser-friendly: fetch project metadata. This one doesn't need a proxy at all — GitHub's
 * official REST endpoint for project metadata already sends Access-Control-Allow-Origin: *,
 * so it works from a browser directly, no proxy or Worker needed.
 */
export async function getProjectMetadataBrowser(
  ownerType: 'users' | 'orgs',
  owner: string,
  projectNumber: number,
): Promise<unknown> {
  const res = await fetch(`https://api.github.com/${ownerType}/${owner}/projectsV2/${projectNumber}`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub API request failed: ${res.status} ${res.statusText}`)
  return res.json()
}
