import { useEffect, useState } from 'react'
import { getPlatformEvents, getPlatformEvals, getPlatformResource, getPlatformRun, listPlatformResources, listPlatformRuns } from '../../lib/platformApi'

const card = 'rounded-xl border border-white/10 bg-[#131929] p-4 space-y-3 min-w-0'
const button = 'rounded-lg border border-white/15 px-3 py-2 text-sm text-slate-200 hover:bg-white/5 min-h-11'
const money = value => value == null ? 'Not reported' : `$${Number(value).toFixed(6)}`
function Json({ value }) {
  return <pre className="text-xs text-slate-300 whitespace-pre-wrap break-words max-h-80 overflow-auto">{JSON.stringify(value, null, 2)}</pre>
}
function useRead(read, deps) {
  const [state, setState] = useState({ loading: true })
  useEffect(() => {
    let active = true
    setState({ loading: true })
    read().then(data => { if (active) setState({ data }) }).catch(error => { if (active) setState({ error: error.message }) })
    return () => { active = false }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}
function ReadState({ state }) {
  return state.loading ? <p role="status" className="text-sm text-slate-400">Loading…</p> : state.error ? <p role="alert" className="text-sm text-amber-300">{state.error}</p> : null
}

function RunDetail({ id, refresh }) {
  const state = useRead(async () => {
    const [run, events] = await Promise.all([getPlatformRun(id), getPlatformEvents(id)])
    return { ...run, ...events }
  }, [id, refresh])
  const run = state.data?.run
  return <section className={card} aria-label="Run details">
    <h3 className="text-white font-semibold">Run details</h3>
    <ReadState state={state} />
    {run && <>
      <p className="text-sm text-slate-300 break-all">{run.id} · {run.status}</p>
      <dl className="grid grid-cols-2 gap-3 text-sm text-slate-300">
        {[['Release ID', run.release_id], ['Environment', run.environment], ['Model cost', money(run.cost_usd)], ['Run budget', money(run.budget_usd)]].map(([label, value]) => <div key={label}><dt className="text-slate-500">{label}</dt><dd className="break-all">{value ?? 'Not reported'}</dd></div>)}
      </dl>
      {run.error && <div role="alert"><Json value={run.error} /></div>}
      <h4 className="text-sm text-white font-medium">Steps</h4><Json value={run.steps} />
      <h4 className="text-sm text-white font-medium">Events</h4>
      {state.data.events?.length ? <Json value={state.data.events} /> : <p className="text-sm text-slate-400">No events recorded.</p>}
    </>}
  </section>
}

function ResourceDetail({ resource, refresh }) {
  const [runId, setRunId] = useState('')
  const [releaseId, setReleaseId] = useState('')
  const state = useRead(async () => {
    const [detail, runs] = await Promise.all([getPlatformResource(resource.key), listPlatformRuns(resource.key)])
    return { ...detail, ...runs }
  }, [resource.key, refresh])
  const evaluations = useRead(() => releaseId ? getPlatformEvals(releaseId) : Promise.resolve(null), [releaseId, refresh])
  return <div className="space-y-4 min-w-0">
    <section className={card}>
      <h2 className="text-white text-lg font-semibold break-all">{resource.name}</h2>
      <p className="text-sm text-slate-400 break-all">{resource.key}</p>
      <ReadState state={state} />
      {state.data && <>
        <h3 className="text-sm font-semibold text-white">Environments</h3>
        <div className="grid gap-3 sm:grid-cols-3">{['dev', 'staging', 'production'].map(stage => <div key={stage} className="rounded-lg bg-white/5 p-3 text-sm"><p className="text-slate-400 capitalize">{stage}</p><p className="text-white break-all">{state.data.environments?.[stage]?.version || 'Not deployed'}</p></div>)}</div>
        <h3 className="text-sm font-semibold text-white">Immutable releases</h3>
        {!state.data.releases?.length && <p className="text-sm text-slate-400">No releases yet.</p>}
        {state.data.releases?.map(release => <div key={release.id} className="border-t border-white/10 pt-3 space-y-2">
          <p className="text-sm text-white break-all">{release.ref}</p>
          <p className="text-xs text-slate-400 break-all">Release ID: {release.id}<br />Content hash: {release.content_hash}</p>
          <button className={button} onClick={() => setReleaseId(release.id)} aria-pressed={releaseId === release.id}>View evaluations</button>
        </div>)}
      </>}
    </section>
    {releaseId && <section className={card}><h3 className="text-white font-semibold">Evaluation results</h3><p className="text-xs text-slate-400 break-all">{releaseId}</p><ReadState state={evaluations} />{evaluations.data && (evaluations.data.results?.length ? <Json value={evaluations.data.results} /> : <p className="text-sm text-slate-400">No evaluation results recorded for this release.</p>)}</section>}
    <section className={card}><h3 className="text-white font-semibold">Recent runs</h3>
      {state.data?.runs?.length === 0 && <p className="text-sm text-slate-400">No runs recorded. Datasets and other artifact resources are not executable workloads.</p>}
      {state.data?.runs?.map(run => <button key={run.id} className={`${button} w-full text-left`} onClick={() => setRunId(run.id)} aria-pressed={runId === run.id}><span className="block break-all">{run.id}</span><span className="text-xs text-slate-400">{run.status} · {run.environment || 'Pinned version'} · {run.created_at}</span></button>)}
    </section>
    {runId && <RunDetail id={runId} refresh={refresh} />}
  </div>
}

export default function ResourcesTab() {
  const [refresh, setRefresh] = useState(0)
  const [key, setKey] = useState('')
  const state = useRead(listPlatformResources, [refresh])
  const resources = state.data?.resources || []
  const selected = resources.find(resource => resource.key === key)
  return <div className="space-y-5">
    <header className="flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-xl font-semibold text-white">Platform resources</h1><p className="text-sm text-slate-400 mt-1">Inspect released resources, environments, evaluations, and execution history.</p></div><button className={button} onClick={() => setRefresh(value => value + 1)}>Refresh</button></header>
    <ReadState state={state} />
    {state.data && !resources.length && <section className={card}><h2 className="text-white font-semibold">No platform resources yet</h2><p className="text-sm text-slate-400">Release a resource with the Aistrix CLI or Platform API. Its immutable releases and runs will appear here.</p><code className="block text-sm text-slate-300">aistrix release --help</code></section>}
    <div className="grid gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <nav aria-label="Platform resources" className="space-y-2">{resources.map(resource => <button key={resource.key} onClick={() => setKey(resource.key)} aria-current={key === resource.key ? 'true' : undefined} className={`${button} w-full text-left ${key === resource.key ? 'bg-violet-500/20 border-violet-400/50' : ''}`}><span className="block break-all">{resource.name}</span><span className="text-xs text-slate-400">{resource.kind} · {resource.namespace}</span></button>)}</nav>
      {selected ? <ResourceDetail key={selected.key} resource={selected} refresh={refresh} /> : resources.length > 0 && <p className="text-sm text-slate-400">Select a resource to inspect its releases and runs.</p>}
    </div>
  </div>
}
