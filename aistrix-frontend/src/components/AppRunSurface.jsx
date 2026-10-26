import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '../supabase'
import { isFileApp } from '../lib/fileApps'
import { useToast } from '../hooks/useToast'

const AppRunner = lazy(() => import('./AppRunner'))
const DataAppRunner = lazy(() => import('./DataAppRunner'))
const ApiAppRunner = lazy(() => import('./ApiAppRunner'))
const ConversationThread = lazy(() => import('./ConversationThread'))

// Where someone runs a published app: the runner, how to use it, and their
// own recent results. Shared by the Marketplace app page and /app/{id}.

function runnerKind(app) {
  if (isFileApp(app)) return 'file'
  if (app.app_type === 'api') return 'api'
  if (app.has_memory || app.app_type === 'chatbot') return 'chat'
  return app.app_type === 'native' && (app.form_schema || []).length ? 'form' : 'text'
}

function howToUse(app, kind) {
  const fields = (app.form_schema || []).filter(f => f?.label)
  const required = fields.filter(f => f.required).map(f => f.label)
  return {
    file: ['Add the file you want to work on.', 'Run the app and wait for it to read the file.', 'Copy or download the result.'],
    api: ['Fill in what the app asks for.', 'Run it to call the connected service.', 'Check the response before using it.'],
    chat: ['Type a message to start.', 'Keep the conversation going; the app remembers what you said here.', 'Start over any time for a fresh conversation.'],
    form: [required.length ? `Fill in ${required.join(', ')}${fields.length > required.length ? ' (other fields are optional)' : ''}.` : 'Fill in the fields you need.',
      'Run the app.', 'Copy, download or rate the result; it is saved in your run history.'],
    text: [app.sample_input ? 'Describe what you need, or start from the example.' : 'Describe what you need in your own words.',
      'Run the app. Bulk mode runs many inputs at once.', 'Copy, download or rate the result; it is saved in your run history.'],
  }[kind]
}

function RecentRuns({ app, user, refreshKey }) {
  const [runs, setRuns] = useState(null)
  const [open, setOpen] = useState(null)
  const toast = useToast()
  useEffect(() => {
    let live = true
    supabase.from('run_history').select('id, input, output, created_at')
      .eq('app_id', app.id).eq('user_id', user.id).order('created_at', { ascending: false }).limit(5)
      .then(({ data, error }) => { if (live) setRuns(error ? [] : data || []) })
    return () => { live = false }
  }, [app.id, user.id, refreshKey])
  if (runs === null) return <p className="text-xs text-slate-500">Loading your runs…</p>
  if (!runs.length) return <p className="text-xs text-slate-500 leading-relaxed">Your results from this app will appear here.</p>
  return <ul className="space-y-2">
    {runs.map(run => <li key={run.id} className="rounded-xl border border-white/10 bg-[#0E1424]">
      <button onClick={() => setOpen(open === run.id ? null : run.id)} aria-expanded={open === run.id}
        className="w-full text-left px-3 py-2">
        <span className="block text-[11px] text-slate-500">{new Date(run.created_at).toLocaleString()}</span>
        <span className="block text-xs text-slate-300 truncate">{run.input || '(no input)'}</span>
      </button>
      {open === run.id && <div className="border-t border-white/10 px-3 py-2 space-y-2">
        <div className="max-h-64 overflow-y-auto text-xs text-slate-200 prose-result">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.output || ''}</ReactMarkdown>
        </div>
        <button onClick={() => navigator.clipboard.writeText(run.output || '').then(() => toast('Result copied', 'success'))}
          className="text-[11px] text-[#A29BFE] hover:underline">Copy result</button>
      </div>}
    </li>)}
  </ul>
}

export default function AppRunSurface({ app, user, onRun }) {
  const [refreshKey, setRefreshKey] = useState(0)
  const toast = useToast()
  const kind = runnerKind(app)
  const ran = useCallback(() => { setRefreshKey(k => k + 1); onRun?.() }, [onRun])
  const runnerProps = { app, user, inline: true, onRun: ran }
  function share() {
    const url = `${window.location.origin}/marketplace/${app.id}`
    navigator.clipboard.writeText(url).then(() => toast('Link copied', 'success'), () => toast(url, 'info'))
  }
  return <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] items-start">
    <section aria-label={`Run ${app.name}`} className="min-w-0 bg-[#171B33] border border-white/10 rounded-2xl p-5 sm:p-6">
      <Suspense fallback={<p className="text-sm text-slate-500">Loading the app…</p>}>
        {kind === 'file' ? <DataAppRunner {...runnerProps} />
          : kind === 'api' ? <ApiAppRunner {...runnerProps} />
          : kind === 'chat' ? <ConversationThread {...runnerProps} />
          : <AppRunner {...runnerProps} />}
      </Suspense>
    </section>
    <aside className="space-y-4 min-w-0">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white mb-3">How to use</h2>
        <ol className="space-y-2 text-xs text-slate-400 leading-relaxed list-decimal pl-4">
          {howToUse(app, kind).map(step => <li key={step}>{step}</li>)}
        </ol>
        {app.sample_input && kind === 'text' && <div className="mt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500 mb-1">Example input</p>
          <p className="text-xs text-slate-300 whitespace-pre-line line-clamp-6">{app.sample_input}</p>
        </div>}
      </div>
      <div className="bg-[#171B33] border border-white/10 rounded-2xl p-5">
        <h2 className="text-sm font-semibold text-white mb-3">Your recent runs</h2>
        <RecentRuns app={app} user={user} refreshKey={refreshKey} />
      </div>
      <div className="flex items-center justify-between text-xs text-slate-500 px-1">
        <span>{(app.total_runs || 0).toLocaleString()} runs by everyone</span>
        <button onClick={share} className="text-[#A29BFE] hover:underline">Copy share link</button>
      </div>
    </aside>
  </div>
}
