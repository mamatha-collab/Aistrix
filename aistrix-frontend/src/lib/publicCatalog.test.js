import { describe, expect, it } from 'vitest'
import { PUBLIC_CATALOG_SELECT, publicListing, publicProfile } from './publicCatalog'

describe('server-to-browser catalog projection', () => {
  const row = { id: 'listing', app_id: 'app', title: 'Published app', system_prompt: 'PRIVATE', apps: {
    id: 'app', name: 'Published app', is_published: true, visibility: 'public', system_prompt: 'PRIVATE',
    prod_snapshot: { secret: 'PRIVATE' }, marketplace_listings: [{ title: 'PRIVATE draft' }],
  }, developer_profiles: { user_id: 'developer', display_name: 'Public developer', billing_account: 'PRIVATE' } }
  it('serializes only explicitly public fields, excluding draft relations and private settings', () => {
    const output = publicListing(row)
    expect(output.title).toBe('Published app')
    expect(JSON.stringify(output)).not.toContain('PRIVATE')
    expect(PUBLIC_CATALOG_SELECT).not.toMatch(/system_prompt|prod_snapshot|webhook_url|encrypted/)
  })
  it('denies unpublished and private app rows even if supplied by a broader client', () => {
    expect(publicListing({ ...row, apps: { ...row.apps, is_published: false } })).toBeNull()
    expect(publicListing({ ...row, apps: { ...row.apps, visibility: 'private' } })).toBeNull()
  })
  it('omits private developer fields', () => {
    expect(publicProfile({ user_id: 'dev', display_name: 'Name', stripe_account_id: 'PRIVATE' })).toEqual({ user_id: 'dev', display_name: 'Name' })
  })
})
