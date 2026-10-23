import { describe, expect, it, vi } from 'vitest'
import { BlueprintConflictError, persistBlueprintPhase, readBlueprintRecord, saveBlueprintRecord } from './blueprintStorage'

function database(...results) {
  const maybeSingle = vi.fn()
  results.forEach(result => maybeSingle.mockResolvedValueOnce(result))
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle, update: vi.fn().mockReturnThis(), insert: vi.fn().mockReturnThis() }
  return { from: vi.fn(() => query), query }
}

describe('safe blueprint reads', () => {
  it('distinguishes a missing design from a failed read', async () => {
    await expect(readBlueprintRecord(database({ data: null }), 'app')).resolves.toBeNull()
    const error = { message: 'Network unavailable' }
    await expect(readBlueprintRecord(database({ data: null, error }), 'app')).rejects.toBe(error)
  })
  it('loads legacy schemas without the live column', async () => {
    const record = { blueprint: { inputs: [{ key: 'task' }] }, updated_at: 'today' }
    const db = database({ error: { code: '42703' } }, { data: record })
    await expect(readBlueprintRecord(db, 'app', { includeLive: true })).resolves.toEqual(record)
    expect(db.query.select).toHaveBeenLastCalledWith('blueprint, updated_at')
  })
  it('does not replace failed fallback reads with an empty design', async () => {
    const error = { message: 'Permission denied' }
    await expect(readBlueprintRecord(database({ error: { code: '42703' } }, { error }), 'app', { includeLive: true })).rejects.toBe(error)
  })
  it('propagates transport exceptions', async () => {
    const db = database()
    db.query.maybeSingle.mockRejectedValueOnce(new Error('Offline'))
    await expect(readBlueprintRecord(db, 'app')).rejects.toThrow('Offline')
  })
  it('never writes a replacement blueprint when reading fails', async () => {
    const db = database({ error: { message: 'Read failed' } })
    const makeRow = vi.fn()
    await expect(persistBlueprintPhase(db, 'app', makeRow)).rejects.toEqual({ message: 'Read failed' })
    expect(makeRow).not.toHaveBeenCalled()
    expect(db.query.update).not.toHaveBeenCalled()
    expect(db.query.insert).not.toHaveBeenCalled()
  })
  it('preserves the saved design while moving phase and reports rejected writes', async () => {
    const blueprint = { inputs: ['task'], output_contract: { format: 'json' }, dev_phase: 'design' }
    const db = database({ data: { blueprint, updated_at: '2026-10-14T12:00:00Z' } }, { error: { message: 'Write denied' } })
    await expect(persistBlueprintPhase(db, 'app', record => ({ app_id: 'app', blueprint: { ...record.blueprint, dev_phase: 'test' } }))).rejects.toEqual({ message: 'Write denied' })
    expect(db.query.update).toHaveBeenCalledWith(expect.objectContaining({ blueprint: { ...blueprint, dev_phase: 'test' } }))
  })
  it('rejects stale saves atomically instead of overwriting the newer design', async () => {
    const newer = { blueprint: { inputs: ['new'] }, updated_at: '2026-10-14T13:00:00Z' }
    const db = database({ data: null }, { data: newer })
    await expect(saveBlueprintRecord(db, { app_id: 'app', blueprint: {} }, '2026-10-14T12:00:00Z')).rejects.toBeInstanceOf(BlueprintConflictError)
    expect(db.query.eq).toHaveBeenCalledWith('updated_at', '2026-10-14T12:00:00Z')
  })
  it('treats concurrent first saves as conflicts rather than upserting', async () => {
    const db = database({ error: { code: '23505' } }, { data: { updated_at: 'new' } })
    await expect(saveBlueprintRecord(db, { app_id: 'app' }, null)).rejects.toBeInstanceOf(BlueprintConflictError)
    expect(db.query.insert).toHaveBeenCalled()
    expect(db.query.update).not.toHaveBeenCalled()
  })
  it('merges a phase move into the newer design after a concurrent save', async () => {
    const old = { blueprint: { inputs: ['old'] }, updated_at: '2026-10-14T12:00:00Z' }
    const newer = { blueprint: { inputs: ['new'] }, updated_at: '2026-10-14T13:00:00Z' }
    const db = database({ data: old }, { data: null }, { data: newer }, { data: newer }, { data: { updated_at: 'saved' } })
    await persistBlueprintPhase(db, 'app', record => ({ app_id: 'app', blueprint: { ...record.blueprint, dev_phase: 'test' } }))
    expect(db.query.update).toHaveBeenLastCalledWith(expect.objectContaining({ blueprint: { inputs: ['new'], dev_phase: 'test' } }))
  })
})
