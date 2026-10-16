// Tool settings never hold raw keys: before a tool is saved, any key in its
// settings is stored as an encrypted app secret (PUT /apps/{id}/secrets) and
// replaced with a {{secrets.NAME}} reference, filled in only when the tool
// runs. (The database rejects tools with raw keys — see migration
// tool_settings_no_raw_keys.)
import { supabase } from '../supabase'
import { errorFromResponse } from './runStream'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
export const SECRET_FIELDS = ['api_key', 'apikey', 'token', 'access_token', 'auth_token', 'secret', 'password']
const REF = /^\s*\{\{\s*secrets\.[A-Za-z0-9_]+\s*\}\}\s*$/

export function secretName(toolName, field) {
  const base = `${toolName}_${field}`.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return (base || 'TOOL_KEY').slice(0, 100)
}

// Returns { tools, problems }: tools ready to insert (keys replaced by
// references); a key whose secret couldn't be saved is left out, not stored raw.
export async function moveToolKeysToSecrets(appId, tools) {
  const { data: { session } } = await supabase.auth.getSession()
  const problems = []
  const out = []
  for (const tool of tools) {
    const config = { ...(tool.config || {}) }
    for (const field of Object.keys(config)) {
      const value = config[field]
      if (!SECRET_FIELDS.includes(field.toLowerCase()) || typeof value !== 'string' || !value.trim() || REF.test(value)) continue
      const name = secretName(tool.name || 'tool', field)
      try {
        const res = await fetch(`${API_URL}/apps/${appId}/secrets`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session?.access_token}` },
          body: JSON.stringify({ key: name, value: value.trim() }),
        })
        if (!res.ok) throw await errorFromResponse(res, 'Could not save the key')
        config[field] = `{{secrets.${name}}}`
      } catch (e) {
        delete config[field]
        problems.push(`${tool.name}: ${e.message}`)
      }
    }
    out.push({ ...tool, config })
  }
  return { tools: out, problems }
}
