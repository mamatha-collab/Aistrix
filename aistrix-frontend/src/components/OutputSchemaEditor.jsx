import { fieldKeyFromLabel } from '../utils/schemaContracts'

const FIELD_TYPES = [
  { id: 'string', label: 'Text' },
  { id: 'number', label: 'Number' },
  { id: 'boolean', label: 'True / false' },
  { id: 'enum', label: 'One of…' },
  { id: 'string_array', label: 'List of text' },
  { id: 'number_array', label: 'List of numbers' },
  { id: 'object', label: 'Object' },
]

// Edits blueprint output_schema fields: [{ field, type, required, description, enum_values? }].
// The backend describes these to the model, validates every response against
// them, and asks the model to repair a response once if it doesn't match.
export default function OutputSchemaEditor({ fields, onChange, accent = '#0984E3' }) {
  const inputCls = 'w-full bg-[#0F1225] border border-white/10 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]'

  function update(i, patch) {
    onChange(fields.map((f, idx) => (idx === i ? { ...f, ...patch } : f)))
  }

  return (
    <div className="space-y-2">
      {fields.map((f, i) => (
        <div key={i} className="bg-[#1F2444] border border-white/5 rounded-xl p-3 space-y-2">
          <div className="grid grid-cols-[1fr_auto_auto] gap-2 items-center">
            <input className={`${inputCls} font-mono`} placeholder="field_name" value={f.field}
              aria-label="Field name"
              onChange={e => update(i, { field: e.target.value })}
              onBlur={e => update(i, { field: fieldKeyFromLabel(e.target.value) })} />
            <select className={inputCls} value={f.type} aria-label="Field type"
              onChange={e => update(i, { type: e.target.value })}>
              {FIELD_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
            <button type="button" aria-label="Remove field" onClick={() => onChange(fields.filter((_, idx) => idx !== i))}
              className="text-slate-500 hover:text-red-400 text-xs px-1.5">✕</button>
          </div>
          <input className={inputCls} placeholder="What this field contains (the model reads this)"
            value={f.description || ''} onChange={e => update(i, { description: e.target.value })} />
          {f.type === 'enum' && (
            <input className={inputCls} placeholder="Allowed values, comma-separated: low, medium, high"
              value={(f.enum_values || []).join(', ')}
              onChange={e => update(i, { enum_values: e.target.value.split(',').map(v => v.trim()).filter(Boolean) })} />
          )}
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 cursor-pointer w-fit">
            <input type="checkbox" checked={f.required !== false} onChange={e => update(i, { required: e.target.checked })} />
            Required
          </label>
        </div>
      ))}
      <button type="button"
        onClick={() => onChange([...fields, { field: '', type: 'string', required: true, description: '' }])}
        className="w-full text-xs border border-dashed rounded-xl py-2 transition-colors hover:bg-white/5"
        style={{ borderColor: accent + '66', color: accent }}>
        + Add output field
      </button>
    </div>
  )
}
