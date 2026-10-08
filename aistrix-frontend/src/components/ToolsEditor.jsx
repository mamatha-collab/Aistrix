import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

const TOOL_TYPES = [
  {
    id: 'search',
    icon: '🔍',
    label: 'Web Search',
    desc: 'Search the web for current information. AI decides what to search.',
    configFields: [],
    defaultSchema: {
      type: 'object',
      properties: { query: { type: 'string', description: 'The search query' } },
      required: ['query'],
    },
  },
  {
    id: 'fetch',
    icon: '🌐',
    label: 'Fetch URL',
    desc: 'Retrieve content from any webpage. AI decides which URL to fetch.',
    configFields: [],
    defaultSchema: {
      type: 'object',
      properties: { url: { type: 'string', description: 'The URL to fetch' } },
      required: ['url'],
    },
  },
  {
    id: 'calculator',
    icon: '🧮',
    label: 'Calculator',
    desc: 'Evaluate math expressions. AI uses this for accurate calculations.',
    configFields: [],
    defaultSchema: {
      type: 'object',
      properties: { expression: { type: 'string', description: 'Math expression to evaluate, e.g. "2 * (3 + 4)"' } },
      required: ['expression'],
    },
  },
  {
    id: 'http',
    icon: '🔗',
    label: 'HTTP Request',
    desc: 'Call any external API. You configure the endpoint; AI sends the data.',
    configFields: [
      { key: 'url', label: 'Endpoint URL', placeholder: 'https://api.example.com/endpoint' },
      { key: 'method', label: 'Method', placeholder: 'POST', options: ['GET', 'POST', 'PUT'] },
      { key: 'headers', label: 'Headers (JSON) — reference secrets as {{secrets.KEY}}, never paste raw keys', placeholder: '{"Authorization": "Bearer {{secrets.MY_API_KEY}}"}' },
    ],
    defaultSchema: {
      type: 'object',
      properties: { data: { type: 'string', description: 'Data to send to the API' } },
      required: [],
    },
  },
  {
    id: 'app',
    icon: '🧩',
    label: 'Call Aistrix App',
    desc: 'Chain to another Aistrix app. The AI can invoke it mid-conversation.',
    configFields: [
      { key: 'app_id', label: 'Target App ID', placeholder: 'UUID of the app to call' },
    ],
    defaultSchema: {
      type: 'object',
      properties: { input: { type: 'string', description: 'Input to send to the app' } },
      required: ['input'],
    },
  },
]

