// A failed read must never be treated as a missing (new) blueprint.
export async function readBlueprintRecord(client, appId, { includeLive = false } = {}) {
  const read = columns => client.from('app_blueprints').select(columns).eq('app_id', appId).maybeSingle()
  let result = await read(includeLive ? 'blueprint, blueprint_prod, updated_at' : 'blueprint, updated_at')
  if (includeLive && (result.error?.code === '42703' || result.error?.message?.includes('blueprint_prod'))) {
    result = await read('blueprint, updated_at')
  }
  if (result.error) throw result.error
  return result.data
}

export class BlueprintConflictError extends Error {
  constructor(record) {
    super('This design changed while saving. Reload it before trying again.')
    this.name = 'BlueprintConflictError'
    this.record = record
  }
}

// Compare and write in the SAME database statement; a preliminary read alone
// cannot protect against another editor saving between that read and the write.
export async function saveBlueprintRecord(client, row, expectedUpdatedAt) {
  const updatedAt = new Date(Math.max(Date.now(), (Date.parse(expectedUpdatedAt) || 0) + 1)).toISOString()
  const next = { ...row, updated_at: updatedAt }
  const query = expectedUpdatedAt
    ? client.from('app_blueprints').update(next).eq('app_id', row.app_id).eq('updated_at', expectedUpdatedAt)
    : client.from('app_blueprints').insert(next)
  const { data, error } = await query.select('updated_at').maybeSingle()
  if (error?.code === '23505' || (!error && !data)) {
    throw new BlueprintConflictError(await readBlueprintRecord(client, row.app_id))
  }
  if (error) throw error
  return data.updated_at
}

export async function persistBlueprintPhase(client, appId, makeRow) {
  // A phase move must merge into the latest design, never restore an old copy.
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = await readBlueprintRecord(client, appId)
    try {
      await saveBlueprintRecord(client, makeRow(record), record?.updated_at)
      return
    } catch (error) {
      if (!(error instanceof BlueprintConflictError) || attempt === 2) throw error
    }
  }
}
