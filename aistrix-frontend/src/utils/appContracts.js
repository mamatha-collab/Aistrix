import { supabase } from '../supabase'
import { mergeStarter, starterBlueprint } from './starterBlueprint'

// A new app's first Design blueprint from what its wizard already knows
// (see starterBlueprint), merged under anything already saved for it.
export async function saveStarterBlueprint(app, userId, { formSchema = [], outputFields = [], known = {} } = {}) {
  const { data } = await supabase.from('app_blueprints').select('blueprint').eq('app_id', app.id).maybeSingle()
  const blueprint = mergeStarter(data?.blueprint || {}, starterBlueprint(app, { formSchema, outputFields, known }))
  const { error } = await supabase.from('app_blueprints').upsert(
    { app_id: app.id, user_id: userId, blueprint, updated_at: new Date().toISOString() },
    { onConflict: 'app_id' },
  )
  return error
}
