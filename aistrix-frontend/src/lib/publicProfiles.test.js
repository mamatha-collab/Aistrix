import { describe, expect, it, vi } from 'vitest'
import { loadPublicProfiles, savePublicProfile } from './publicProfiles'

function clientWith(...results) {
  const selections = []
  const client = { from: vi.fn(() => ({ select: columns => {
    selections.push(columns)
    return { in: async () => results.shift() }
  } })) }
  return { client, selections }
}

describe('public profile schema compatibility', () => {
  it('preserves optional profile fields when installed', async () => {
    const profile = { user_id: 'dev', display_name: 'Name', github: 'developer' }
    const { client } = clientWith({ data: [profile], error: null })
    expect(await loadPublicProfiles(client, ['dev'])).toEqual([profile])
    expect(client.from).toHaveBeenCalledOnce()
  })
  it('uses only baseline public fields when an optional column is missing', async () => {
    const { client, selections } = clientWith(
      { error: { code: '42703', message: 'column developer_profiles.github does not exist' } },
      { data: [{ user_id: 'dev', display_name: 'Name' }], error: null },
    )
    expect(await loadPublicProfiles(client, ['dev'])).toEqual([{ user_id: 'dev', display_name: 'Name' }])
    expect(selections[1]).toBe('user_id,display_name,bio,website')
    expect(selections.join(',')).not.toMatch(/stripe|earnings|encrypted/)
  })
  it('does not hide permission errors or retry with broader privileges', async () => {
    const { client } = clientWith({ error: { code: '42501', message: 'permission denied' } })
    await expect(loadPublicProfiles(client, ['dev'])).rejects.toThrow('temporarily unavailable')
    expect(client.from).toHaveBeenCalledOnce()
  })
  it('falls back to the existing RLS-protected table only when the new view is absent', async () => {
    const { client } = clientWith(
      { error: { code: 'PGRST205', message: 'Could not find public_developer_profiles' } },
      { error: { code: '42703', message: 'column developer_profiles.github does not exist' } },
      { data: [], error: null },
    )
    expect(await loadPublicProfiles(client, ['dev'])).toEqual([])
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(['public_developer_profiles', 'developer_profiles', 'developer_profiles'])
  })
})

describe('profile saving across schema rollout', () => {
  function writer() {
    const upsert = vi.fn()
      .mockResolvedValueOnce({ error: { code: 'PGRST204', message: 'Could not find the github column' } })
      .mockResolvedValueOnce({ error: null })
    return { client: { from: () => ({ upsert }) }, upsert }
  }
  it('can save baseline profile data when unsupported optional fields are empty', async () => {
    const { client, upsert } = writer()
    await savePublicProfile(client, 'dev', { display_name: ' Name ', bio: 'Bio', website: '' })
    expect(upsert.mock.calls[1][0]).toEqual({ user_id: 'dev', display_name: 'Name', bio: 'Bio', website: null })
  })
  it('never silently drops a requested avatar or social link', async () => {
    const { client, upsert } = writer()
    await expect(savePublicProfile(client, 'dev', { display_name: 'Name', github: 'developer' })).rejects.toThrow('have not been saved')
    expect(upsert).toHaveBeenCalledOnce()
  })
})
