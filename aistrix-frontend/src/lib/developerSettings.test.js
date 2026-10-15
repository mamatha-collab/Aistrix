import { describe, expect, it } from 'vitest'
import { saveDeveloperSetting } from './developerSettings'

function fakeClient({ stored, readError = null, writeError = null }) {
  const writes = []
  return {
    writes,
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored === undefined ? null : { settings: stored }, error: readError }) }) }),
      upsert: async row => { writes.push(row); return { error: writeError } },
    }),
  }
}

describe('saveDeveloperSetting', () => {
  it('keeps the other saved integrations', async () => {
    const client = fakeClient({ stored: { github: { token: 'gh' }, sentry: { dsn: 'old' } } })
    const merged = await saveDeveloperSetting(client, 'u1', 'sentry', { dsn: 'new' })
    expect(merged).toEqual({ github: { token: 'gh' }, sentry: { dsn: 'new' } })
    expect(client.writes[0].settings.github).toEqual({ token: 'gh' })
  })

  it('creates the settings on the first save', async () => {
    const client = fakeClient({ stored: undefined })
    expect(await saveDeveloperSetting(client, 'u1', 'stripe', { key: 'pk' })).toEqual({ stripe: { key: 'pk' } })
  })

  it('saves nothing when the saved settings cannot be read', async () => {
    const client = fakeClient({ stored: { github: { token: 'gh' } }, readError: { message: 'network down' } })
    await expect(saveDeveloperSetting(client, 'u1', 'sentry', {})).rejects.toThrow(/nothing was saved/)
    expect(client.writes).toEqual([])
  })

  it('reports a failed write', async () => {
    const client = fakeClient({ stored: {}, writeError: { message: 'denied' } })
    await expect(saveDeveloperSetting(client, 'u1', 'sentry', {})).rejects.toMatchObject({ message: 'denied' })
  })
})
