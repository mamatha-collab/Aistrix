// What the creation wizards already know about an app, saved as its first
// Design blueprint, so a new app doesn't land in Design half-empty and ask
// for things the developer just told us. Nothing is invented: anything a
// wizard doesn't know (e.g. the audience in the manual wizards) stays empty
// for Design to ask about.
import { formSchemaToInputFields } from './schemaContracts'

// Same reading of the prompt as Design's "Prompt expects X" check, so the
// starting contract never contradicts the prompt.
export function inferPromptOutputFormat(prompt = '') {
  const text = prompt.toLowerCase()
  if (/valid json|json object|return only the json|only the json|strict json/.test(text)) return 'json'
  if (/markdown|##|###/.test(text)) return 'markdown'
  if (/table|columns|csv/.test(text)) return 'table'
  if (/email|subject line|draft reply/.test(text)) return 'email'
  if (/checklist|check list|action items/.test(text)) return 'checklist'
  return null
}

// Sections the prompt itself asks for: "## Heading" lines, or a list such as
// "with these sections: About the role, What you'll do, Salary and location."
export function sectionsFromPrompt(prompt = '') {
  const clean = s => s.replace(/\([^)]*\)/g, '').replace(/^and\s+/i, '').replace(/[*_`"]/g, '').trim()
  const headings = [...String(prompt).matchAll(/^#{2,3}\s+(.+?)\s*$/gm)].map(m => clean(m[1])).filter(Boolean)
  if (headings.length >= 2) return headings
  const listed = String(prompt).match(/sections?\s*(?:\([^)]*\))?\s*:\s*([^\n]+?)(?:\.\s|\.$|\n|$)/i)
  if (listed) {
    const parts = listed[1].split(',').map(clean).filter(p => p && p.length <= 40)
    if (parts.length >= 2) return parts
  }
  return []
}

const RULES_KEY = { markdown: 'sections', document: 'sections', decision: 'sections', table: 'columns', email: 'required_parts' }

// app: the saved app row. known: what a wizard learned —
// { business_problem, audience, fallback, sections } (all optional).
export function starterBlueprint(app, { formSchema = [], outputFields = [], known = {} } = {}) {
  const isChat = app?.app_type === 'chatbot'
  const formFields = formSchemaToInputFields(formSchema)
  const inputFields = formFields.length ? formFields
    : [{ field: isChat ? 'message' : 'input', type: 'string', required: true, description: isChat ? 'Message' : 'Input' }]

  let format = outputFields.length ? 'json'
    : isChat ? 'markdown'
    : inferPromptOutputFormat(app?.system_prompt) || (app?.output_type === 'table' ? 'table' : 'markdown')
  if (format === 'json' && !outputFields.length) format = 'markdown'
  const sections = (known.sections?.length ? known.sections : sectionsFromPrompt(app?.system_prompt)).map(String).filter(Boolean)
  const rulesKey = RULES_KEY[format]
  const formatRules = !isChat && rulesKey && sections.length ? { [rulesKey]: sections.join(', ') } : {}

  return {
    business_problem: String(known.business_problem || app?.description || '').trim(),
    audience: String(known.audience || '').trim(),
    input_schema: { type: 'object', fields: inputFields },
    ...(outputFields.length ? { output_schema: { type: 'object', fields: outputFields } } : {}),
    output_contract: { format, fields: outputFields, format_rules: formatRules },
    ai_behavior: { fallback_behavior: String(known.fallback || '').trim() },
    permissions: { stores_user_data: false, requires_external_api: false, handles_sensitive_data: false },
  }
}

const isEmpty = v => v == null || (typeof v === 'string' && !v.trim())
  || (Array.isArray(v) && !v.length) || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)

// Fill only what's still empty in an existing blueprint (never overwrite
// what the developer already set).
export function mergeStarter(existing = {}, starter = {}) {
  const out = { ...existing }
  for (const [k, v] of Object.entries(starter)) {
    if (isEmpty(out[k])) out[k] = v
    else if (v && typeof v === 'object' && !Array.isArray(v) && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = { ...out[k] }
      for (const [k2, v2] of Object.entries(v)) if (isEmpty(out[k][k2])) out[k][k2] = v2
    }
  }
  return out
}
