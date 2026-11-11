import { useCallback, useEffect, useRef, useState } from 'react'
import { manageRequest } from '../../lib/manageApi'
import ConfirmDialog from '../../components/ConfirmDialog'
import AppLifecycleActions from './AppLifecycleActions'
import PromptCodeStudio from './PromptCodeStudio'

const button = 'rounded-lg border border-white/15 px-3 py-2 text-xs font-semibold text-white hover:bg-white/5 disabled:opacity-40'
const panel = 'space-y-3 rounded-2xl border border-white/10 bg-[#171B33] p-5'
const field = 'w-full rounded-lg border border-white/10 bg-[#0E1424] p-3 text-xs text-white'
const stable = value => JSON.stringify(value, Object.keys(value || {}).sort())
const snapshot = (files, manifest) => `${stable(files)}:${manifest}`

function LegacyCodeApplicationStudio({ app, user, onDeleted, navigationGuardRef }) {
  const [data, setData] = useState(null)
  const [files, setFiles] = useState({})
  const [manifest, setManifest] = useState('')
  const [saved, setSaved] = useState('')
  const [sourceVersion, setSourceVersion] = useState(null)
  const [selected, setSelected] = useState('main.py')
  const [fileName, setFileName] = useState('')
  const [input, setInput] = useState('{"items":[{"quantity":2,"price":12.5}]}')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirmation, setConfirmation] = useState(null)
  const initialized = useRef(false)
  const alive = useRef(true)
  const bypass = useRef(false)
  const dirty = initialized.current && snapshot(files, manifest) !== saved
  const base = `/v1/apps/${app.id}/code`
  function applySource(source) {
    const text = JSON.stringify(source.manifest, null, 2)
    setFiles(source.files); setManifest(text); setSaved(snapshot(source.files, text))
    setSourceVersion(source.id ? { id:source.id, hash:source.source_hash } : null)
    setSelected(Object.keys(source.files)[0] || 'main.py')
  }
  const refresh = useCallback(async () => {
    const result = await manageRequest(base)
    if (!result.capabilities || !Array.isArray(result.tasks) || !result.starter?.files) throw new Error('The code-hosting response is incomplete.')
    if (!alive.current) return
    setData(result)
    if (!initialized.current) { applySource(result.source || result.starter); initialized.current = true }
  }, [base])
  useEffect(() => {
    alive.current = true
    refresh().catch(error => { if (alive.current) setError(error.message) })
    const timer = setInterval(() => refresh().catch(error => { if (alive.current) setError(error.message) }), 5000)
    return () => { alive.current = false; clearInterval(timer) }
  }, [refresh])
  useEffect(() => {
    const guard = proceed => {
      if (busy) return false
      if (!dirty || bypass.current) return true
      setConfirmation({ title: 'Unsaved code changes', label: 'Discard and continue', action: () => { bypass.current = true; try { proceed?.() } finally { bypass.current = false } } })
      return false
    }
    if (navigationGuardRef) navigationGuardRef.current = guard
    const unload = event => { if (dirty || busy) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', unload)
    return () => {
      if (navigationGuardRef?.current === guard) navigationGuardRef.current = null
      window.removeEventListener('beforeunload', unload)
    }
  }, [navigationGuardRef, dirty, busy])
  async function perform(action) {
    setBusy(true); setError('')
    try { await action(); await refresh() }
    catch (error) { if (alive.current) setError(error.message) }
    finally { if (alive.current) setBusy(false) }
  }
  const request = (path, body, headers) => manageRequest(`${base}${path}`, { method: 'POST', headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) })
  const latestBuilds = (data?.builds || data?.tasks || []).filter(task => task.kind === 'build' && task.status === 'succeeded')
  return <div className="space-y-5" aria-label="Code application workspace">
    <header><h1 className="text-2xl font-semibold text-white">{app.name}</h1><p className="mt-2 text-sm text-slate-400">Python job · private deployment · JSON input/output · no outbound network</p></header>
    {error && <p role="alert" className="rounded-xl border border-red-400/20 p-3 text-sm text-red-200">{error}</p>}
    {!data ? <button className={button} onClick={() => perform(refresh)} disabled={busy}>Reload code workspace</button> : <>
      <section className={panel} aria-label="Code hosting status">
        <h2 className="text-sm font-semibold text-white">Hosting status</h2>
        <p className="text-xs text-slate-300">Build worker: {data.capabilities.build ? 'Available' : 'Unavailable'} · Execution worker: {data.capabilities.run ? 'Available' : 'Unavailable'}</p>
        {(!data.capabilities.build || !data.capabilities.run) && <p className="text-xs text-amber-200">An operator must configure isolated workers before building or running. Saving source does not compile, deploy or execute it.</p>}
        <p className="text-xs text-slate-400">5 builds and 100 runs per owner per UTC day; 2 active jobs. Each run uses 1 CPU, the manifest memory limit and a deadline of at most 120 seconds.</p>
      </section>
      <section className={panel} aria-label="Application source">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="text-sm font-semibold text-white">Source {dirty && <span className="text-amber-300">· Unsaved changes</span>}</h2>
          <label className={`${button} cursor-pointer`}>Import source ZIP<input aria-label="Import source ZIP" type="file" accept=".zip,application/zip" disabled={busy} className="sr-only" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''
            if (!file) return
            if (file.size > 524288) { setError('ZIP upload must be at most 512 KiB.'); return }
            const action = () => perform(async () => {
              const result = await manageRequest(`${base}/source`, { method: 'PUT', body: file, headers: { 'Content-Type': 'application/zip' } })
              applySource(result.source)
            })
            setConfirmation({ title: 'Import source version?', label: 'Import ZIP', action })
          }} /></label>
        </div>
        <p className="text-xs text-slate-400">Provide main.py with run(payload). Optional requirements.txt dependencies need exact versions and SHA-256 wheel hashes. ZIP paths must start at the project root; aistrix.json supplies the manifest.</p>
        <fieldset disabled={busy} className="space-y-3">
          <div className="flex flex-wrap gap-2">{Object.keys(files).map(name => <button key={name} className={`${button} ${selected === name ? 'bg-[#6C5CE7]/30' : ''}`} onClick={() => setSelected(name)}>{name}</button>)}</div>
          <label className="block text-xs text-slate-300">Editing {selected}<textarea aria-label={`Source ${selected}`} spellCheck={false} rows={14} className={`${field} mt-2 font-mono`} value={files[selected] || ''} onChange={event => setFiles(previous => ({ ...previous, [selected]: event.target.value }))} /></label>
          <div className="flex flex-wrap gap-2"><input aria-label="New source file path" className={`${field} max-w-xs`} placeholder="helpers.py" value={fileName} onChange={event => setFileName(event.target.value)} /><button className={button} onClick={() => {
            if (!/^[A-Za-z0-9_/-]+\.(py|txt|json|toml|md)$/.test(fileName) || Object.hasOwn(files, fileName)) { setError('Enter a new relative source-file path.'); return }
            setFiles(previous => ({ ...previous, [fileName]: '' })); setSelected(fileName); setFileName('')
          }}>Add file</button><button className={button} onClick={() => { const next = { ...files }; delete next[selected]; setFiles(next); setSelected(Object.keys(next)[0] || 'main.py') }}>Remove selected file</button></div>
          <label className="block text-xs text-slate-300">Execution manifest<textarea aria-label="Execution manifest" rows={9} spellCheck={false} className={`${field} mt-2 font-mono`} value={manifest} onChange={event => setManifest(event.target.value)} /></label>
        </fieldset>
        <div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={() => perform(async () => {
          const config = JSON.parse(manifest)
          const result = await manageRequest(`${base}/source`, { method: 'PUT', body: JSON.stringify({ files, manifest: config }) })
          applySource(result.source)
        })}>Save source version</button><button className={button} disabled={busy || dirty || !sourceVersion || !data.capabilities.build} onClick={() => perform(() => request('/builds', { source_id: sourceVersion.id }))}>Build saved version</button></div>
        {sourceVersion && <p className="break-all text-[11px] text-slate-500">Saved source: {sourceVersion.hash}</p>}
      </section>
      <section className={panel} aria-label="Code deployment">
        <h2 className="text-sm font-semibold text-white">Private deployment</h2>
        <p className="break-all text-xs text-slate-400">{data.deployment ? `Active build: ${data.deployment.build_id}` : 'No build has been deployed.'}</p>
        <p className="text-xs text-slate-400">Deploy selects an immutable image for new jobs. Existing jobs keep their original version. Deploy an earlier successful build to roll back. This does not publish a Marketplace listing.</p>
        {latestBuilds.map(task => <div key={task.id} className="flex flex-wrap items-center gap-3 text-xs text-slate-300"><span>Build {task.id.slice(0, 8)} · {new Date(task.finished_at).toLocaleString()}</span><button className={button} disabled={busy || !data.capabilities.enabled || task.id === data.deployment?.build_id} onClick={() => setConfirmation({ title: 'Deploy this build?', label: 'Deploy privately', action: () => perform(() => request('/deploy', { build_id: task.id, expected_build_id: data.deployment?.build_id || null })) })}>{task.id === data.deployment?.build_id ? 'Active' : 'Deploy build'}</button></div>)}
      </section>
      <section className={panel} aria-label="Run code application">
        <h2 className="text-sm font-semibold text-white">Run deployed version</h2>
        <label className="block text-xs text-slate-300">JSON input<textarea aria-label="Code job JSON input" rows={5} className={`${field} mt-2 font-mono`} value={input} disabled={busy} onChange={event => setInput(event.target.value)} /></label>
        <button className={button} disabled={busy || !data.deployment || !data.capabilities.run} onClick={() => perform(() => request('/runs', JSON.parse(input), { 'X-Code-Build-ID':data.deployment.build_id }))}>Run job</button>
        <p className="break-all text-[11px] text-slate-500">Authenticated job endpoint: POST {base}/runs</p>
      </section>
      <section className={panel} aria-label="Code job history">
        <div className="flex items-center justify-between"><h2 className="text-sm font-semibold text-white">Builds, runs and outputs</h2><button className={button} disabled={busy} onClick={() => perform(refresh)}>Refresh jobs</button></div>
        {!data.tasks.length && <p className="text-xs text-slate-400">No jobs yet.</p>}
        {data.tasks.map(task => <details key={task.id} className="rounded-lg border border-white/10 p-3 text-xs text-slate-300">
          <summary className="cursor-pointer">{task.kind === 'build' ? 'Build' : 'Run'} {task.id.slice(0, 8)} · {task.status} {task.elapsed_ms != null && `· ${(task.elapsed_ms / 1000).toFixed(2)}s elapsed`}</summary>
          <div className="mt-3 space-y-2">{task.error && <p className="text-red-300">{task.error}</p>}{task.result && <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(task.result, null, 2)}</pre>}{task.logs && <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">{task.logs}</pre>}{['queued','running'].includes(task.status) && <button className={button} disabled={busy} onClick={() => perform(() => request(`/tasks/${task.id}/cancel`))}>Cancel job</button>}</div>
        </details>)}
      </section>
      {user && <AppLifecycleActions app={app} user={user} onDeleted={onDeleted} disabled={busy || dirty || data.tasks.some(task => ['queued','running'].includes(task.status))} />}
    </>}
    {confirmation && <ConfirmDialog title={confirmation.title} confirmLabel={confirmation.label} onCancel={() => setConfirmation(null)} onConfirm={async () => { const pending = confirmation; setConfirmation(null); await pending.action() }}>{confirmation.title === 'Unsaved code changes' ? 'Your unsaved source changes will be discarded.' : confirmation.title === 'Import source version?' ? 'The archive will be saved as a new source version and replace the editor contents. Unsaved edits will be discarded.' : 'New jobs will use this build. Confirm that its tests and dependencies are appropriate.'}</ConfirmDialog>}
  </div>
}

export default function CodeApplicationStudio(props) {
  return <PromptCodeStudio {...props} legacy={<LegacyCodeApplicationStudio {...props} />} />
}
