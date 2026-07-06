import { describe, it, expect } from 'vitest'
import { getProjectMetadata, listProjectItems, getProjectItem } from '../src/github-projects-client.js'

// These tests hit the real, live, public GitHub API and a public GitHub project
// (shubhtoy/AgentFlow, project #4) — no auth, no mocking. This is intentional: the whole
// point of this library is verifying behavior against GitHub's actual current API surface,
// including the undocumented fallback paths, which cannot be meaningfully mocked without
// hiding exactly the kind of breakage (GitHub changing page structure) this is meant to catch.

const TEST_OWNER = 'shubhtoy'
const TEST_PROJECT_NUMBER = 4

describe('getProjectMetadata', () => {
  it('fetches metadata for a public user-owned project without auth', async () => {
    const metadata = await getProjectMetadata('users', TEST_OWNER, TEST_PROJECT_NUMBER)
    expect(metadata.title).toBe('AgentFlow')
    expect(metadata.public).toBe(true)
    expect(metadata.number).toBe(TEST_PROJECT_NUMBER)
    expect(metadata.nodeId).toMatch(/^PVT_/)
  })
})

describe('listProjectItems', () => {
  it('lists items for a public user-owned project via the board-scrape fallback', async () => {
    const result = await listProjectItems('users', TEST_OWNER, TEST_PROJECT_NUMBER)
    expect(result.source).toBe('board-scrape')
    expect(result.items.length).toBeGreaterThan(0)
    expect(result.totalCount).toBeGreaterThanOrEqual(result.items.length)

    const first = result.items[0]
    expect(first).toHaveProperty('id')
    expect(first).toHaveProperty('title')
    expect(first).toHaveProperty('fields')
    expect(Array.isArray(first.fields)).toBe(true)
  })
})

describe('getProjectItem', () => {
  it('fetches a single item by project numeric ID and item ID', async () => {
    const metadata = await getProjectMetadata('users', TEST_OWNER, TEST_PROJECT_NUMBER)
    const { items } = await listProjectItems('users', TEST_OWNER, TEST_PROJECT_NUMBER)
    const targetItem = items[0]

    const item = await getProjectItem(metadata.id, targetItem.id)
    expect(item.id).toBe(targetItem.id)
    expect(item.title).toBe(targetItem.title)
    expect(item.fields.length).toBeGreaterThan(0)
  })
})
