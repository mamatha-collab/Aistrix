import { describe, expect, it } from 'vitest'
import { AppConflictError, saveAppFields } from './appFields'

function client(result, { plain = { error: null } } = {}) {
  const calls = { rpc: [], update: [] }
  return {
    calls,
    rpc: async (name, args) => { calls.rpc.push({ name, args }); return result },
    from: () => ({ update: patch => ({ eq: async () => { calls.update.push(patch); return plain } }) }),
  }
}

describe('saveAppFields', () => {
  it('compares only the fields being changed, against what the screen loaded', async () => {
    const c = client({ data: { ok: true }, error: null })
    await saveAppFields(c, { id: 'a1', tone: 'friendly', total_runs: 9 }, { tone: 'concise' })
    expect(c.calls.rpc[0].args).toEqual({ p_app_id: 'a1', p_patch: { tone: 'concise' }, p_expected: { tone: 'friendly' } })
  })

  it('does not compare fields this screen never loaded', async () => {
    const c = client({ data: { ok: true }, error: null })
    await saveAppFields(c, { id: 'a1' }, { webhook_url: 'https://x' })
    expect(c.calls.rpc[0].args.p_expected).toEqual({})
  })

  it("returns a readable conflict with the teammate's values", async () => {
    const c = client({ data: { ok: false, conflicts: ['system_prompt'], current: { system_prompt: 'theirs' } }, error: null })
    const { error } = await saveAppFields(c, { id: 'a1', system_prompt: 'mine-before' }, { system_prompt: 'mine' })
    expect(error).toBeInstanceOf(AppConflictError)
    expect(error.message).toMatch(/Someone else changed the prompt/)
    expect(error.current).toEqual({ system_prompt: 'theirs' })
  })

  it('can save over a known teammate change on purpose', async () => {
    const c = client({ data: { ok: true }, error: null })
    await saveAppFields(c, { id: 'a1', system_prompt: 'old' }, { system_prompt: 'mine' }, { expected: { system_prompt: 'theirs' } })
    expect(c.calls.rpc[0].args.p_expected).toEqual({ system_prompt: 'theirs' })
  })

  it('falls back to a plain update before the migration is applied', async () => {
    const c = client({ data: null, error: { code: 'PGRST202', message: 'function not found' } })
    expect((await saveAppFields(c, { id: 'a1' }, { tone: 'concise' })).error).toBeNull()
    expect(c.calls.update).toEqual([{ tone: 'concise' }])
  })

  it('passes other errors through', async () => {
    const c = client({ data: null, error: { code: '42501', message: "You can't edit this app" } })
    expect((await saveAppFields(c, { id: 'a1' }, { tone: 'concise' })).error.message).toBe("You can't edit this app")
  })
})
