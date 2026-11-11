import { useEffect, useRef, useState } from 'react'
import { Activity, ArrowRight, Bot, Boxes, BrainCircuit, Braces, Database, FileText, FlaskConical, Layers, LayoutGrid, Network, Plug, ShieldCheck, Terminal, Waypoints } from 'lucide-react'
import { Link } from '../../navigation'
import { manageRequest } from '../../lib/manageApi'
import { APP_TYPES } from '../../lib/appTypes'

const capabilities = [
  { id: 'ai-apps', label: 'AI Apps', Icon: LayoutGrid, description: 'Create and manage applications using the existing app types.', detail: 'Choose from the existing application types, then design, test, and deploy in app Studio. Your current applications and their lifecycle remain here.', actions: [['Choose an app type', 'create'], ['Manage AI apps', 'design']] },
  { id: 'models', label: 'Models', Icon: BrainCircuit, description: 'Connect providers and choose models for your applications.', detail: 'Configure your provider keys, then choose a model in an application. Dedicated model serving and model resource authoring are planned.', actions: [['Configure providers', 'keys'], ['Build an application', 'design']] },
  { id: 'agents', label: 'Agents', Icon: Bot, description: 'Build AI assistants that use tools and follow instructions.', detail: 'Build and test existing agent applications in Studio. Standalone versioned Agent resources and persistent agent sessions are still being developed.', actions: [['Open app Studio', 'design'], ['Inspect resources', 'resources']] },
  { id: 'nodes', label: 'Nodes', Icon: Boxes, description: 'Explore typed building blocks for AI execution.', detail: 'Inspect the built-in node contracts available from your Platform API. Start prompt-to-code development in a private Python code app. Reusable Node resource registration is planned.', actions: [['Create Python resource with AI', 'create-code'], ['Inspect resources', 'resources']] },
  { id: 'tools', label: 'Tools', Icon: Braces, description: 'Connect services and actions to your AI applications.', detail: 'Manage existing integrations and configure application tools in Studio. A public reusable Tool SDK is planned.', actions: [['Configure application tools', 'design']], links: [['Open integrations', '/integrations']] },
  { id: 'mcp', label: 'MCP', Icon: Plug, description: 'Expose and connect capabilities through MCP.', detail: 'Managed MCP server authoring, hosting, and lifecycle controls are planned. Existing service integrations are available today.', links: [['Open integrations', '/integrations']], planned: true },
  { id: 'workflows', label: 'Workflows', Icon: Waypoints, description: 'Compose applications, actions, and approval steps.', detail: 'Use the existing workflow designer to connect applications and inspect their execution. Platform pipeline releases are available in Resources.', actions: [['Open workflow designer', 'workflows'], ['Inspect pipeline releases', 'resources']] },
  { id: 'knowledge', label: 'Knowledge', Icon: Layers, description: 'Manage reference material and context for AI.', detail: 'Use the existing knowledge vault for reference material. Versioned Knowledge Base resources with indexing and retrieval are planned.', links: [['Open knowledge vault', '/knowledge-vault']] },
  { id: 'data', label: 'Data', Icon: Database, description: 'Connect data sources and inspect released datasets.', detail: 'Manage existing data connections or inspect Dataset releases in the resource registry. Datasets are artifacts, not executable workloads.', actions: [['Inspect dataset releases', 'resources']], links: [['Open data sources', '/data-sources']] },
  { id: 'prompts', label: 'Prompts', Icon: FileText, description: 'Design instructions, schemas, and application context.', detail: 'Edit prompts and context in application Studio. Independent versioned prompt assets are planned.', actions: [['Open prompt design', 'design'], ['Test an application', 'test']] },
  { id: 'evaluations', label: 'Evaluations', Icon: FlaskConical, description: 'Test quality and inspect release evaluation results.', detail: 'Create versioned test suites, run checks against pinned pipeline releases, inspect failures, compare results, and review production evaluation requirements. Existing AI App quality tools are also available.', actions: [['Open Evaluations', 'evaluations'], ['Test applications', 'test'], ['Review application quality', 'evaluate']] },
  { id: 'interfaces', label: 'Interfaces', Icon: Network, description: 'Deploy applications and configure how they are invoked.', detail: 'Publish existing applications and configure their available API, embed, and sharing surfaces. General source application hosting is planned.', actions: [['Open application deployment', 'deploy'], ['Inspect release environments', 'resources']] },
  { id: 'operations', label: 'Operations', Icon: Activity, description: 'Inspect execution, costs, environments, and errors.', detail: 'Monitor existing applications or inspect Platform releases, environment pointers, run state, steps, budgets, and recorded events.', actions: [['Monitor applications', 'monitor'], ['Inspect platform runs', 'resources'], ['Manage secrets', 'secrets']] },
]
const actionClass = 'inline-flex items-center justify-between gap-3 rounded-lg border border-white/15 bg-white/5 px-4 py-3 text-sm text-white hover:bg-violet-500/15 hover:border-violet-400/50 min-h-11'

