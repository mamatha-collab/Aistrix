import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useParams, useNavigate } from 'react-router-dom'

const API_BASE = 'https://api.aistrix.com/v1'

function CodeBlock({ code }) {
  const [copied, setCopied] = useState(false)
  return (
    <div className="relative">
      <pre className="bg-[#0F1225] border border-white/10 rounded-xl p-4 text-xs text-slate-300 overflow-x-auto leading-relaxed font-mono">
        {code}
      </pre>
      <button onClick={() => { navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
        className="absolute top-3 right-3 text-[10px] text-slate-500 hover:text-white bg-[#1F2444] px-2 py-1 rounded transition-colors">
        {copied ? '✓' : '📋'}
      </button>
    </div>
  )
}

function Section({ title, children }) {
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
      <div className="px-6 py-4 border-b border-white/5 bg-[#1F2444]/50">
        <p className="text-white font-semibold text-sm">{title}</p>
      </div>
      <div className="p-6 space-y-4">{children}</div>
    </div>
  )
}

const TYPE_MAP = { text: 'string', textarea: 'string', number: 'number', select: 'string', date: 'string' }

export default function AppDocsPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [app, setApp] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('apps').select('*').eq('id', id).eq('is_published', true).single()
      .then(({ data }) => { setApp(data); setLoading(false) })
  }, [id])

  if (loading) return <div className="min-h-screen bg-[#0F1225] flex items-center justify-center"><div className="text-slate-400 text-sm">Loading...</div></div>
  if (!app) return <div className="min-h-screen bg-[#0F1225] flex items-center justify-center"><p className="text-slate-400">App not found</p></div>

  const isNative = app.app_type === 'native' && app.form_schema?.length > 0
  const endpoint = `${API_BASE}/apps/${id}/run`

  const requestBody = isNative
    ? JSON.stringify({
        fields: Object.fromEntries((app.form_schema || []).map(f => [
          f.label.toLowerCase().replace(/\s+/g, '_'),
          f.type === 'number' ? 0 : f.type === 'select' ? (f.options?.split(',')[0]?.trim() || 'option') : 'string value'
        ])),
      }, null, 2)
    : JSON.stringify({ input: 'Your prompt here' }, null, 2)

  const curlExample = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ak_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '${requestBody.replace(/\n/g, '\n  ')}'`

  const responseExample = JSON.stringify({
    result: app.output_type === 'table'
      ? [{ Column1: 'Value', Column2: 'Value' }]
      : app.output_type === 'key_value'
      ? { Field1: 'Value', Field2: 'Value' }
      : 'AI-generated response text...',
    output_type: app.output_type || 'markdown',
    provider: app.ai_provider || 'claude',
    model: app.ai_model || 'claude-sonnet-4-6',
    run_id: 'uuid',
  }, null, 2)

  return (
    <div className="min-h-screen bg-[#0F1225]">
      <header className="border-b border-white/5 bg-[#171B33]">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(`/app/${id}`)} className="text-slate-400 hover:text-white text-sm transition-colors">← Back</button>
            <div className="flex items-center gap-2 border-l border-white/10 pl-3">
              <span className="text-xl">{app.emoji}</span>
              <span className="text-white font-medium">{app.name}</span>
              <span className="text-[10px] bg-green-400/10 text-green-400 px-2 py-0.5 rounded-full">API Docs</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-slate-400">Live</span>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">{app.name} API</h1>
          <p className="text-slate-400">{app.description}</p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Method', value: 'POST' },
            { label: 'Output format', value: app.output_type || 'markdown' },
            { label: 'Provider', value: app.ai_provider === 'openai' ? 'OpenAI' : 'Claude' },
            { label: 'App type', value: app.app_type || 'prompt' },
          ].map(({ label, value }) => (
            <div key={label} className="bg-[#171B33] border border-white/5 rounded-xl p-3">
              <p className="text-[10px] text-slate-500 uppercase mb-1">{label}</p>
              <p className="text-white text-sm font-medium font-mono">{value}</p>
            </div>
          ))}
        </div>

        <Section title="Endpoint">
          <div className="flex items-center gap-3 bg-[#0F1225] border border-white/10 rounded-xl px-4 py-3">
            <span className="text-xs font-bold text-green-400 bg-green-400/10 px-2 py-0.5 rounded">POST</span>
            <code className="text-sm text-slate-200 font-mono break-all">{endpoint}</code>
          </div>
        </Section>

        <Section title="Authentication">
          <p className="text-slate-400 text-sm">Pass your API key as a Bearer token in the Authorization header. Generate keys in the <a href="/" className="text-[#6C5CE7] hover:underline">Developer Dashboard</a>.</p>
          <CodeBlock code={`Authorization: Bearer ak_live_your_key_here`} />
        </Section>

        <Section title="Request body">
          {isNative ? (
            <>
              <p className="text-slate-400 text-sm mb-3">This is a <strong className="text-white">Native App</strong> with structured fields. Pass each field in the <code className="text-[#6C5CE7]">fields</code> object.</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead><tr className="bg-[#1F2444] text-left">
                    <th className="px-3 py-2 text-xs text-slate-400 font-medium">Field</th>
                    <th className="px-3 py-2 text-xs text-slate-400 font-medium">Type</th>
                    <th className="px-3 py-2 text-xs text-slate-400 font-medium">Required</th>
                    {app.form_schema.some(f => f.options) && <th className="px-3 py-2 text-xs text-slate-400 font-medium">Options</th>}
                  </tr></thead>
                  <tbody>
                    {(app.form_schema || []).map(f => (
                      <tr key={f.id} className="border-t border-white/5">
                        <td className="px-3 py-2 text-white font-mono text-xs">{f.label.toLowerCase().replace(/\s+/g, '_')}</td>
                        <td className="px-3 py-2 text-slate-400 text-xs">{TYPE_MAP[f.type] || 'string'}</td>
                        <td className="px-3 py-2 text-xs">{f.required ? <span className="text-red-400">required</span> : <span className="text-slate-500">optional</span>}</td>
                        {app.form_schema.some(x => x.options) && <td className="px-3 py-2 text-slate-400 text-xs">{f.options || '—'}</td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between items-center bg-[#1F2444] border border-white/5 rounded-xl px-4 py-2.5">
                <span className="text-xs font-mono text-white">input</span>
                <span className="text-xs text-slate-400">string · required</span>
              </div>
            </div>
          )}
          <CodeBlock code={curlExample} />
        </Section>

        <Section title="Response">
          <p className="text-slate-400 text-sm">All responses return JSON with a <code className="text-[#6C5CE7]">result</code> field in the configured output format.</p>
          <CodeBlock code={responseExample} />
        </Section>

        {app.is_paid && app.price_per_run > 0 && (
          <Section title="Pricing">
            <div className="flex items-center gap-4">
              <div className="text-center bg-[#1F2444] rounded-xl p-4 flex-1">
                <p className="text-2xl font-bold text-white">${app.price_per_run}</p>
                <p className="text-xs text-slate-400 mt-0.5">per API call</p>
              </div>
              <p className="text-slate-400 text-sm flex-1">Billed per successful run. Errors are not charged. Usage tracked in your developer dashboard.</p>
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
