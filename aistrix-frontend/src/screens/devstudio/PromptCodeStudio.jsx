import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { manageRequest } from '../../lib/manageApi'
import { canonical, fixtureFiles, outputMatches, proposalMatches, sourceSignature } from '../../lib/codeStudio'
import ConfirmDialog from '../../components/ConfirmDialog'
import AppLifecycleActions from './AppLifecycleActions'

const Editor = lazy(() => import('@monaco-editor/react').then(module => ({ default: module.default })))
const button = 'min-h-10 rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200 hover:bg-white/5 disabled:opacity-40'
const primary = `${button} bg-violet-500/20 border-violet-400/40`
const field = 'w-full min-h-10 rounded-lg border border-white/15 bg-[#0E1424] p-3 text-xs text-white'
const panel = 'min-w-0 space-y-4 rounded-xl border border-white/10 bg-[#131929] p-4'
const pretty = value => JSON.stringify(value, null, 2)

function InputForm({ schema, value, onChange, disabled }) {
  let input
  try { input = JSON.parse(value) } catch { return null }
  if (!schema?.properties || !input || Array.isArray(input) || typeof input !== 'object') return null
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">{Object.entries(schema.properties).filter(([, config]) => ['number', 'integer', 'string', 'boolean'].includes(config.type)).map(([name, config]) => <label key={name} className="text-xs text-slate-400 space-y-2"><span className="block">{config.title || name}{schema.required?.includes(name) ? ' *' : ''}</span>{config.type === 'boolean' ? <input aria-label={`Preview ${name}`} type="checkbox" disabled={disabled} checked={!!input[name]} onChange={event => onChange(pretty({ ...input, [name]: event.target.checked }))} /> : <input aria-label={`Preview ${name}`} className={field} type={config.type === 'string' ? 'text' : 'number'} step={config.type === 'integer' ? '1' : 'any'} value={input[name] ?? ''} disabled={disabled} onChange={event => {
    const next = { ...input }
    if (event.target.value === '') delete next[name]
    else next[name] = config.type === 'string' ? event.target.value : Number(event.target.value)
    onChange(pretty(next))
  }} />}</label>)}</div>
}