function NodeCatalog() {
  const [state, setState] = useState({ loading: true })
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let active = true
    setState({ loading: true })
    manageRequest('/v1/platform/nodes').then(data => { if (active) setState({ data }) }).catch(error => { if (active) setState({ error: error.message }) })
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

export default function DeveloperWorkspace({ onOpen }) {
  const [selected, setSelected] = useState(null)
  const detailRef = useRef(null)
  useEffect(() => {
    if (selected) {
      detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
      detailRef.current?.focus({ preventScroll: true })
    }
  }, [selected])
  const choice = capabilities.find(item => item.id === selected)
  return <div className="max-w-6xl mx-auto space-y-7 pb-6">
    <header className="space-y-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-violet-300">Unified AI development infrastructure</p>
      <h1 className="text-2xl sm:text-3xl font-semibold text-white">What do you want to build?</h1>
      <p className="text-sm sm:text-base text-slate-400 max-w-2xl leading-relaxed">Choose a capability to build, connect, test, or operate your AI solution.</p>
      <div className="flex flex-wrap gap-2 pt-1"><button className={actionClass} onClick={() => onOpen('design')}>Open application Studio <ArrowRight size={16} /></button><button className={actionClass} onClick={() => onOpen('resources')}>Browse resources <Boxes size={16} /></button></div>
    </header>
    <section aria-label="AI development capabilities" className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
      {capabilities.map(({ id, label, Icon, description, planned }) => <button key={id} aria-pressed={selected === id} aria-controls="capability-detail" onClick={() => setSelected(id)} className={`group rounded-xl border p-4 sm:p-5 text-left transition-colors min-w-0 ${selected === id ? 'border-violet-400/70 bg-violet-500/15' : 'border-white/10 bg-[#131929] hover:border-violet-400/50 hover:bg-[#1A2038]'}`}>
        <div className="flex items-center justify-between gap-2 mb-4"><Icon size={22} strokeWidth={1.5} className="text-violet-300" aria-hidden="true" />{planned && <span className="text-[10px] text-slate-400">Planned</span>}</div>
        <span className="block text-sm sm:text-base font-semibold text-white">{label}</span><span className="block mt-2 text-xs text-slate-400 leading-relaxed">{description}</span>
      </button>)}
    </section>
    <section id="capability-detail" ref={detailRef} tabIndex={-1} aria-live="polite" className="rounded-xl border border-white/10 bg-[#131929] p-5 sm:p-6 focus:outline-none focus:ring-2 focus:ring-violet-400/50">
      {choice ? <><div className="flex items-center gap-3"><choice.Icon size={22} className="text-violet-300" aria-hidden="true" /><h2 className="text-xl font-semibold text-white">{choice.label}</h2></div><p className="mt-3 text-sm text-slate-400 leading-relaxed max-w-3xl">{choice.detail}</p><div className="flex flex-wrap gap-3 mt-5">{choice.actions?.map(([label, target]) => <button key={label} className={actionClass} onClick={() => onOpen(target)}>{label}<ArrowRight size={16} /></button>)}{choice.links?.map(([label, to]) => <Link key={to} to={to} className={actionClass}>{label}<ArrowRight size={16} /></Link>)}</div>{choice.id === 'ai-apps' && <div className='mt-5 space-y-3'><h3 className='text-sm font-semibold text-white'>Application types</h3><ul className='flex flex-wrap gap-2'>{APP_TYPES.map(type => <li key={type.id} className='rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-300'>{type.label}</li>)}</ul></div>}{choice.id === 'nodes' && <NodeCatalog />}</> : <p className="text-sm text-slate-400">Select a capability above to see available tools and next steps.</p>}
    </section>
    <div className="grid gap-4 md:grid-cols-2">
      <button className={`${actionClass} text-left p-5`} onClick={() => onOpen('resources')}><div><span className="flex items-center gap-2 font-semibold"><ShieldCheck size={18} />Aistrix Resource Specification</span><span className="block mt-2 text-xs text-slate-400 leading-relaxed">Inspect versions, immutable releases, and environment assignments.</span></div><ArrowRight size={18} className="shrink-0" /></button>
      <button className={`${actionClass} text-left p-5`} onClick={() => onOpen('resources')}><div><span className="flex items-center gap-2 font-semibold"><Terminal size={18} />AEX execution</span><span className="block mt-2 text-xs text-slate-400 leading-relaxed">Inspect platform run state, steps, events, budgets, and errors.</span></div><ArrowRight size={18} className="shrink-0" /></button>
    </div>
  </div>
}
