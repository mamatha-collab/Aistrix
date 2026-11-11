import type { User } from '@supabase/supabase-js'
import { errorMessage, isRecord, type CapabilityId, type DeveloperAction, type ProjectSummary } from '../../types/domain'
import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Database } from 'lucide-react'
import { developerCapabilities as capabilities } from '../../lib/developerCapabilities'
import { Link } from '../../navigation'
import { manageRequest } from '../../lib/manageApi'
import { APP_TYPES } from '../../lib/appTypes'
import ProviderConnections from '../../components/ProviderConnections'
import { loadProviders, useProviders } from '../../lib/providers'


const appFormats = APP_TYPES.filter(type => !['agent', 'code_job', 'ai_builder', 'website'].includes(type.id))
const creationMethods = [
  { id: 'ai_builder', label: 'Describe an app with AI', description: 'Use the guided AI builder to configure an app. This is a creation method, not another agent type.' },
  { id: 'website', label: 'Start from a website', description: 'Use an existing website as the starting material for an app.' },
]
const planned = [
  ['MCP hosting', 'Managed MCP server authoring, hosting, authentication, and lifecycle. Connect existing services from Code & Tools today.'],
  ['Reusable resources', 'Standalone Agents and Models, a public Node/Tool SDK, and indexed Knowledge Bases.'],
  ['Prompt assets & hosting', 'Independent versioned prompt assets and general web/API/worker source hosting. App prompt editing and publishing already live inside AI Apps.'],
]

const actionClass = 'inline-flex items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm text-white hover:bg-violet-500/15 hover:border-violet-400/50 min-h-11'

interface NodeContract { use: string; summary: string; accepts: unknown; output: unknown; config: unknown; sideEffect: unknown; hosted: unknown }
function decodeNodes(data: Record<string, unknown>): { nodes: NodeContract[] } {
  if (!Array.isArray(data.nodes)) throw new Error('Node contracts could not be verified.')
  return { nodes: data.nodes.map(value => {
    if (!isRecord(value) || typeof value.use !== 'string' || typeof value.summary !== 'string') throw new Error('Node contracts could not be verified.')
    return { use: value.use, summary: value.summary, accepts: value.accepts, output: value.output, config: value.config, sideEffect: value.sideEffect, hosted: value.hosted }
  }) }
}
function NodeCatalog() {
  const [state, setState] = useState<{ loading?: boolean; error?: string; data?: { nodes: NodeContract[] } }>({ loading: true })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setState({ loading: true })
    manageRequest('/v1/platform/nodes', {}, decodeNodes).then(data => { if (active) setState({ data }) }).catch(error => { if (active) setState({ error: errorMessage(error) }) })
    return () => { active = false }
  }, [retry])
  return <section className="mt-5 border-t border-white/10 pt-5" aria-label="Built-in node catalog">
    <h3 className="font-semibold text-white mb-3">Built-in nodes</h3>
    {state.loading && <p role="status" className="text-sm text-slate-400">Loading node contracts…</p>}
    {state.error && <div role="alert" className="text-sm text-amber-300">{state.error} <button className="underline min-h-11 px-2" onClick={() => setRetry(value => value + 1)}>Retry</button></div>}
    {state.data?.nodes?.length === 0 && <p className="text-sm text-slate-400">No nodes reported by this server.</p>}
    <div className="grid gap-3 sm:grid-cols-2">{state.data?.nodes?.map(node => <details key={node.use} className="rounded-lg border border-white/10 p-3 min-w-0"><summary className="cursor-pointer text-sm text-white break-words">{node.use}<span className="block mt-1 text-xs text-slate-400">{node.summary}</span></summary><pre className="mt-3 text-xs text-slate-300 whitespace-pre-wrap break-words max-h-64 overflow-auto">{JSON.stringify({ accepts: node.accepts, output: node.output, config: node.config, sideEffect: node.sideEffect, hosted: node.hosted }, null, 2)}</pre></details>)}</div>
  </section>
}

