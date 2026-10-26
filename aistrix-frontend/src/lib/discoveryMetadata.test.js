import { beforeEach, describe, expect, it, vi } from 'vitest'
const catalog = vi.hoisted(() => vi.fn())
vi.mock('../server/catalog', () => ({ getPublicCatalog: catalog }))
import sitemap from '../app/sitemap'
import robots from '../app/robots'
import { requiresWorkspaceSession } from './workspaceRoutes'

beforeEach(() => vi.stubEnv('NEXT_PUBLIC_BRAND_DOMAIN', 'aistrix.example'))

describe('public discovery metadata', () => {
  it('publishes only public app/profile URLs and deduplicates developers', async () => {
    const id = '00000000-0000-4000-8000-000000000101'
    const owner = '00000000-0000-4000-8000-000000000201'
    catalog.mockResolvedValue([
      { app_id: id, apps: { created_by: owner, is_published: true, visibility: 'public' } },
      { app_id: id, apps: { created_by: owner, is_published: true, visibility: 'public' } },
      { app_id: 'private', apps: { is_published: true, visibility: 'private' } },
      { app_id: 'unpublished', apps: { is_published: false, visibility: 'public' } },
    ])
    const urls = (await sitemap()).map(row => row.url)
    expect(urls).toHaveLength(5)
    expect(urls).toContain(`https://aistrix.example/marketplace/${id}`)
    expect(urls).toContain(`https://aistrix.example/dev/${owner}`)
    expect(urls.join()).not.toMatch(/private|unpublished|settings/)
  })
  it('keeps metadata public while discouraging private-route indexing', () => {
    expect(requiresWorkspaceSession('/robots.txt')).toBe(false)
    expect(requiresWorkspaceSession('/sitemap.xml')).toBe(false)
    expect(robots().sitemap).toBe('https://aistrix.example/sitemap.xml')
    expect(robots().rules.disallow).toContain('/developer')
  })
})
