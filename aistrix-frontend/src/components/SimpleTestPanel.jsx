import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { runAppTest } from '../lib/appTests'
import { appTypeOf, buildTemplateCases, isRealCheck, judge, PERSONA_PACKS, PROFILE_INPUTS } from '../lib/testTemplates'
import { PROVIDER_STYLE, providerById, useProviders } from '../lib/providers'
import TestSuite from './TestSuite'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// Plain-language names for the publish requirements.
const LABELS = {
  functional: 'Works for normal requests',
  edge: 'Handles unclear or incomplete requests',
  safety: 'Keeps its instructions and keys private',
  contract: 'Returns the right output format',
  performance: 'Speed & cost checked',
  persona: 'Works for different kinds of users',
}
const APP_SPECIFIC = {
  chatbot: 'Remembers the conversation', native: 'Uses every form field', data: 'Reads the data correctly',
  batch: 'Reads the data correctly', website: 'Answers from the website', api: 'Returns the expected response',
  agent: 'Completes multi-step tasks', iframe: 'Works when embedded',
}
const PROFILE_RUNS = PROFILE_INPUTS.slice(0, 2)   // enough for a speed & cost reading, kept cheap

// Speed & cost is measured on the app's own normal test input (twice), so
// apps with a strict output format aren't timed on text they can't handle.
function profileRuns(cases) {
  const input = cases.find(tc => (tc.category || 'functional') === 'functional' && tc.input)?.input
  return input ? [{ label: 'Typical input', input }, { label: 'Typical input (again)', input }] : PROFILE_RUNS
}

function labelFor(req, app) {
  return req.id === 'app_specific' ? (APP_SPECIFIC[appTypeOf(app)] || 'Does what this app type should') : (LABELS[req.id] || req.label)
}

function isBlockingRunProblem(message = '') {
  return /rate limit|api key|provider|timed out|quota|allowance|could not reach|network/i.test(message)
}

