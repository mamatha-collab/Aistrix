export function stripJsonFences(raw = '') {
  return String(raw).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
}

export function getInputSchemaFields(bp = {}) {
  return bp.input_schema?.fields?.length ? bp.input_schema.fields : []
}

export function getOutputSchemaFields(bp = {}) {
  return bp.output_schema?.fields?.length
    ? bp.output_schema.fields
    : bp.output_contract?.fields || bp.output_contract?.required_fields || []
}

// API field names: "Company Name" → "company_name". Must match the request
// examples on the API docs page and the backend's input contract.
export function fieldKeyFromLabel(label = '') {
  return String(label).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

// Form-builder fields → blueprint input_schema fields (validated server-side
// when callers send {"fields": {...}} to the API).
export function formSchemaToInputFields(formSchema = []) {
  return formSchema.filter(f => f.label?.trim()).map(f => {
    const options = String(f.options || '').split(',').map(o => o.trim()).filter(Boolean)
    const base = { field: fieldKeyFromLabel(f.label), required: !!f.required, description: f.label.trim() }
    if (f.type === 'number') return { ...base, type: 'number' }
    if (f.type === 'select' && options.length) return { ...base, type: 'enum', enum_values: options }
    return { ...base, type: 'string' }
  })
}

export function validateSchemaObject(value, fields = [], path = '') {
  const errors = []
  if (typeof value !== 'object' || Array.isArray(value) || value === null) {
    return [`${path || 'value'} must be an object`]
  }

  for (const f of fields) {
    const key = f.field
    if (!key) continue
    const label = path ? `${path}.${key}` : key
    const present = Object.prototype.hasOwnProperty.call(value, key) && value[key] !== null && value[key] !== undefined && value[key] !== ''

    if (!present) {
      if (f.required !== false) errors.push(`"${label}" is required`)
      continue
    }

    const val = value[key]
    switch (f.type) {
      case 'string':
      case 'enum':
        if (typeof val !== 'string') errors.push(`"${label}" must be text`)
        if (f.type === 'enum' && f.enum_values?.length && !f.enum_values.includes(val)) {
          errors.push(`"${label}" must be one of: ${f.enum_values.join(', ')}`)
        }
        break
      case 'number':
        if (typeof val !== 'number' || Number.isNaN(val)) errors.push(`"${label}" must be a number`)
        break
      case 'boolean':
        if (typeof val !== 'boolean') errors.push(`"${label}" must be true or false`)
        break
      case 'string_array':
        if (!Array.isArray(val) || val.some(x => typeof x !== 'string')) errors.push(`"${label}" must be a list of text values`)
        break
      case 'number_array':
        if (!Array.isArray(val) || val.some(x => typeof x !== 'number' || Number.isNaN(x))) errors.push(`"${label}" must be a list of numbers`)
        break
      case 'object':
        if (typeof val !== 'object' || Array.isArray(val) || val === null) errors.push(`"${label}" must be an object`)
        else if (f.nested_fields?.length) errors.push(...validateSchemaObject(val, f.nested_fields, label))
        break
      default:
        break
    }
  }

  return errors
}

export function parseSchemaValue(raw, field) {
  if (raw === '' || raw === null || raw === undefined) return raw
  if (field.type === 'number') return Number(raw)
  if (field.type === 'boolean') return raw === true || raw === 'true'
  if (field.type === 'string_array') return Array.isArray(raw) ? raw : String(raw).split(',').map(s => s.trim()).filter(Boolean)
  if (field.type === 'number_array') return (Array.isArray(raw) ? raw : String(raw).split(',')).map(Number)
  if (field.type === 'object') {
    if (typeof raw === 'object') return raw
    try { return JSON.parse(raw) } catch { return raw }
  }
  return String(raw)
}

export function validateJsonOutput(rawOutput, fields = []) {
  const raw = stripJsonFences(rawOutput)
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    return { ok: false, parsed: null, errors: [`Output is not valid JSON: ${e.message}`] }
  }
  const errors = validateSchemaObject(parsed, fields)
  return { ok: errors.length === 0, parsed, errors }
}

// Problems with an output-field list, or "" when it is valid.
export function outputFieldsErrors(fields) {
  const names = new Set()
  for (const f of fields) {
    if (!f.field) return 'Every output field needs a name.'
    if (!/^[a-z][a-z0-9_]*$/.test(f.field)) return `"${f.field}" must start with a letter and use only lowercase letters, numbers and _.`
    if (names.has(f.field)) return `Output field "${f.field}" is listed twice.`
    if (f.type === 'enum' && !(f.enum_values || []).length) return `"${f.field}" needs at least one allowed value.`
    names.add(f.field)
  }
  return ''
}
