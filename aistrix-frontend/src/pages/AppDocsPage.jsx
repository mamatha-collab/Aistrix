import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useParams, useNavigate } from 'react-router-dom'
import { fieldKeyFromLabel } from '../utils/schemaContracts'

const API_BASE = `${(import.meta.env.VITE_API_URL || 'https://api.aistrix.com').replace(/\/$/, '')}/v1`
const API_ROOT = API_BASE.replace(/\/v1$/, '')

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
  const [contract, setContract] = useState(null) // { output_schema, input_schema } from the API
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.from('apps').select('*').eq('id', id).eq('is_published', true).single()
      .then(({ data }) => { setApp(data); setLoading(false) })
    fetch(`${API_BASE}/apps/${id}`).then(r => (r.ok ? r.json() : null)).then(setContract).catch(() => {})
  }, [id])

  if (loading) return <div className="min-h-screen bg-[#0F1225] flex items-center justify-center"><div className="text-slate-400 text-sm">Loading...</div></div>
  if (!app) return <div className="min-h-screen bg-[#0F1225] flex items-center justify-center"><p className="text-slate-400">App not found</p></div>

  const isNative = ['native', 'api'].includes(app.app_type) && app.form_schema?.length > 0
  const outputFields = contract?.output_schema || []
  const endpoint = `${API_BASE}/apps/${id}/run`
  const requestBody = isNative
    ? JSON.stringify({
        fields: Object.fromEntries((app.form_schema || []).map(f => [
          fieldKeyFromLabel(f.label),
          f.type === 'number' ? 0 : f.type === 'select' ? (f.options?.split(',')[0]?.trim() || 'option') : 'string value'
        ])),
        stream: false,
      }, null, 2)
    : JSON.stringify({ input: 'Your prompt here', stream: false }, null, 2)
  const sdkArgs = isNative
    ? `fields={${(app.form_schema || []).map(f => `"${fieldKeyFromLabel(f.label)}": ${f.type === 'number' ? '0' : '"..."'}`).join(', ')}}`
    : '"Your prompt here"'
  const pythonExample = `pip install aistrix
export AISTRIX_API_KEY=ak_live_your_key_here

from aistrix import AistrixClient, ContractError, RateLimitError

client = AistrixClient(api_url="${API_ROOT}")
result = client.run("${id}", ${sdkArgs})
print(result.data or result.output)

# Stream tokens as they arrive
for token in client.stream("${id}", ${sdkArgs}):
    print(token, end="")

# Send a file (PDF, XLSX, DOCX, CSV, TXT) — large files are split and combined for you
client.run("${id}", "Summarise this", file="report.pdf")`
  const jsExample = `const AISTRIX_API_KEY = process.env.AISTRIX_API_KEY

async function runAistrixApp(payload) {
  const res = await fetch("${endpoint}", {
    method: "POST",
    headers: {
      "Authorization": \`Bearer \${AISTRIX_API_KEY}\`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ...payload, stream: false }),
  })

  const body = await res.json()
  if (!res.ok) {
    const errors = body?.detail?.errors || body?.errors || []
    throw new Error([body?.detail?.message || body?.detail || body?.error, ...errors].filter(Boolean).join("\\n"))
  }
  return body.data ?? body.output
}

const result = await runAistrixApp(${requestBody})
console.log(result)`
  const batchExample = `# Queue up to 1,000 rows; they run on the server
batch = client.create_batch("${id}", ${isNative ? `[{${(app.form_schema || []).slice(0, 2).map(f => `"${fieldKeyFromLabel(f.label)}": "..."`).join(', ')}}, ...]` : '["first input", "second input"]'})
print(batch.warnings)                      # e.g. platform limits that will stop it early
batch = client.wait_for_batch(batch.id)    # or pass webhook_url= to be notified
for row in client.batch_results(batch.id):
    print(row["idx"], row["status"], row["data"] or row["output"])

# REST
POST ${API_BASE}/apps/${id}/batches   {"rows": [...]}  or  {"csv": "header,...\\nvalue,..."}
GET  ${API_BASE}/batches/{batch_id}
GET  ${API_BASE}/batches/{batch_id}/results?format=json|csv
POST ${API_BASE}/batches/{batch_id}/cancel
POST ${API_BASE}/batches/{batch_id}/retry   # resume rows that failed or hit a limit`
  const curlExample = `curl -X POST ${endpoint} \\
  -H "Authorization: Bearer ak_live_your_key_here" \\
  -H "Content-Type: application/json" \\
  -d '${requestBody.replace(/\n/g, '\n  ')}'`

  const structuredExample = app.output_type === 'table'
    ? [{ Column1: 'Value', Column2: 'Value' }]
    : app.output_type === 'key_value' || app.output_type === 'json'
    ? { Field1: 'Value', Field2: 'Value' }
    : null
  const responseExample = JSON.stringify({
    output: structuredExample ? JSON.stringify(structuredExample) : 'AI-generated response text...',
    data: structuredExample,
    provider: app.ai_provider || 'claude',
    model: app.ai_model || 'claude-sonnet-5-5',
    usage: { input_tokens: 412, output_tokens: 238 },
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
          <p className="text-slate-400 text-sm">
            Machine-readable API schema: <a className="text-[#6C5CE7] hover:underline" href={`${API_ROOT}/openapi.json`} target="_blank" rel="noreferrer">OpenAPI JSON</a>
          </p>
        </Section>

        <Section title="Authentication">
          <p className="text-slate-400 text-sm">Pass your API key as a Bearer token in the Authorization header. Generate keys in the <a href="/" className="text-[#6C5CE7] hover:underline">Developer Dashboard</a>.</p>
          <CodeBlock code={`Authorization: Bearer ak_live_your_key_here`} />
        </Section>

        <Section title="Request body">
          {isNative ? (
            <>
              <p className="text-slate-400 text-sm mb-3">Pass each parameter in the <code className="text-[#6C5CE7]">fields</code> object. Missing required fields or wrong types return <code className="text-[#6C5CE7]">422</code> with a list of problems.</p>
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
                        <td className="px-3 py-2 text-white font-mono text-xs">{fieldKeyFromLabel(f.label)}</td>
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
          <p className="text-slate-400 text-sm">Optional: <code className="text-[#6C5CE7]">{'"file": {"file_name": "report.pdf", "content_b64": "..."}'}</code> sends a PDF, XLSX, DOCX, CSV, TXT, JSON or MD file (max 10 MB). Files too large for one model call are split, analysed in parts, and combined.</p>
          <CodeBlock code={curlExample} />
        </Section>

        {outputFields.length > 0 && (
          <Section title="Output schema">
            <p className="text-slate-400 text-sm">Every response is validated against these fields. Invalid responses are repaired once automatically; if still invalid you get <code className="text-[#6C5CE7]">422 Output contract failed</code> instead of bad data. With <code className="text-[#6C5CE7]">"stream": false</code> the parsed object is in <code className="text-[#6C5CE7]">data</code>.</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-[#1F2444] text-left">
                  <th className="px-3 py-2 text-xs text-slate-400 font-medium">Field</th>
                  <th className="px-3 py-2 text-xs text-slate-400 font-medium">Type</th>
                  <th className="px-3 py-2 text-xs text-slate-400 font-medium">Required</th>
                  <th className="px-3 py-2 text-xs text-slate-400 font-medium">Description</th>
                </tr></thead>
                <tbody>
                  {outputFields.map(f => (
                    <tr key={f.field} className="border-t border-white/5">
                      <td className="px-3 py-2 text-white font-mono text-xs">{f.field}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{f.type === 'enum' ? `one of ${(f.enum_values || []).join(' | ')}` : f.type}</td>
                      <td className="px-3 py-2 text-xs">{f.required !== false ? <span className="text-red-400">yes</span> : <span className="text-slate-500">no</span>}</td>
                      <td className="px-3 py-2 text-slate-400 text-xs">{f.description || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>
        )}

        <Section title="Python SDK">
          <CodeBlock code={pythonExample} />
          <p className="text-slate-400 text-sm">Errors are typed: <code className="text-[#6C5CE7]">AuthenticationError</code>, <code className="text-[#6C5CE7]">PaymentRequiredError</code>, <code className="text-[#6C5CE7]">ContractError</code> (with <code className="text-[#6C5CE7]">.errors</code>), <code className="text-[#6C5CE7]">RateLimitError</code>, <code className="text-[#6C5CE7]">NotFoundError</code>, <code className="text-[#6C5CE7]">APIError</code>.</p>
        </Section>

        <Section title="JavaScript / TypeScript">
          <p className="text-slate-400 text-sm">Use raw HTTP today, or generate a typed client from the OpenAPI schema. This snippet returns parsed <code className="text-[#6C5CE7]">data</code> for structured apps and raw <code className="text-[#6C5CE7]">output</code> for text apps.</p>
          <CodeBlock code={jsExample} />
        </Section>

        <Section title="Batches">
          <p className="text-slate-400 text-sm">Run many inputs through this app server-side — the job keeps going if your process exits. Rows that hit a rate limit or quota stay queued; call <code className="text-[#6C5CE7]">retry</code> to resume. Add your own provider key in Aistrix to remove platform limits.</p>
          <CodeBlock code={batchExample} />
        </Section>

        <Section title="Response">
          <p className="text-slate-400 text-sm">With <code className="text-[#6C5CE7]">"stream": false</code> you get one JSON object. <code className="text-[#6C5CE7]">output</code> is the raw text; <code className="text-[#6C5CE7]">data</code> is the parsed JSON for structured output formats (otherwise <code className="text-[#6C5CE7]">null</code>).</p>
          <CodeBlock code={responseExample} />
          <p className="text-slate-400 text-sm mt-3">Omit <code className="text-[#6C5CE7]">stream</code> (or pass <code className="text-[#6C5CE7]">true</code>) to receive Server-Sent Events: <code className="text-[#6C5CE7]">{'{"token": "..."}'}</code> chunks, then <code className="text-[#6C5CE7]">{'{"done": true, "usage": {...}}'}</code>.</p>
          <p className="text-slate-400 text-sm mt-3">Errors: <code className="text-[#6C5CE7]">401</code> invalid key · <code className="text-[#6C5CE7]">402</code> purchase or quota required · <code className="text-[#6C5CE7]">404</code> app not published · <code className="text-[#6C5CE7]">422</code> input or output contract failed · <code className="text-[#6C5CE7]">429</code> rate limit · <code className="text-[#6C5CE7]">502</code> model provider error.</p>
        </Section>

        {app.is_paid && app.price_per_run > 0 && (
          <Section title="Pricing">
            <div className="flex items-center gap-4">
              <div className="text-center bg-[#1F2444] rounded-xl p-4 flex-1">
                <p className="text-2xl font-bold text-white">${app.price_per_run}</p>
                <p className="text-xs text-slate-400 mt-0.5">per API call</p>
              </div>
              <p className="text-slate-400 text-sm flex-1">Requires an active purchase for the key owner's account. Only successful runs count toward your quota.</p>
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