export default function PromptCodeStudio({ app, user, onDeleted, navigationGuardRef, legacy }) {
  const base = `/v1/apps/${app.id}/code`
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState(null)
  const [history, setHistory] = useState([])
  const [files, setFiles] = useState({})
  const [manifest, setManifest] = useState('')
  const [selectedFile, setSelectedFile] = useState('main.py')
  const [newFile, setNewFile] = useState('')
  const [instruction, setInstruction] = useState('')
  const [provider, setProvider] = useState('claude')
  const [messages, setMessages] = useState([])
  const [proposal, setProposal] = useState(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState(null)
  const [mobileTab, setMobileTab] = useState('prompt')
  const [rich, setRich] = useState(false)
  const [width, setWidth] = useState(300)
  const [input, setInput] = useState('{}')
  const [testIndex, setTestIndex] = useState('')
  const [preview, setPreview] = useState(null)
  const [undo, setUndo] = useState(null)
  const [legacyMode, setLegacyMode] = useState(false)
  const alive = useRef(true)
  const bypass = useRef(false)
  const latest = useRef({})
  latest.current = { files, manifest, draft }
  let dirty = false
  try { dirty = !!draft && sourceSignature(files, manifest) !== sourceSignature(draft.source.files, draft.source.manifest) } catch { dirty = !!draft }
  const { schemas, tests } = fixtureFiles(files)
  const builds = (data?.builds || data?.tasks || []).filter(task => task.kind === 'build' && task.status === 'succeeded')
  const build = !dirty && builds.find(task => task.source_id === draft?.source.id)
  const currentTask = preview && data?.tasks.find(task => task.id === preview.id)
  const pending = data?.tasks.some(task => ['queued', 'running'].includes(task.status))
  const proposalCurrent = !!proposal && proposalMatches(proposal, draft?.revision, files, manifest)

  function applyDraft(next) {
    setDraft(next); setFiles(next.source.files); setManifest(pretty(next.source.manifest)); setProposal(null)
    setSelectedFile(name => Object.hasOwn(next.source.files, name) ? name : Object.keys(next.source.files)[0])
  }
  const refreshJobs = useCallback(async () => {
    const result = await manageRequest(base)
    if (alive.current) setData(result)
  }, [base])
  async function reload() {
    const [studio, status] = await Promise.all([manageRequest(`${base}/studio`), manageRequest(base)])
    if (!alive.current) return
    if (!studio.draft?.source) { setLegacyMode(true); return }
    setData(status); setHistory(studio.history || []); applyDraft(studio.draft)
  }
  useEffect(() => {
    alive.current = true
    reload().catch(err => { if (alive.current) setError(`${err.message} The revisioned Studio requires the code-studio migration.`) })
    const timer = setInterval(() => refreshJobs().catch(err => { if (alive.current) setError(err.message) }), 3000)
    return () => { alive.current = false; clearInterval(timer) }
  }, [base, refreshJobs]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (legacyMode) return undefined
    const guard = proceed => {
      if (busy) return false
      if ((!dirty && !proposal && !instruction.trim()) || bypass.current) return true
      setConfirmation({ title: 'Unsaved Studio changes', label: 'Discard and continue', action: () => { bypass.current = true; try { proceed?.() } finally { bypass.current = false } } })
      return false
    }
    if (navigationGuardRef) navigationGuardRef.current = guard
    const unload = event => { if (dirty || busy || proposal || instruction.trim()) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => { if (navigationGuardRef?.current === guard) navigationGuardRef.current = null; window.removeEventListener('beforeunload', unload) }
  }, [navigationGuardRef, dirty, busy, proposal, instruction, legacyMode])
  async function perform(kind, action) {
    setBusy(kind); setError('')
    try { await action() } catch (err) { if (alive.current) setError(err.status === 409 ? `${err.message} Reload the draft to review the current version; your local files have been kept.` : err.message) }
    finally { if (alive.current) setBusy('') }
  }
  const post = (path, body, headers) => manageRequest(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  async function save(nextFiles = files, nextManifest = JSON.parse(manifest), revision = draft.revision) {
    const result = await manageRequest(`${base}/studio/draft`, { method: 'PUT', body: JSON.stringify({ revision, files: nextFiles, manifest: nextManifest }) })
    if (alive.current) { applyDraft(result.draft); const studio = await manageRequest(`${base}/studio`); if (alive.current) setHistory(studio.history || []) }
    return result.draft
  }
  function requestReload() {
    if (dirty || proposal || instruction.trim()) setConfirmation({ title: 'Reload current revision?', label: 'Reload draft', action: reload })
    else perform('reload', reload)
  }
  function generate(event) {
    event.preventDefault()
    perform('generate', async () => {
      const submitted = { revision: draft.revision, instruction: instruction.trim(), provider, files, manifest: JSON.parse(manifest) }
      const signature = sourceSignature(files, manifest)
      setMessages(prev => [...prev.slice(-15), { role: 'You', text: submitted.instruction }]); setInstruction(''); setProposal(null)
      let response
      try { response = await post('/studio/proposals', submitted) }
      catch (err) { if (alive.current) setInstruction(submitted.instruction); throw err }
      if (!alive.current) return
      setProposal({ ...response.proposal, localSignature: signature })
      setMessages(prev => [...prev, { role: 'Aistrix', text: response.proposal.summary, usage: response.usage }])
    })
  }
  function accept() {
    perform('accept', async () => {
      const current = latest.current
      if (!proposalMatches(proposal, current.draft.revision, current.files, current.manifest)) throw new Error('The files changed after this proposal was requested. Discard it and generate changes against the latest code.')
      const previous = { files: current.files, manifest: JSON.parse(current.manifest) }
      await save(proposal.files, proposal.manifest, proposal.base_revision)
      setUndo(previous)
      setMessages(prev => [...prev, { role: 'Studio', text: 'Changes accepted as a new draft revision. Build and run a test to verify the result.' }])
    })
  }
  function previewRun() {
    perform('preview', async () => {
      const payload = JSON.parse(input)
      const test = testIndex === '' ? null : tests[Number(testIndex)]
      const response = await post('/preview', { build_id: build.id, input: payload })
      setPreview({ id: response.task.id, source_id: draft.source.id, build_id: build.id, input: payload, expected: test && canonical(test.input) === canonical(payload) ? test.expected : undefined, testName: test?.name })
      await refreshJobs()
    })
  }
  function runDeployed() {
    perform('run', async () => {
      const response = await post('/runs', JSON.parse(input), { 'X-Code-Build-ID': data.deployment.build_id })
      setPreview({ id: response.task.id, source_id: response.task.source_id || data.deployment.source_id, build_id: data.deployment.build_id, mode: 'deployed' })
      setMobileTab('preview')
      await refreshJobs()
    })
  }
  if (legacyMode) return <><p className="text-sm text-amber-200">This server does not expose the revisioned AI Studio yet. The existing code workspace is available below.</p>{legacy}</>
  return <div role="region" aria-label="Prompt-to-code Studio" className="space-y-4">
    <header className="flex flex-wrap justify-between gap-3"><div><p className="text-xs text-violet-300 uppercase tracking-widest">Aistrix AI Studio</p><h1 className="text-2xl text-white font-semibold mt-2">{app.name}</h1><p className="text-sm text-slate-400 mt-2">Describe → Inspect → Test → Preview → Refine → Deploy</p></div><button className={button} onClick={requestReload} disabled={!!busy}>Reload draft</button></header>
    {error && <p role="alert" className="text-sm text-amber-300 whitespace-pre-wrap">{error}</p>}
    {!draft && <div className={panel}><p role="status" className="text-sm text-slate-400">{error ? 'Studio is not ready. Your source has not changed.' : 'Loading source workspace…'}</p>{error && <button className={button} onClick={() => setLegacyMode(true)}>Open existing code workspace</button>}</div>}
    {draft && <>
      <div className="flex flex-wrap gap-3 items-center text-xs text-slate-400"><span>Draft revision {draft.revision}{dirty ? ' · Unsaved manual changes' : ''}</span><span>Execution: {data?.capabilities?.provider === 'e2b' ? 'E2B managed sandbox' : 'Dedicated worker'}</span><span>Build worker: {data?.capabilities?.build ? 'Available' : 'Unavailable'}</span><span>Run worker: {data?.capabilities?.run ? 'Available' : 'Unavailable'}</span><button className={button} onClick={() => setWidth(value => Math.max(240, value - 40))}>Narrow prompt panel</button><button className={button} onClick={() => setWidth(value => Math.min(500, value + 40))}>Widen prompt panel</button></div>
      {(!data?.capabilities?.build || !data?.capabilities?.run) && <p className="text-xs text-amber-200">{data?.capabilities?.reason || 'Isolated workers are unavailable. You can generate and save code, but a preview needs healthy build and run workers. No generated code executes in the API.'}</p>}
      <nav aria-label="Studio panels" className="flex gap-2 lg:hidden">{['prompt', 'code', 'preview'].map(tab => <button key={tab} className={`${button} capitalize`} aria-pressed={mobileTab === tab} onClick={() => setMobileTab(tab)}>{tab}</button>)}</nav>
      <div className="lg:flex gap-3 lg:overflow-x-auto items-stretch">
        <section aria-label="Development instructions" style={{ '--prompt-width': `${width}px` }} className={`${panel} ${mobileTab === 'prompt' ? '' : 'hidden'} lg:block lg:w-[var(--prompt-width)] lg:min-w-[240px] lg:max-w-[55%] lg:shrink-0 lg:resize-x lg:overflow-auto`}>
          <h2 className="font-semibold text-white">Prompt</h2><p className="text-xs text-slate-400">Each request reads your current files, schemas, and authored test fixtures. Manual edits are part of the project.</p>
          <div className="space-y-3 max-h-80 overflow-y-auto" aria-label="Development conversation">{messages.map((message, i) => <article key={i} className="rounded-lg bg-white/5 p-3"><p className="text-xs font-semibold text-violet-300">{message.role}</p><p className="text-xs text-slate-300 mt-2 whitespace-pre-wrap">{message.text}</p>{message.usage && <p className="text-[10px] text-slate-500 mt-2">{message.usage.model} · {message.usage.cost_usd == null ? 'Cost not reported' : `$${message.usage.cost_usd.toFixed(6)}`}</p>}</article>)}</div>
          <form onSubmit={generate} className="space-y-3"><label className="block text-xs text-slate-400">Describe the next change<textarea aria-label="Development instruction" className={`${field} mt-2`} rows={6} maxLength={8000} value={instruction} disabled={!!busy} onChange={event => setInstruction(event.target.value)} placeholder="Create a sales tax calculator, then add a discount before tax…" /></label><label className="block text-xs text-slate-400">AI provider<select aria-label="Development AI provider" className={`${field} mt-2`} value={provider} disabled={!!busy} onChange={event => setProvider(event.target.value)}>{['claude', 'openai'].map(value => <option key={value} value={value}>{value}</option>)}</select></label><p className="text-[11px] text-slate-500">Uses your provider key and spending controls. Requests can incur model charges.</p><button className={primary} disabled={!!busy || !instruction.trim()}>{busy === 'generate' ? 'Generating proposal…' : 'Propose code changes'}</button></form>
          {proposal && <section className="space-y-3 border-t border-white/10 pt-4" aria-label="Proposed changes"><h3 className="text-sm text-white font-semibold">Review changes</h3><p className="text-xs text-slate-400">{proposal.summary}</p>{!proposalCurrent && <p role="status" className="text-xs text-amber-300">Your files have changed. This proposal cannot overwrite them.</p>}{proposal.changes.map(change => <details key={change.path} className="text-xs text-slate-300"><summary className="cursor-pointer break-all">{change.path} · {change.content === null ? 'Delete' : Object.hasOwn(files, change.path) ? 'Modify' : 'Add'}</summary><div className="grid gap-2 mt-2"><p className="text-slate-500">Before</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{files[change.path] || '(new file)'}</pre><p className="text-violet-300">Proposed</p><pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words">{change.content ?? '(deleted)'}</pre></div></details>)}<div className="flex flex-wrap gap-2"><button className={primary} disabled={!!busy || !proposalCurrent} onClick={accept}>Accept changes</button><button className={button} disabled={!!busy} onClick={() => setProposal(null)}>Discard proposal</button></div></section>}
        </section>
        <section aria-label="Project files" className={`${panel} ${mobileTab === 'code' ? '' : 'hidden'} lg:block lg:flex-1 lg:min-w-[320px]`}>
          <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold text-white">Code</h2><button className={button} onClick={() => setRich(value => !value)}>{rich ? 'Plain text editor' : 'Monaco editor'}</button></div>
          <div className="flex flex-wrap gap-2">{Object.keys(files).map(name => <button key={name} className={`${button} ${selectedFile === name ? 'bg-violet-500/20' : ''}`} aria-pressed={selectedFile === name} onClick={() => setSelectedFile(name)}>{name}</button>)}</div>
          <p className="text-xs text-slate-400 break-all">Editing {selectedFile}</p>
          {rich ? <Suspense fallback={<p role="status" className="text-xs text-slate-400">Loading editor…</p>}><Editor height="440px" path={`${app.id}/${selectedFile}`} language={selectedFile?.endsWith('.py') ? 'python' : selectedFile?.endsWith('.json') ? 'json' : 'plaintext'} theme="vs-dark" value={files[selectedFile] || ''} onChange={value => setFiles(prev => ({ ...prev, [selectedFile]: value || '' }))} options={{ readOnly: !!busy && busy !== 'generate', minimap: { enabled: false }, fontSize: 12, wordWrap: 'on' }} /></Suspense> : <textarea aria-label={`Source ${selectedFile}`} spellCheck={false} className={`${field} font-mono min-h-[440px]`} value={files[selectedFile] || ''} disabled={!!busy && busy !== 'generate'} onChange={event => setFiles(prev => ({ ...prev, [selectedFile]: event.target.value }))} />}
          <div className="flex flex-wrap gap-2"><input className={field} aria-label="New source file path" placeholder="helpers.py" value={newFile} onChange={event => setNewFile(event.target.value)} /><button className={button} disabled={!!busy} onClick={() => {
            if (!/^[A-Za-z0-9_/-]+\.(py|txt|json|toml|md)$/.test(newFile) || newFile.includes('..') || Object.hasOwn(files, newFile)) { setError('Enter a new relative text-file path.'); return }
            setFiles(prev => ({ ...prev, [newFile]: '' })); setSelectedFile(newFile); setNewFile('')
          }}>Add file</button><button className={button} disabled={!!busy || ['main.py', 'schemas.json', 'tests.json'].includes(selectedFile)} onClick={() => { const next = { ...files }; delete next[selectedFile]; setFiles(next); setSelectedFile('main.py') }}>Remove file</button></div>
          <details><summary className="cursor-pointer text-xs text-slate-400">Execution manifest</summary><textarea aria-label="Execution manifest" rows={8} className={`${field} font-mono mt-2`} value={manifest} disabled={!!busy && busy !== 'generate'} onChange={event => setManifest(event.target.value)} /></details>
          <div className="flex flex-wrap gap-2"><button className={primary} disabled={!!busy} onClick={() => perform('save', () => save())}>Save draft revision</button><button className={button} disabled={!!busy || dirty || !draft.source.id || !data?.capabilities?.build || !!build} onClick={() => perform('build', async () => { await post('/builds', { source_id: draft.source.id }); await refreshJobs() })}>{build ? 'Build cached for this source' : 'Build saved version'}</button></div>
          {undo && <button className={button} disabled={!!busy} onClick={() => setConfirmation({ title: 'Revert last accepted change?', label: 'Revert as new revision', action: () => perform('revert', async () => { await save(undo.files, undo.manifest); setUndo(null) }) })}>Revert last accepted change</button>}
          <details><summary className="text-xs text-slate-400 cursor-pointer">Revision history</summary><div className="space-y-2 mt-3">{history.map(item => <div key={item.revision} className="text-xs text-slate-400 flex flex-wrap gap-2 items-center"><span>Revision {item.revision} · {item.created_at}</span><button className={button} disabled={!!busy || !item.source || item.source_id === draft.source.id} onClick={() => setConfirmation({ title: `Restore revision ${item.revision}?`, label: 'Restore as new revision', action: () => perform('restore', () => save(item.source.files, item.source.manifest)) })}>Restore revision {item.revision}</button></div>)}</div></details>
        </section>
        <section aria-label="Sandbox preview" className={`${panel} ${mobileTab === 'preview' ? '' : 'hidden'} lg:block lg:w-[300px] lg:min-w-[260px] lg:max-w-[55%] lg:resize-x lg:overflow-auto lg:shrink-0`}>
          <h2 className="font-semibold text-white">Live preview</h2><p className="text-xs text-slate-400">Runs the exact saved build in the isolated Python worker. Inputs and outputs are JSON; previews do not deploy your project.</p>
          <label className="block text-xs text-slate-400">Test case<select aria-label="Preview test case" className={`${field} mt-2`} value={testIndex} onChange={event => { setTestIndex(event.target.value); if (event.target.value !== '') setInput(pretty(tests[Number(event.target.value)].input)) }}><option value="">Custom input</option>{Array.isArray(tests) && tests.map((test, i) => <option key={i} value={i}>{test.name}</option>)}</select></label>
          <InputForm schema={schemas.input} value={input} onChange={setInput} disabled={!!busy} />
          <label className="block text-xs text-slate-400">JSON input<textarea aria-label="Preview JSON input" rows={6} className={`${field} mt-2 font-mono`} value={input} disabled={!!busy} onChange={event => setInput(event.target.value)} /></label>
          <button className={primary} disabled={!!busy || !build || !data?.capabilities?.run || pending} onClick={previewRun}>Run sandbox preview</button>
          {!build && <p className="text-xs text-slate-400">Save and build this source revision to enable its preview.</p>}
          {preview && <section aria-label="Preview result" className="space-y-3"><p className="text-[11px] text-slate-500 break-all">Build {preview.build_id} · Job {preview.id}</p>{(dirty || preview.source_id !== draft.source.id) && <p className="text-xs text-amber-300">Output belongs to an earlier source version. Rebuild and run to verify your latest edits.</p>}<p className="text-xs text-slate-500">{preview.mode === 'deployed' ? 'Deployed version run' : 'Draft preview run'}</p><p role="status" className="text-sm text-slate-300">{currentTask?.status || 'queued'}</p>{currentTask?.error && <p className="text-xs text-red-300">{currentTask.error}</p>}{currentTask?.result && <pre className="text-xs text-slate-200 whitespace-pre-wrap break-words max-h-80 overflow-auto">{pretty(currentTask.result.output)}</pre>}{currentTask?.status === 'succeeded' && preview.expected !== undefined && <p className={`text-sm ${outputMatches(currentTask.result?.output, preview.expected) ? 'text-emerald-300' : 'text-amber-300'}`}>{outputMatches(currentTask.result?.output, preview.expected) ? 'Test passed' : 'Test failed: output differs from expected'}</p>}{currentTask?.logs && <pre className="text-xs text-slate-400 whitespace-pre-wrap break-words max-h-48 overflow-auto">{currentTask.logs}</pre>}{currentTask && ['queued', 'running'].includes(currentTask.status) && <button className={button} disabled={!!busy} onClick={() => perform('cancel', async () => { await post(`/tasks/${currentTask.id}/cancel`, {}); await refreshJobs() })}>Cancel preview</button>}</section>}
          <button className={button} disabled={!!busy} onClick={() => perform('refresh', refreshJobs)}>Refresh jobs</button>
        </section>
      </div>
      <section className={panel} aria-label="Private deployment"><h2 className="text-white font-semibold">Private deployment</h2><p className="text-xs text-slate-500 break-all">Authenticated job endpoint: POST {base}/runs</p><button className={button} disabled={!!busy || !data?.deployment || !data?.capabilities?.run || data?.capabilities?.run_deployed === false || pending} onClick={runDeployed}>Run deployed version</button><p className="text-xs text-slate-400">An explicit deployment selects the build for authenticated job calls. Source saves, AI proposals, and previews do not change the active deployment.</p>{builds.map(item => <div key={item.id} className="flex flex-wrap items-center gap-3 text-xs text-slate-400"><span className="break-all">Build {item.id} · Source {item.source_id}</span><button className={button} disabled={!!busy || !data?.capabilities?.enabled || data.deployment?.build_id === item.id} onClick={() => setConfirmation({ title: 'Deploy this build?', label: 'Deploy privately', action: () => perform('deploy', async () => { await post('/deploy', { build_id: item.id, expected_build_id: data.deployment?.build_id || null }); await refreshJobs() }) })}>{data.deployment?.build_id === item.id ? 'Active' : 'Deploy build'}</button></div>)}</section>
      <details className={panel}><summary className="text-sm text-white cursor-pointer">Build and run history</summary>{data?.tasks?.map(task => <details key={task.id} className="text-xs text-slate-400"><summary className="cursor-pointer">{task.kind} {task.id} · {task.status}</summary><pre className="whitespace-pre-wrap break-words max-h-64 overflow-auto">{pretty({ source: task.source_id, output: task.result, logs: task.logs, error: task.error })}</pre></details>)}</details>
      {user && <AppLifecycleActions app={app} user={user} onDeleted={onDeleted} disabled={!!busy || dirty || pending} />}
    </>}
    {confirmation && <ConfirmDialog title={confirmation.title} confirmLabel={confirmation.label} onCancel={() => setConfirmation(null)} onConfirm={async () => { const next = confirmation; setConfirmation(null); await next.action() }}><p>Review this action before continuing. Unsaved local edits will be discarded when reloading, restoring, or leaving. Deployment changes only after confirmation.</p></ConfirmDialog>}
  </div>
}
