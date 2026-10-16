// Which app columns the browser may read. Prompts, webhook URLs, custom model
// endpoints and the live snapshot are private (see migration
// 20261014030000_private_app_columns): `select('*')` on apps fails, so
// queries list the public columns and editors add the private ones through
// app_private_fields().

// Must match the column grant in the migration.
export const APP_PUBLIC_COLUMNS = [
  'id', 'domain_id', 'name', 'description', 'emoji', 'color', 'tags', 'input_placeholder', 'ai_provider', 'ai_model',
  'workflow_order', 'next_app_id', 'is_published', 'total_runs', 'created_at', 'created_by', 'is_verified', 'is_trending',
  'is_top_rated', 'is_new', 'required_context', 'compose_hint', 'app_type', 'form_schema', 'output_type', 'visibility',
  'is_paid', 'price_per_run', 'pages_public', 'has_memory', 'status', 'is_featured', 'sample_input', 'max_runs_per_day',
  'version', 'has_draft_changes', 'embed_allowed_domains', 'embed_public', 'workspace_id', 'greeting', 'tone',
  'billing_mode', 'free_runs_per_user_day', 'promoted_at', 'live_version',
]
export const APP_PUBLIC_SELECT = APP_PUBLIC_COLUMNS.join(', ')

export const APP_PRIVATE_COLUMNS = ['system_prompt', 'pages', 'prod_snapshot', 'webhook_url',
  'custom_model_url', 'custom_model_name', 'change_note', 'review_notes']

// End users get page names and fields without the page prompts.
export function asPublicApp(row) {
  if (!row) return row
  return { ...row, pages: row.pages ?? row.pages_public ?? null }
}

// Adds the private fields to the apps the signed-in user can edit (others are
// returned as public apps). Never throws: without them, editors still see the
// app, just not its prompt.
export async function withPrivateFields(client, rows) {
  const list = (rows || []).filter(Boolean)
  if (!list.length) return rows || []
  const { data, error } = await client.rpc('app_private_fields', { p_app_ids: list.map(r => r.id) })
  if (error) console.warn('Could not load private app fields:', error.message)
  const byId = new Map((data || []).map(p => [p.id, p]))
  return list.map(row => {
    const priv = byId.get(row.id)
    return priv ? { ...row, ...priv } : asPublicApp(row)
  })
}

export async function withPrivateField(client, row) {
  if (!row) return row
  return (await withPrivateFields(client, [row]))[0]
}