export default function DeveloperWorkspace({ onOpen, selectedCapability, onSelectCapability, user, apps = [] }: {
  onOpen: (target: DeveloperAction) => void
  selectedCapability?: CapabilityId | null
  onSelectCapability?: (id: CapabilityId | null) => void
  user?: User
  apps?: ProjectSummary[]
}) {
  const [localSelected, setLocalSelected] = useState<CapabilityId | null>(null)
  const selected = selectedCapability === undefined ? localSelected : selectedCapability
  const setSelected = onSelectCapability || setLocalSelected
  const pageRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const scroller = pageRef.current?.closest<HTMLElement>('[data-developer-scroll]')
    if (scroller) scroller.scrollTop = 0
    pageRef.current?.querySelector<HTMLHeadingElement>('h1')?.focus({ preventScroll: true })
  }, [selected])
  const choice = capabilities.find(item => item.id === selected)
  return <div ref={pageRef} className="w-full max-w-6xl mx-auto self-start space-y-7 pb-6">
    <header className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-violet-300">Unified AI development infrastructure</p>
      <h1 tabIndex={-1} className="text-2xl sm:text-3xl font-semibold text-white outline-none">{choice ? choice.label : 'What do you want to build?'}</h1>
      <p className="text-sm sm:text-base text-slate-400 max-w-2xl leading-relaxed">{choice ? choice.description : 'Choose a capability to build, connect, test, or operate your AI solution.'}</p>
      <div className="flex flex-wrap gap-2 pt-1">{!choice && <button className={actionClass} onClick={() => setSelected('ai-apps')}>Open AI Apps <ArrowRight size={16} /></button>}<button className={actionClass} onClick={() => onOpen('resources')}>Browse resources <Database size={16} /></button></div>
    </header>
    <section hidden={!!choice} aria-label="AI development capabilities" className={`${choice ? 'hidden' : 'grid'} grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3`}>
      {capabilities.map(({ id, label, Icon, description, planned }) => <button key={id} aria-pressed={selected === id} aria-controls="capability-detail" onClick={() => setSelected(id)} className={`group rounded-xl border p-4 sm:p-5 text-left transition-colors min-w-0 ${selected === id ? 'border-violet-400/70 bg-violet-500/15' : 'border-white/10 bg-[#131929] hover:border-violet-400/50 hover:bg-[#1A2038]'}`}>
        <div className="flex items-center justify-between gap-2 mb-4"><Icon size={22} strokeWidth={1.5} className="text-violet-300" aria-hidden="true" />{planned && <span className="text-[10px] text-slate-400">Planned</span>}</div>
        <span className="block text-sm sm:text-base font-semibold text-white">{label}</span><span className="block mt-2 text-xs text-slate-400 leading-relaxed">{description}</span>
      </button>)}
    </section>
    {choice && <section id="capability-detail" tabIndex={-1} className="rounded-xl border border-white/10 bg-[#131929] p-5 sm:p-6 focus:outline-none focus:ring-2 focus:ring-violet-400/50">
      <p className="text-sm text-slate-400 leading-relaxed max-w-3xl">{choice.detail}</p>
      <div className="flex flex-wrap gap-3 mt-5">{choice.actions?.map(([label, target]) => <button key={label} className={actionClass} onClick={() => onOpen(target)}>{label}<ArrowRight size={16} /></button>)}{choice.links?.map(([label, to]) => <Link key={to} to={to} className={actionClass}>{label}<ArrowRight size={16} /></Link>)}</div>
      {choice.id === 'ai-apps' && <div className="mt-6 space-y-5">
        <section aria-label="App creation methods"><h2 className="text-base font-semibold text-white">Start with help</h2><div className="mt-3 grid gap-3 sm:grid-cols-2">{creationMethods.map(method => <button key={method.id} className={`${actionClass} text-left`} onClick={() => onOpen(`create:${method.id}`)}><span><span className="block font-semibold">{method.label}</span><span className="block mt-2 text-xs text-slate-400">{method.description}</span></span></button>)}</div></section>
        <section role="region" aria-label="AI app types"><h2 className="text-base font-semibold text-white">Application types</h2><p className="mt-2 text-sm text-slate-400">Choose a format to configure directly. Agents have their own workspace; Python jobs live in Code & Tools.</p><div className="mt-3 grid gap-3 sm:grid-cols-2">{appFormats.map(type => <button key={type.id} onClick={() => onOpen(`create:${type.id}`)} className="rounded-xl border border-white/10 bg-white/5 p-4 text-left hover:border-violet-400/50"><span className="block text-sm font-semibold text-white">{type.label}</span><span className="block mt-2 text-xs text-slate-400 leading-relaxed">{type.desc}</span>{type.status === 'preview' && <span className="block mt-2 text-xs text-amber-200">Prompt-based template</span>}</button>)}</div></section>
      </div>}
      {choice.id === 'models' && <ModelsPanel user={user} />}
      {choice.id === 'nodes' && <NodeCatalog />}
      {['agents', 'nodes'].includes(choice.id) && <section className="mt-6 space-y-3" aria-label="Existing capability projects"><h2 className="text-base font-semibold text-white">{choice.id === 'agents' ? 'Your agents' : 'Your Python jobs'}</h2>{apps.filter(app => app.app_type === (choice.id === 'agents' ? 'agent' : 'code_job')).map(app => <button key={app.id} className={`${actionClass} w-full text-left`} onClick={() => onOpen(`app:${app.id}`)}>{app.name}<ArrowRight size={16} /></button>)}{!apps.some(app => app.app_type === (choice.id === 'agents' ? 'agent' : 'code_job')) && <p className="text-sm text-slate-400">No saved projects of this type yet.</p>}</section>}
    </section>}
    {!choice && <section className="rounded-xl border border-white/10 p-5 space-y-3" aria-label="Planned platform capabilities"><h2 className="text-base font-semibold text-white">Planned platform capabilities</h2><p className="text-sm text-slate-400">These architecture capabilities do not have independent authoring or hosting yet.</p><div className="grid gap-4 md:grid-cols-3">{planned.map(([label, detail]) => <div key={label}><h3 className="text-sm text-slate-200">{label}</h3><p className="mt-2 text-xs text-slate-400 leading-relaxed">{detail}</p></div>)}</div></section>}
  </div>
}

