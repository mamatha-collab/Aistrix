import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '../types/database'
type BlueprintInsert = Database['public']['Tables']['app_blueprints']['Insert']
type BlueprintRecord = Pick<Database['public']['Tables']['app_blueprints']['Row'], 'blueprint' | 'updated_at'> & { blueprint_prod?: Database['public']['Tables']['app_blueprints']['Row']['blueprint_prod'] }
// A failed read must never be treated as a missing (new) blueprint.
export async function readBlueprintRecord(client: SupabaseClient<Database>, appId: string, { includeLive = false } = {}): Promise<BlueprintRecord | null> {
  let result = includeLive
    ? await client.from('app_blueprints').select('blueprint, blueprint_prod, updated_at').eq('app_id', appId).maybeSingle()
    : await client.from('app_blueprints').select('blueprint, updated_at').eq('app_id', appId).maybeSingle()
  if (includeLive && (result.error?.code === '42703' || result.error?.message?.includes('blueprint_prod'))) {
    result = await client.from('app_blueprints').select('blueprint, updated_at').eq('app_id', appId).maybeSingle()
  }
  if (result.error) throw result.error
  return result.data
}

export class BlueprintConflictError extends Error {
  record: BlueprintRecord | null
  constructor(record: BlueprintRecord | null) {
    super('This design changed while saving. Reload it before trying again.')
    this.name = 'BlueprintConflictError'
    this.record = record
  }
}

// Compare and write in the SAME database statement; a preliminary read alone
// cannot protect against another editor saving between that read and the write.
export async function saveBlueprintRecord(client: SupabaseClient<Database>, row: BlueprintInsert, expectedUpdatedAt: string | null | undefined) {
  const updatedAt = new Date(Math.max(Date.now(), (Date.parse(expectedUpdatedAt || '') || 0) + 1)).toISOString()
  const next = { ...row, updated_at: updatedAt }
  const query = expectedUpdatedAt
    ? client.from('app_blueprints').update(next).eq('app_id', row.app_id).eq('updated_at', expectedUpdatedAt)
    : client.from('app_blueprints').insert(next)
  const { data, error } = await query.select('updated_at').maybeSingle()
  if (error?.code === '23505' || (!error && !data)) {
    throw new BlueprintConflictError(await readBlueprintRecord(client, row.app_id))
  }
  if (error) throw error
  if (!data) throw new Error('The saved design could not be verified.')
  return data.updated_at
}

export async function persistBlueprintPhase(client: SupabaseClient<Database>, appId: string, makeRow: (record: BlueprintRecord | null) => BlueprintInsert) {
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
