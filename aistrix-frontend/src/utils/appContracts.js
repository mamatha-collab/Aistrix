import { supabase } from '../supabase'
import { formSchemaToInputFields } from './schemaContracts'

// Save an app's input/output contract (app_blueprints), merging into any
// existing blueprint. inputs come from form fields; outputFields are the
// Structured Output fields. Returns the Supabase error, or null.
export async function saveAppContract(appId, userId, { formSchema = [], outputFields = [] } = {}) {
  const inputFields = formSchemaToInputFields(formSchema)
  if (!inputFields.length && !outputFields.length) return null
  const { data } = await supabase.from('app_blueprints').select('blueprint').eq('app_id', appId).maybeSingle()
  const blueprint = { ...(data?.blueprint || {}) }
  if (inputFields.length) blueprint.input_schema = { type: 'object', fields: inputFields }
  if (outputFields.length) {
    blueprint.output_schema = { type: 'object', fields: outputFields }
    blueprint.output_contract = { ...(blueprint.output_contract || {}), format: 'json', fields: outputFields }
  }
  const { error } = await supabase.from('app_blueprints').upsert(
    { app_id: appId, user_id: userId, blueprint, updated_at: new Date().toISOString() },
    { onConflict: 'app_id' },
  )
  return error
}