function ToolForm({ appId, existingTool, onSave, onCancel }) {
  const [type, setType] = useState(existingTool?.type || 'search')
  const [name, setName] = useState(existingTool?.name || '')
  const [description, setDescription] = useState(existingTool?.description || '')
  const [config, setConfig] = useState(existingTool?.config || {})
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  const typeDef = TOOL_TYPES.find(t => t.id === type)

  function setConfigField(key, val) {
    setConfig(prev => ({ ...prev, [key]: val }))
  }

  async function save() {
    if (!name.trim() || !description.trim()) return
    if (typeof config.headers === 'string' && config.headers.trim()) {
      try {
        const parsed = JSON.parse(config.headers)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
      } catch {
        toast('Headers must be a JSON object, e.g. {"Authorization": "Bearer {{secrets.MY_API_KEY}}"}', 'error')
        return
      }
    }
    setSaving(true)
    const schema = typeDef.defaultSchema

    if (existingTool) {
      const { error } = await supabase.from('app_tools').update({
        name: name.trim(), description: description.trim(), type, config, input_schema: schema,
      }).eq('id', existingTool.id)
      setSaving(false)
      if (error) { toast(error.message, 'error'); return }
    } else {
      const { error } = await supabase.from('app_tools').insert({
        app_id: appId, name: name.trim(), description: description.trim(), type, config, input_schema: schema,
      })
      setSaving(false)
      if (error) { toast(error.message, 'error'); return }
    }
    onSave()
  }

  const inputCls = 'w-full bg-[#0F1225] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'

  return (
    <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-2xl p-5 space-y-4">
      <p className="text-white font-medium text-sm">{existingTool ? 'Edit tool' : 'Add tool'}</p>

      {/* Type picker */}
      <div>
        <label className="text-xs text-slate-400 block mb-2">Tool type</label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {TOOL_TYPES.map(t => (
            <button key={t.id} onClick={() => setType(t.id)}
              className={`p-3 rounded-xl border text-left transition-all ${type === t.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10' : 'border-white/5 bg-[#171B33] hover:border-white/20'}`}>
              <div className="text-xl mb-1">{t.icon}</div>
              <p className={`text-xs font-medium ${type === t.id ? 'text-white' : 'text-slate-300'}`}>{t.label}</p>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-2">{typeDef?.desc}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">
            Function name <span className="text-slate-600">(no spaces)</span>
          </label>
          <input className={inputCls}
            placeholder={`e.g. ${type === 'search' ? 'search_web' : type === 'calculator' ? 'calculate' : 'call_api'}`}
            value={name}
            onChange={e => setName(e.target.value.replace(/\s/g, '_').toLowerCase())} />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1.5">Description <span className="text-slate-600">(AI reads this)</span></label>
          <input className={inputCls}
            placeholder="What this tool does and when to use it"
            value={description} onChange={e => setDescription(e.target.value)} />
        </div>
      </div>

      {/* Type-specific config */}
      {typeDef?.configFields?.length > 0 && (
        <div className="space-y-3">
          <label className="text-xs text-slate-400 block">Configuration</label>
          {typeDef.configFields.map(field => (
            <div key={field.key}>
              <label className="text-[10px] text-slate-500 block mb-1">{field.label}</label>
              {field.options ? (
                <select className={inputCls} value={config[field.key] || ''} onChange={e => setConfigField(field.key, e.target.value)}>
                  {field.options.map(o => <option key={o}>{o}</option>)}
                </select>
              ) : (
                <input className={inputCls} placeholder={field.placeholder}
                  value={config[field.key] || ''} onChange={e => setConfigField(field.key, e.target.value)} />
              )}
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button onClick={save} disabled={saving || !name.trim() || !description.trim()}
          className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-5 py-2 rounded-xl font-medium transition-colors">
          {saving ? 'Saving...' : existingTool ? 'Save changes' : 'Add tool'}
        </button>
        <button onClick={onCancel}
          className="bg-[#171B33] hover:bg-[#272C52] text-slate-300 text-sm px-4 py-2 rounded-xl transition-colors">
          Cancel
        </button>
      </div>
    </div>
  )
}

export default function ToolsEditor({ appId, readOnly = false, autoOpen = false }) {
  const [tools, setTools] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(autoOpen)
  const [editingTool, setEditingTool] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const toast = useToast()

  useEffect(() => {
    if (appId) load()
    else setLoading(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when appId changes
  }, [appId])

  async function load() {
    const { data } = await supabase.from('app_tools').select('*').eq('app_id', appId).order('created_at')
    if (data) setTools(data)
    setLoading(false)
  }

  async function deleteTool(id) {
    const { error } = await supabase.from('app_tools').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setTools(prev => prev.filter(t => t.id !== id))
    toast('Tool removed', 'info', 2000)
  }

  async function afterSave() {
    setShowForm(false); setEditingTool(null); await load()
    toast('Tool saved', 'success')
  }

  if (!appId) return (
    <div className="bg-[#1F2444] border border-white/5 rounded-xl p-4 text-center">
      <p className="text-slate-500 text-sm">Save the app first to add tools.</p>
    </div>
  )

  if (loading) return <p className="text-slate-500 text-sm">Loading tools...</p>

  return (
    <div className="space-y-3">
      {tools.map(tool => {
        const typeDef = TOOL_TYPES.find(t => t.id === tool.type)
        return (
          <div key={tool.id} className="bg-[#1F2444] border border-white/5 rounded-xl p-4 flex items-start gap-3">
            <span className="text-2xl shrink-0">{typeDef?.icon || '🔧'}</span>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-white text-sm font-medium font-mono">{tool.name}</p>
                <span className="text-[9px] text-slate-500 bg-[#171B33] px-1.5 py-0.5 rounded">{typeDef?.label}</span>
              </div>
              <p className="text-xs text-slate-400 truncate">{tool.description}</p>
              {tool.config?.url && <p className="text-[10px] text-slate-600 mt-0.5 font-mono truncate">{tool.config.url}</p>}
            </div>
            {!readOnly && (
              <div className="flex items-center gap-1 shrink-0">
                {confirmDeleteId === tool.id ? (
                  <>
                    <span className="text-[10px] text-slate-400">Delete?</span>
                    <button onClick={() => { deleteTool(tool.id); setConfirmDeleteId(null) }}
                      className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 bg-red-400/10 rounded-lg transition-colors">Yes</button>
                    <button onClick={() => setConfirmDeleteId(null)}
                      className="text-[10px] text-slate-400 hover:text-white px-2 py-1 transition-colors">No</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => { setEditingTool(tool); setShowForm(true) }}
                      className="text-slate-500 hover:text-white text-xs p-1.5 transition-colors">✏️</button>
                    <button onClick={() => setConfirmDeleteId(tool.id)}
                      className="text-slate-500 hover:text-red-400 text-xs p-1.5 transition-colors">🗑</button>
                  </>
                )}
              </div>
            )}
          </div>
        )
      })}

      {tools.length === 0 && !showForm && (
        <div className="bg-[#1F2444] border border-dashed border-white/10 rounded-xl p-6 text-center">
          <p className="text-2xl mb-2">🔧</p>
          <p className="text-slate-400 text-sm mb-1">No tools yet</p>
          <p className="text-[11px] text-slate-500">Add tools to let the AI search the web, call APIs, run calculations, or chain to other apps.</p>
        </div>
      )}

      {showForm && (
        <ToolForm
          appId={appId}
          existingTool={editingTool}
          onSave={afterSave}
          onCancel={() => { setShowForm(false); setEditingTool(null) }}
        />
      )}

      {!readOnly && !showForm && (
        <button onClick={() => { setShowForm(true); setEditingTool(null) }}
          className="w-full bg-[#6C5CE7]/10 hover:bg-[#6C5CE7]/20 border border-[#6C5CE7]/30 hover:border-[#6C5CE7]/60 text-[#6C5CE7] hover:text-white text-sm py-2.5 rounded-xl transition-colors font-medium">
          + Add tool
        </button>
      )}
    </div>
  )
}
