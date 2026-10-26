export const PROMOTE_FIELDS = ['system_prompt', 'ai_provider', 'ai_model', 'output_type', 'form_schema', 'tone', 'greeting', 'input_placeholder', 'pages', 'app_type', 'has_memory']
export const TOOL_FIELDS = ['name', 'description', 'type', 'config', 'input_schema']

export function reviewState(app, blueprint, tools) {
  const { dev_phase: _phase, ...design } = blueprint || {}
  return {
    ...Object.fromEntries(PROMOTE_FIELDS.map(key => [key, app?.[key] ?? null])),
    blueprint: design,
    tools: (tools || []).map(tool => Object.fromEntries(TOOL_FIELDS.map(key => [key, tool[key] ?? null])))
      .sort((a, b) => String(a.name).localeCompare(String(b.name))),
  }
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  return value ?? null
}

export function sameReviewValue(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b))
}