// One-click testing: prepares the right tests for the app, runs them (plus a
// speed & cost check) on the server, and shows a plain checklist. The same
// server rules decide whether the app can be deployed.
export default function SimpleTestPanel({ app, user, onMovePhase, onOpenKeys }) {
  const toast = useToast()
  const providers = useProviders()
  const [status, setStatus] = useState(null)
  const [statusError, setStatusError] = useState('')
  const [cases, setCases] = useState([])
  const [blueprint, setBlueprint] = useState({})
  const [usage, setUsage] = useState(null)
  const [running, setRunning] = useState(null)        // 'tests' | 'personas' | null
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [showCustomize, setShowCustomize] = useState(false)
  const [lastProblem, setLastProblem] = useState('')
  const abortRef = useRef(null)

  const load = useCallback(async () => {
    if (!app?.id) return
    const { data: { session } } = await supabase.auth.getSession()
    const headers = session?.access_token ? { Authorization: `Bearer ${session.access_token}` } : {}
    const [statusRes, casesRes, bpRes] = await Promise.all([
      fetch(`${API_URL}/v1/apps/${app.id}/tests/status`, { headers }).catch(() => null),
      supabase.from('app_test_cases').select('*').eq('app_id', app.id).eq('user_id', user.id).order('created_at'),
      supabase.from('app_blueprints').select('blueprint').eq('app_id', app.id).maybeSingle(),
    ])
    if (headers.Authorization) {
      fetch(`${API_URL}/v1/usage`, { headers })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setUsage(data) })
        .catch(() => {})
    }
    if (statusRes?.ok) { setStatus(await statusRes.json()); setStatusError('') }
    else setStatusError(statusRes ? ((await statusRes.json().catch(() => ({}))).detail || 'Could not load test results') : 'Could not reach the server')
    setCases(casesRes.data || [])
    setBlueprint(bpRes.data?.blueprint || {})
  }, [app?.id, user.id])

  useEffect(() => { load() }, [load])

  // Add the recommended tests for any category the app has no real test for yet.
  async function ensureTests() {
    // Read the saved tests fresh: the list on screen may not have loaded yet
    // (Run clicked right away), which would add the same tests again.
    const { data: saved, error: readError } = await supabase.from('app_test_cases')
      .select('*').eq('app_id', app.id).eq('user_id', user.id).order('created_at')
    if (readError) throw new Error(`Couldn't load this app's tests: ${readError.message}`)
    const cases = saved || []
    const covered = new Set(cases.filter(tc => (tc.rules || []).some(isRealCheck)).map(tc => tc.category || 'functional'))
    const names = new Set(cases.map(tc => tc.name))
    const missing = buildTemplateCases(app, blueprint).filter(tc => !covered.has(tc.category) && !names.has(tc.name))
    if (!missing.length) { setCases(cases); return cases }
    const { data, error } = await supabase.from('app_test_cases')
      .insert(missing.map(tc => ({ app_id: app.id, user_id: user.id, history: [], ...tc }))).select()
    if (error) throw new Error(`Couldn't add the recommended tests: ${error.message}`)
    const next = [...cases, ...(data || [])]
    setCases(next)
    return next
  }

  function stopRun() {
    abortRef.current?.abort()
    setRunning(null)
    toast('Test run stopped', 'info', 2500)
  }

  function allowanceProblem() {
    if (!usage || usesOwnKey || platformRemaining !== 0) return ''
    return `Your free allowance is empty for ${providerName}. Add your own key to keep testing without platform limits.`
  }

  async function runTests() {
    const blocked = allowanceProblem()
    if (blocked) {
      setLastProblem(blocked)
      toast(blocked, 'error', 9000)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning('tests')
    setLastProblem('')
    const problems = []
    try {
      const list = await ensureTests()
      const total = list.length + PROFILE_RUNS.length
      let done = 0
      setProgress({ done, total })
      for (const tc of list) {
        if (ctrl.signal.aborted) break
        try {
          await runAppTest(app.id, { source: 'suite', case_ref: tc.id, label: tc.name, input: tc.input || '(no input)',
            checks: tc.rules || [], category: tc.category || 'functional', ...(tc.history?.length ? { history: tc.history } : {}) }, { signal: ctrl.signal })
        } catch (e) {
          if (e.name === 'AbortError') break
          problems.push(e.message)
          if (isBlockingRunProblem(e.message)) break
        }
        setProgress({ done: ++done, total })
      }
      for (const item of profileRuns(list)) {
        if (ctrl.signal.aborted) break
        try {
          await runAppTest(app.id, { source: 'profile', case_ref: `profile:${item.label}`, label: `Speed & cost: ${item.label}`, input: item.input, checks: [] }, { signal: ctrl.signal })
        } catch (e) {
          if (e.name === 'AbortError') break
          problems.push(e.message)
          if (isBlockingRunProblem(e.message)) break
        }
        setProgress({ done: ++done, total })
      }
    } catch (e) {
      problems.push(e.message)
    } finally {
      await load()
      setRunning(null)
      if (abortRef.current === ctrl) abortRef.current = null
    }
    // Same problem on every run (e.g. no AI key) → say it once.
    if (problems.length) {
      const msg = [...new Set(problems)].slice(0, 2).join(' · ')
      setLastProblem(msg)
      toast(msg, 'error', 9000)
    }
  }

  async function runPersonas() {
    const blocked = allowanceProblem()
    if (blocked) {
      setLastProblem(blocked)
      toast(blocked, 'error', 9000)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning('personas')
    setLastProblem('')
    const base = cases.find(tc => (tc.category || 'functional') === 'functional' && tc.input)?.input
      || buildTemplateCases(app, blueprint)[0]?.input
    let done = 0
    setProgress({ done, total: PERSONA_PACKS.length })
    try {
      for (const p of PERSONA_PACKS) {
        if (ctrl.signal.aborted) break
        try {
          await runAppTest(app.id, { source: 'persona', case_ref: `persona:${p.id}`, label: `Persona: ${p.label}`, persona: p.id,
            input: base, checks: [judge('Gives a useful, on-task answer that suits this kind of user')] }, { signal: ctrl.signal })
        } catch (e) {
          if (e.name !== 'AbortError') { setLastProblem(e.message); toast(e.message, 'error', 6000) }
          break
        }
        setProgress({ done: ++done, total: PERSONA_PACKS.length })
      }
    } finally {
      await load()
      setRunning(null)
      if (abortRef.current === ctrl) abortRef.current = null
    }
  }

  async function runProfileOnly() {
    const blocked = allowanceProblem()
    if (blocked) {
      setLastProblem(blocked)
      toast(blocked, 'error', 9000)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning('profile')
    setLastProblem('')
    const problems = []
    let done = 0
    const runs = profileRuns(cases)
    setProgress({ done, total: runs.length })
    try {
      for (const item of runs) {
        if (ctrl.signal.aborted) break
        try {
          await runAppTest(app.id, { source: 'profile', case_ref: `profile:${item.label}`, label: `Speed & cost: ${item.label}`, input: item.input, checks: [] }, { signal: ctrl.signal })
        } catch (e) {
          if (e.name === 'AbortError') break
          problems.push(e.message)
          if (isBlockingRunProblem(e.message)) break
        }
        setProgress({ done: ++done, total: runs.length })
      }
    } finally {
      await load()
      setRunning(null)
      if (abortRef.current === ctrl) abortRef.current = null
    }
    if (problems.length) {
      const msg = [...new Set(problems)].slice(0, 2).join(' · ')
      setLastProblem(msg)
      toast(msg, 'error', 9000)
    }
  }

  async function handleRequirementClick(req) {
    if (running) return
    if (req.id === 'performance') {
      await runProfileOnly()
      return
    }
    if (req.id === 'persona') {
      await runPersonas()
      return
    }
    if (req.status === 'missing' || req.status === 'weak') {
      try {
        await ensureTests()
        await load()
      } catch (e) {
        toast(e.message, 'error', 6000)
      }
    }
    setShowCustomize(true)
  }

  if (!app) return null
  const reqs = status?.requirements || []
  const required = reqs.filter(r => r.required)
  const optional = reqs.filter(r => !r.required)
  const anyRun = reqs.some(r => r.status !== 'missing')
  const toFix = required.filter(r => r.status !== 'passed')
  const ready = !!status?.all_passed && !status?.setup_required

  // "≈ cost" for one Run: measured average per run, else the model's price.
  const plannedCount = Math.max(cases.length, buildTemplateCases(app, blueprint).length) + PROFILE_RUNS.length
  const profile = status?.profile
  let perRun = profile?.avg_cost_usd
  if (perRun == null && profile?.price_per_million) {
    const inTok = Math.round(((app.system_prompt || '').length + 400) / 4)
    perRun = (inTok * profile.price_per_million[0] + 500 * profile.price_per_million[1]) / 1e6
  }
  const cost = perRun == null ? null : perRun * plannedCount
  const provider = providerById(providers, app.ai_provider || 'claude')
  const providerName = PROVIDER_STYLE[provider.id]?.name || provider.label
  const platformRemaining = usage ? Math.min(usage.hourly?.remaining ?? 0, usage.daily?.remaining ?? 0) : null
  const usesOwnKey = provider.connected || usage?.own_provider_keys?.includes?.(provider.id)
  const payer = usesOwnKey ? `your ${providerName} key` : platformRemaining == null ? 'your free allowance' : `${platformRemaining} free run${platformRemaining === 1 ? '' : 's'} left`
  const noPrompt = !app.system_prompt?.trim()
  const hasBlockingProblem = isBlockingRunProblem(lastProblem) || (!usesOwnKey && platformRemaining === 0)

  const reasonFor = req => {
    if (req.id === 'performance' && req.status === 'passed' && profile) {
      const secs = profile.latency_p50_ms != null ? `~${(profile.latency_p50_ms / 1000).toFixed(1)}s` : null
      const each = profile.avg_cost_usd != null ? `~$${Number(profile.avg_cost_usd).toFixed(4)} per run` : null
      return [secs, each].filter(Boolean).join(' · ')
    }
    if (req.status === 'failed') {
      const f = (status?.failed || []).find(x => x.category === req.id)
      return f?.errors?.[0] || (req.failures?.length ? `Failed: ${req.failures[0]}` : 'A test failed')
    }
    if (req.status === 'weak') return 'Needs a stronger check — open Customize tests'
    if (req.status === 'missing') return 'Not tested yet'
    return ''
  }

  const icon = s => s === 'passed' ? { t: '✓', c: 'text-emerald-400' } : s === 'failed' ? { t: '✗', c: 'text-red-400' } : s === 'weak' ? { t: '!', c: 'text-amber-400' } : { t: '○', c: 'text-slate-500' }

  return (
    <div className="space-y-4">
      <div className="bg-[#171B33] border border-white/8 rounded-2xl p-5 space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <span className="text-2xl">{app.emoji || '🧪'}</span>
            <div className="min-w-0">
              <p className="text-white font-semibold text-base truncate">Testing {app.name}</p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {noPrompt ? 'Add instructions in Design first.' : `${plannedCount} tests${cost != null ? ` · ≈ ${cost < 0.01 ? '<$0.01' : `$${cost.toFixed(2)}`}` : ''} on ${payer}`}
              </p>
            </div>
          </div>
          <button onClick={running ? stopRun : runTests} disabled={noPrompt}
            className={`text-sm font-semibold px-5 py-2.5 rounded-xl disabled:opacity-40 text-white transition-colors shrink-0 ${running ? 'bg-red-500/80 hover:bg-red-500' : 'bg-[#6C5CE7] hover:bg-[#7C6CFF]'}`}>
            {running === 'tests' ? `Stop ${progress.done} of ${progress.total}` : running === 'personas' ? `Stop personas ${progress.done}/${progress.total}` : running === 'profile' ? `Stop profile ${progress.done}/${progress.total}` : anyRun ? '↻ Run tests again' : '▶ Run tests'}
          </button>
        </div>

        {hasBlockingProblem && (
          <div className="rounded-xl border border-amber-500/25 bg-amber-500/8 px-3 py-3 flex items-start justify-between gap-3">
            <div>
              <p className="text-amber-200 text-xs font-semibold">Testing needs a provider key or more free allowance</p>
              <p className="text-amber-100/70 text-[11px] mt-1">
                {lastProblem || `Your free allowance is empty for ${providerName}. Add your own key to keep testing without platform limits.`}
              </p>
            </div>
            <button type="button" onClick={onOpenKeys}
              className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-400 text-[#171B33] hover:bg-amber-300 transition-colors">
              Add {providerName} key
            </button>
          </div>
        )}

        {status?.setup_required && (
          <p className="text-xs text-amber-300 bg-amber-500/8 border border-amber-500/20 rounded-xl px-3 py-2">
            Test results can't be saved on this server yet (database setup pending).
          </p>
        )}
        {statusError && !status && <p className="text-xs text-amber-300">{statusError}</p>}

        <div className="space-y-1.5">
          {required.map(req => {
            const i = icon(req.status)
            const reason = reasonFor(req)
            return (
              <button key={req.id} type="button" onClick={() => handleRequirementClick(req)}
                className="w-full text-left flex items-start gap-3 px-3 py-2 rounded-xl bg-white/[0.02] hover:bg-white/[0.05] transition-colors focus:outline-none focus:ring-2 focus:ring-[#6C5CE7]/40">
                <span className={`${i.c} font-bold text-sm w-4 text-center shrink-0`}>{i.t}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-200">{labelFor(req, app)}</p>
                  {reason && <p className={`text-[11px] mt-0.5 ${req.status === 'failed' ? 'text-red-300/80' : 'text-slate-500'}`}>{reason}</p>}
                  <p className="text-[10px] text-[#A29BFE]/75 mt-1">{req.status === 'passed' ? 'Open related tests' : req.id === 'performance' ? 'Run speed and cost check' : 'Add or customize tests'}</p>
                </div>
              </button>
            )
          })}
          {optional.map(req => {
            const i = icon(req.status)
            return (
              <div key={req.id} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02]">
                <span className={`${i.c} font-bold text-sm w-4 text-center shrink-0`}>{i.t}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-300">{labelFor(req, app)} <span className="text-[10px] text-slate-500">(optional)</span></p>
                  {req.status === 'failed' && <p className="text-[11px] mt-0.5 text-red-300/80">{reasonFor(req)}</p>}
                </div>
                <button onClick={runPersonas} disabled={!!running || noPrompt}
                  className="text-[11px] font-semibold px-3 py-1 rounded-lg bg-white/5 hover:bg-white/10 disabled:opacity-40 text-slate-300 border border-white/10 transition-colors shrink-0">
                  {running === 'personas' ? `${progress.done}/${progress.total}…` : 'Run'}
                </button>
              </div>
            )
          })}
        </div>

        <div className="flex items-center justify-between gap-3 flex-wrap pt-3 border-t border-white/5">
          <p className={`text-sm font-semibold ${ready ? 'text-emerald-400' : anyRun ? 'text-amber-300' : 'text-slate-400'}`}>
            {ready ? 'Ready to deploy' : anyRun ? `Not ready yet — ${toFix.length} item${toFix.length === 1 ? '' : 's'} to fix` : 'Run the tests to see if this app is ready.'}
          </p>
          {ready ? (
            <button onClick={() => onMovePhase?.(app.id, 'deploy')}
              className="text-sm font-semibold px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-white transition-colors">
              Continue to Deploy →
            </button>
          ) : anyRun ? (
            <button onClick={() => onMovePhase?.(app.id, 'design')}
              className="text-sm font-semibold px-4 py-2 rounded-xl bg-white/5 hover:bg-white/10 text-slate-200 border border-white/10 transition-colors">
              Fix in Design
            </button>
          ) : null}
        </div>
      </div>

      <div className="bg-[#171B33] border border-white/8 rounded-2xl">
        <button onClick={() => { if (showCustomize) load(); setShowCustomize(v => !v) }}
          className="w-full flex items-center justify-between px-5 py-3 text-left">
          <span className="text-sm text-slate-300 font-semibold">{showCustomize ? '▾' : '▸'} Customize tests ({cases.length})</span>
          <span className="text-[11px] text-slate-500">Edit tests, add your own checks</span>
        </button>
        {showCustomize && (
          <div className="px-4 pb-4">
            <TestSuite key={`${app.id}:${cases.length}:${status?.draft_hash || ''}`} apps={[app]} user={user} selectedAppId={app.id} compact />
          </div>
        )}
      </div>
    </div>
  )
}