function ModelsPanel({ user }: { user?: User }) {
  const providers = useProviders()
  const [state, setState] = useState<{ loading?: boolean; loaded?: boolean; error?: string }>({ loading: true })
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let active = true
    setState({ loading: true })
    loadProviders({ refresh: true }).then(() => { if (active) setState({ loaded: true }) }).catch(error => { if (active) setState({ error: errorMessage(error) }) })
    return () => { active = false }
  }, [refresh])
  return <div className="mt-6 space-y-6">
    <section aria-label="Available models"><h2 className="text-base font-semibold text-white">Available models</h2>
      {state.loading && <p role="status" className="mt-3 text-sm text-slate-400">Loading provider models…</p>}
      {state.error && <p role="alert" className="mt-3 text-sm text-amber-200">{state.error} <button onClick={() => setRefresh(value => value + 1)} className="underline min-h-11">Retry model catalog</button></p>}
      {state.loaded && <><div className="mt-3 grid gap-3 sm:grid-cols-2">{providers.map(provider => <div key={provider.id} className="rounded-xl border border-white/10 p-4"><h3 className="text-sm font-semibold text-white">{provider.label || provider.id}</h3><p className="mt-1 text-xs text-slate-400">{provider.connected ? 'Connected' : 'Connection required'}</p><ul className="mt-3 space-y-2 text-xs text-slate-300">{provider.models?.map(model => <li key={model.id} className="break-words">{model.label || model.id}<span className="block text-slate-500">{model.id}</span></li>)}</ul>{!provider.models?.length && <p className="mt-3 text-xs text-slate-400">No models reported for this provider.</p>}</div>)}</div>{providers.length === 0 && <p className="mt-3 text-sm text-slate-400">No providers are configured by this server.</p>}</>}
    </section>
    {state.loaded && <section><h2 className="text-base font-semibold text-white mb-3">Provider connections</h2><ProviderConnections user={user} /></section>}
  </div>
}
