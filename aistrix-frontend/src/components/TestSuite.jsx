/**
 * TestSuite — in-app prompt regression testing for Dev Studio.
 *
 * Storage: `app_test_cases` table in Supabase (auto-detected; shows setup
 * SQL if the table does not yet exist).
 *
 * Schema (run once in Supabase SQL editor):
 *
 *   create table app_test_cases (
 *     id          uuid primary key default gen_random_uuid(),
 *     app_id      uuid references apps(id) on delete cascade,
 *     user_id     uuid references auth.users(id) on delete cascade,
 *     name        text not null default 'Untitled test',
 *     input       text not null default '',
 *     rules       jsonb not null default '[]',
 *     context     jsonb not null default '[]',
 *     created_at  timestamptz default now()
 *   );
 *   alter table app_test_cases enable row level security;
 *   create policy "owner" on app_test_cases
 *     using (auth.uid() = user_id) with check (auth.uid() = user_id);
 */

import { useState, useEffect, useRef, useCallback } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { track, EVENTS } from '../lib/analytics'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ─── Rule types ───────────────────────────────────────────────────────────────
const RULE_TYPES = [
  { id: 'must-contain',     label: 'Must contain',      placeholder: 'expected phrase' },
  { id: 'must-not-contain', label: 'Must NOT contain',  placeholder: 'forbidden phrase' },
  { id: 'starts-with',      label: 'Starts with',       placeholder: 'opening text' },
  { id: 'ends-with',        label: 'Ends with',         placeholder: 'closing text' },
  { id: 'regex',            label: 'Matches regex',     placeholder: '^[A-Z].*\\.$' },
  { id: 'min-length',       label: 'Min length (chars)', placeholder: '200' },
  { id: 'max-length',       label: 'Max length (chars)', placeholder: '1000' },
]

const CONTEXT_OPTIONS = [
  { id: 'career_profile',   label: '💼 Career Profile' },
  { id: 'business_profile', label: '🏢 Business Profile' },
  { id: 'memory',           label: '🧠 Memory' },
]

// ─── Rule evaluation (pure) ──────────────────────────────────────────────────
function evaluateRule(output, rule) {
  const out = output ?? ''
  const val = rule.value ?? ''
  try {
    switch (rule.type) {
      case 'must-contain':     return out.toLowerCase().includes(val.toLowerCase())
      case 'must-not-contain': return !out.toLowerCase().includes(val.toLowerCase())
      case 'starts-with':      return out.trimStart().toLowerCase().startsWith(val.toLowerCase())
      case 'ends-with':        return out.trimEnd().toLowerCase().endsWith(val.toLowerCase())
      case 'regex':            return new RegExp(val, 'i').test(out)
      case 'min-length':       return out.length >= parseInt(val, 10)
      case 'max-length':       return out.length <= parseInt(val, 10)
      default:                 return true
    }
  } catch { return false }
}

function evaluateCase(output, rules) {
  const results = (rules || []).map(r => ({ ...r, passed: evaluateRule(output, r) }))
  const passed = results.every(r => r.passed)
  return { passed, results }
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────
function parseSSELine(line) {
  if (!line.startsWith('data: ')) return null
  try { return JSON.parse(line.slice(6)) } catch { return null }
}

export { evaluateRule, evaluateCase }

const MODEL_COSTS_TS = {
  'gpt-4o': { input: 2.50, output: 10.00 }, 'gpt-4o-mini': { input: 0.15, output: 0.60 },
  'claude-haiku-4-5': { input: 0.80, output: 4.00 }, 'claude-sonnet-4-5': { input: 3.00, output: 15.00 },
  'claude-sonnet-5': { input: 3.00, output: 15.00 }, 'claude-opus-4-5': { input: 15.00, output: 75.00 },
  'claude-opus-5': { input: 15.00, output: 75.00 },
}
function getModelRates(model) {
  if (!model) return MODEL_COSTS_TS['claude-sonnet-4-5']
  return MODEL_COSTS_TS[model] || Object.entries(MODEL_COSTS_TS).find(([k]) => model.includes(k) || k.includes(model))?.[1] || null
}

export async function runPrompt(app, input, signal) {
  const { data: { session } } = await supabase.auth.getSession()
  const res = await fetch(`${API_URL}/run`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session?.access_token}` },
    body: JSON.stringify({
      input: input || '(no input)',
      system_prompt: app.system_prompt,
      ai_provider: app.ai_provider || 'claude',
      ai_model: app.ai_model || null,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: 'Backend error' }))
    throw new Error(err.error || (typeof err.detail === 'string' ? err.detail : err.detail?.message) || 'Backend error')
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = '', out = '', inputTokens = 0, outputTokens = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const line of lines) {
      const d = parseSSELine(line)
      if (!d) continue
      if (d.token) out += d.token
      if (d.error) throw new Error(d.error)
      if (d.input_tokens)  inputTokens  = d.input_tokens
      if (d.output_tokens) outputTokens = d.output_tokens
    }
  }
  // Estimate tokens from character count if backend didn't return them
  if (!inputTokens)  inputTokens  = Math.round(((app.system_prompt || '').length + (input || '').length) / 4)
  if (!outputTokens) outputTokens = Math.round(out.length / 4)
  const rates = getModelRates(app.ai_model)
  const cost = rates ? ((inputTokens / 1e6) * rates.input) + ((outputTokens / 1e6) * rates.output) : null
  return { output: out, inputTokens, outputTokens, cost }
}

// ─── Setup SQL card ───────────────────────────────────────────────────────────
const SETUP_SQL = `create table app_test_cases (
  id         uuid primary key default gen_random_uuid(),
  app_id     uuid references apps(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete cascade,
  name       text not null default 'Untitled test',
  input      text not null default '',
  rules      jsonb not null default '[]',
  context    jsonb not null default '[]',
  created_at timestamptz default now()
);
alter table app_test_cases enable row level security;
create policy "owner" on app_test_cases
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);`

function SetupCard({ onRetry }) {
  return (
    <div className="bg-[#171B33] border border-[#6C5CE7]/20 rounded-2xl p-6 space-y-3 text-center">
      <div className="text-3xl">🧪</div>
      <div>
        <p className="text-white font-semibold text-sm">Test suites managed automatically</p>
        <p className="text-slate-400 text-sm mt-1">
          Test case storage is handled by Aistrix during deployment.<br />
          No manual setup required.
        </p>
      </div>
      <button onClick={onRetry}
        className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
        ↺ Check again
      </button>
    </div>
  )
}

// ─── Test case editor ─────────────────────────────────────────────────────────
function TestCaseEditor({ tc, onChange, onDelete, onClose }) {
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify(tc)))

  function updateField(key, val) {
    setDraft(d => { const next = { ...d, [key]: val }; onChange(next); return next })
  }

  function addRule() {
    const rules = [...(draft.rules || []), { type: 'must-contain', value: '' }]
    updateField('rules', rules)
  }

  function updateRule(i, patch) {
    const rules = draft.rules.map((r, idx) => idx === i ? { ...r, ...patch } : r)
    updateField('rules', rules)
  }

  function removeRule(i) {
    updateField('rules', draft.rules.filter((_, idx) => idx !== i))
  }

  function toggleContext(id) {
    const ctx = draft.context || []
    updateField('context', ctx.includes(id) ? ctx.filter(c => c !== id) : [...ctx, id])
  }

  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <input
          value={draft.name}
          onChange={e => updateField('name', e.target.value)}
          placeholder="Test case name"
          className="flex-1 bg-transparent text-white font-medium text-sm focus:outline-none border-b border-transparent focus:border-[#6C5CE7] pb-0.5 transition-colors"
        />
        <div className="flex gap-2 ml-3">
          <button onClick={onClose} className="text-[10px] text-slate-500 hover:text-white transition-colors">✕ Close</button>
          <button onClick={onDelete} className="text-[10px] text-slate-500 hover:text-red-400 transition-colors">🗑 Delete</button>
        </div>
      </div>

      {/* Input */}
      <div>
        <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1.5">Sample Input</label>
        <textarea
          value={draft.input}
          onChange={e => updateField('input', e.target.value)}
          placeholder="The input a user would type…"
          rows={3}
          className="w-full bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors"
        />
      </div>

      {/* Context injection */}
      <div>
        <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide block mb-1.5">
          Inject Context <span className="normal-case font-normal text-slate-600">(test with user profile data)</span>
        </label>
        <div className="flex gap-2 flex-wrap">
          {CONTEXT_OPTIONS.map(opt => {
            const active = (draft.context || []).includes(opt.id)
            return (
              <button key={opt.id} onClick={() => toggleContext(opt.id)}
                className={`text-[11px] px-2.5 py-1 rounded-lg border transition-colors ${active ? 'bg-[#6C5CE7]/20 border-[#6C5CE7]/40 text-[#A29BFE]' : 'bg-white/5 border-white/10 text-slate-400 hover:text-white'}`}>
                {opt.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Rules */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">
            Output Rules <span className="normal-case font-normal text-slate-600">({draft.rules?.length || 0})</span>
          </label>
          <button onClick={addRule}
            className="text-[10px] text-[#A29BFE] hover:text-white transition-colors">+ Add rule</button>
        </div>
        {(!draft.rules || draft.rules.length === 0) && (
          <p className="text-[11px] text-slate-600 italic">No rules yet — any output will pass. Add a rule to validate output quality.</p>
        )}
        <div className="space-y-2">
          {(draft.rules || []).map((rule, i) => (
            <div key={i} className="flex gap-2 items-start">
              <select
                value={rule.type}
                onChange={e => updateRule(i, { type: e.target.value })}
                className="bg-[#0E1424] border border-white/8 rounded-lg px-2 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-[#6C5CE7] shrink-0"
              >
                {RULE_TYPES.map(rt => (
                  <option key={rt.id} value={rt.id}>{rt.label}</option>
                ))}
              </select>
              <input
                value={rule.value}
                onChange={e => updateRule(i, { value: e.target.value })}
                placeholder={RULE_TYPES.find(rt => rt.id === rule.type)?.placeholder || ''}
                className="flex-1 bg-[#0E1424] border border-white/8 rounded-lg px-2 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7] transition-colors min-w-0"
              />
              <button onClick={() => removeRule(i)}
                className="text-slate-600 hover:text-red-400 transition-colors text-sm shrink-0 pt-1">×</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ─── Result row ───────────────────────────────────────────────────────────────
function ResultRow({ tc, result, onExpand, expanded }) {
  if (!result) return null
  const { passed, output, results: ruleResults, error, running, inputTokens, outputTokens, cost } = result
  const fmtCost = c => c < 0.001 ? `$${(c * 1000).toFixed(3)}m` : `$${c.toFixed(4)}`

  return (
    <div className={`rounded-xl border transition-colors ${passed ? 'border-green-500/20 bg-green-500/5' : error ? 'border-red-500/20 bg-red-500/5' : running ? 'border-[#6C5CE7]/20 bg-[#6C5CE7]/5' : 'border-red-500/20 bg-red-500/5'}`}>
      <button onClick={onExpand} className="w-full flex items-center gap-3 px-4 py-3 text-left">
        <span className="text-base shrink-0">{running ? '⏳' : passed ? '✅' : error ? '⚠️' : '❌'}</span>
        <span className="text-sm font-medium text-white flex-1 truncate">{tc.name}</span>
        {!running && !error && cost != null && (
          <span className="text-[10px] text-green-400/80 font-mono">{fmtCost(cost)}</span>
        )}
        {!running && !error && (
          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${passed ? 'text-green-400 bg-green-500/10' : 'text-red-400 bg-red-500/10'}`}>
            {ruleResults?.filter(r => r.passed).length}/{ruleResults?.length} rules
          </span>
        )}
        {running && <span className="text-[10px] text-[#A29BFE]">Running…</span>}
        {error && <span className="text-[10px] text-red-400 truncate max-w-[120px]">{error}</span>}
        <span className="text-slate-600 text-xs">{expanded ? '▲' : '▼'}</span>
      </button>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-white/5 pt-3">
          {/* Token + cost breakdown */}
          {(inputTokens || outputTokens) && (
            <div className="flex gap-4 text-[10px] bg-[#0A0F1E] rounded-lg px-3 py-2">
              <span className="text-slate-500">In: <span className="text-slate-300">{inputTokens?.toLocaleString()} tok</span></span>
              <span className="text-slate-500">Out: <span className="text-slate-300">{outputTokens?.toLocaleString()} tok</span></span>
              {cost != null && <span className="text-slate-500">Cost: <span className="text-green-400 font-semibold">{fmtCost(cost)}</span></span>}
            </div>
          )}
          {/* Rule breakdown */}
          {ruleResults?.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] text-slate-500 uppercase font-semibold">Rules</p>
              {ruleResults.map((r, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span>{r.passed ? '✓' : '✗'}</span>
                  <span className={r.passed ? 'text-green-400' : 'text-red-400'}>
                    {RULE_TYPES.find(rt => rt.id === r.type)?.label}:
                  </span>
                  <code className="text-slate-400 text-[10px] font-mono truncate">{r.value}</code>
                </div>
              ))}
            </div>
          )}
          {/* Output + diff against failed rules */}
          {output && (
            <div>
              <p className="text-[10px] text-slate-500 uppercase font-semibold mb-1">Output</p>
              <pre className="text-[11px] text-slate-400 bg-[#0E1424] rounded-lg p-3 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto">{output}</pre>
              {!passed && ruleResults?.some(r => !r.passed) && (
                <div className="mt-2 space-y-1">
                  <p className="text-[10px] text-slate-500 uppercase font-semibold">Expected vs. actual</p>
                  {ruleResults.filter(r => !r.passed).map((r, i) => (
                    <div key={i} className="bg-[#1A0A0A] border border-red-500/15 rounded-lg px-3 py-2 space-y-1">
                      <p className="text-[10px] text-red-400 font-semibold">{RULE_TYPES.find(rt => rt.id === r.type)?.label}</p>
                      <div className="flex gap-2 text-[10px]">
                        <span className="text-slate-500 shrink-0">Expected:</span>
                        <code className="text-amber-300 font-mono break-all">{r.value}</code>
                      </div>
                      {(r.type === 'must-contain' || r.type === 'starts-with' || r.type === 'ends-with') && (
                        <div className="flex gap-2 text-[10px]">
                          <span className="text-slate-500 shrink-0">Got:</span>
                          <code className="text-red-300 font-mono break-all line-clamp-2">{
                            r.type === 'starts-with' ? output.slice(0, 80) :
                            r.type === 'ends-with'   ? output.slice(-80) :
                            output.slice(0, 120)
                          }…</code>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function TestSuite({ apps, user, selectedAppId: controlledAppId, onSelectApp }) {
  const [internalAppId, setInternalAppId] = useState(() => apps[0]?.id || null)
  const selectedAppId = controlledAppId !== undefined ? controlledAppId : internalAppId
  const setSelectedAppId = onSelectApp ?? setInternalAppId
  const [testCases, setTestCases]   = useState([])
  const [loadingTc, setLoadingTc]   = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)
  const [editingId, setEditingId]   = useState(null)
  const [results, setResults]       = useState({}) // { [tcId]: { passed, output, results, error, running } }
  const [running, setRunning]       = useState(false)
  const [expandedResult, setExpandedResult] = useState(null)
  const abortRef = useRef(null)
  const toast = useToast()

  const selectedApp = apps.find(a => a.id === selectedAppId)

  // ── Load test cases ─────────────────────────────────────────────────────────
  const loadTestCases = useCallback(async () => {
    if (!selectedAppId) return
    setLoadingTc(true)
    const { data, error } = await supabase.from('app_test_cases')
      .select('*').eq('app_id', selectedAppId).eq('user_id', user.id)
      .order('created_at')
    setLoadingTc(false)
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) {
        setNeedsSetup(true)
      } else {
        toast(error.message, 'error')
      }
      return
    }
    setNeedsSetup(false)
    setTestCases(data || [])
    setResults({})
  }, [selectedAppId, user.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadTestCases() }, [loadTestCases])

  // ── CRUD ────────────────────────────────────────────────────────────────────
  async function addTestCase() {
    const { data, error } = await supabase.from('app_test_cases').insert({
      app_id: selectedAppId, user_id: user.id,
      name: `Test ${testCases.length + 1}`,
      input: '', rules: [], context: [],
    }).select().single()
    if (error) { toast(error.message, 'error'); return }
    setTestCases(prev => [...prev, data])
    setEditingId(data.id)
  }

  async function updateTestCase(updated) {
    setTestCases(prev => prev.map(tc => tc.id === updated.id ? updated : tc))
    const { error } = await supabase.from('app_test_cases')
      .update({ name: updated.name, input: updated.input, rules: updated.rules, context: updated.context })
      .eq('id', updated.id)
    if (error) toast(error.message, 'error')
  }

  async function deleteTestCase(id) {
    const { error } = await supabase.from('app_test_cases').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setTestCases(prev => prev.filter(tc => tc.id !== id))
    if (editingId === id) setEditingId(null)
    setResults(prev => { const next = { ...prev }; delete next[id]; return next })
  }

  // ── Run all ─────────────────────────────────────────────────────────────────
  async function runAll() {
    if (!selectedApp?.system_prompt) {
      toast('This app has no system prompt — open Prompt Studio in the Design tab first', 'error', 4000)
      return
    }
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)
    setExpandedResult(null)

    const toRun = testCases
    setResults(Object.fromEntries(toRun.map(tc => [tc.id, { running: true }])))

    for (const tc of toRun) {
      if (ctrl.signal.aborted) break
      try {
        const run = await runPrompt(selectedApp, tc.input, ctrl.signal)
        const { passed, results: ruleResults } = evaluateCase(run.output, tc.rules)
        setResults(prev => ({ ...prev, [tc.id]: { passed, output: run.output, inputTokens: run.inputTokens, outputTokens: run.outputTokens, cost: run.cost, results: ruleResults, running: false } }))
      } catch (e) {
        if (e.name === 'AbortError') break
        setResults(prev => ({ ...prev, [tc.id]: { passed: false, error: e.message, running: false } }))
      }
    }
    setRunning(false)
    const passed = Object.values(results).filter(r => r.passed).length
    track(EVENTS.TEST_SUITE_RUN, { app_id: selectedApp?.id, app_name: selectedApp?.name, total: toRun.length, passed })
  }

  function stopRun() { abortRef.current?.abort(); setRunning(false) }

  // ── Summary ─────────────────────────────────────────────────────────────────
  const completedResults = Object.values(results).filter(r => !r.running && !r.error)
  const passCount  = completedResults.filter(r => r.passed).length
  const totalRan   = Object.values(results).filter(r => !r.running).length
  const passRate   = totalRan > 0 ? Math.round((passCount / totalRan) * 100) : null
  const hasResults = totalRan > 0
  const publishReady = hasResults && passRate === 100

  // ─────────────────────────────────────────────────────────────────────────────
  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Create an app in the Design tab before writing tests.</p>
    </div>
  )

  if (needsSetup) return <SetupCard onRetry={loadTestCases} />

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-start gap-3 flex-wrap">
        <div className="space-y-0.5">
          <p className="text-xs font-semibold text-white uppercase tracking-wider">Manual regression tests</p>
          <p className="text-[10px] text-slate-500">Create custom cases for edge behavior, launch gates, and prompt regressions.</p>
        </div>

        {selectedApp && !selectedApp.system_prompt && (
          <span className="text-[11px] text-amber-400 bg-amber-400/10 px-2 py-1 rounded-lg border border-amber-400/20">
            ⚠️ No prompt — open Prompt Studio first
          </span>
        )}

        <div className="flex gap-2 ml-auto">
          <button onClick={addTestCase}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/8 text-slate-300 border border-white/10 transition-colors">
            + Add test
          </button>
          {testCases.length > 0 && (
            <button
              onClick={running ? stopRun : runAll}
              disabled={!selectedApp?.system_prompt && !running}
              className={`text-xs font-semibold px-4 py-1.5 rounded-lg border transition-colors disabled:opacity-40 ${
                running
                  ? 'bg-red-500/15 text-red-400 border-red-500/20 hover:bg-red-500/25'
                  : 'bg-[#6C5CE7] text-white border-transparent hover:bg-[#7C6CFF]'
              }`}
            >
              {running ? '⏹ Stop' : `▶ Run all (${testCases.length})`}
            </button>
          )}
        </div>
      </div>

      {/* Publish readiness gate */}
      {hasResults && (
        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm ${
          publishReady
            ? 'bg-green-500/8 border-green-500/20'
            : 'bg-red-500/8 border-red-500/20'
        }`}>
          <span className="text-xl">{publishReady ? '🟢' : '🔴'}</span>
          <div className="flex-1">
            <p className={`font-semibold ${publishReady ? 'text-green-400' : 'text-red-400'}`}>
              {publishReady ? 'Publish ready' : `Not ready to publish — ${totalRan - passCount} test${totalRan - passCount !== 1 ? 's' : ''} failing`}
            </p>
            <p className="text-[11px] text-slate-500 mt-0.5">
              {passCount}/{totalRan} passed · {passRate}% pass rate
            </p>
          </div>
          {/* Pass rate bar */}
          <div className="w-32 h-1.5 bg-white/5 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${publishReady ? 'bg-green-400' : passRate > 50 ? 'bg-amber-400' : 'bg-red-400'}`}
              style={{ width: `${passRate}%` }}
            />
          </div>
        </div>
      )}

      {/* Empty state */}
      {testCases.length === 0 && !loadingTc && (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center space-y-3">
          <div className="text-3xl">🧪</div>
          <p className="text-white font-medium">No test cases yet</p>
          <p className="text-slate-400 text-sm max-w-md mx-auto">
            Add test cases to validate your prompt before publishing.
            Each test runs your prompt against a sample input and checks the output against rules you define.
          </p>
          <button onClick={addTestCase}
            className="text-sm font-semibold px-5 py-2 rounded-xl bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
            + Add first test
          </button>
        </div>
      )}

      {loadingTc && <p className="text-slate-500 text-sm text-center py-6">Loading…</p>}

      {/* Test case list */}
      {testCases.length > 0 && (
        <div className="space-y-3">
          {testCases.map(tc => (
            <div key={tc.id} className="space-y-2">
              {/* Collapsed header */}
              {editingId !== tc.id && (
                <div className="bg-[#171B33] border border-white/5 rounded-xl px-4 py-3 flex items-center gap-3 hover:border-white/10 transition-colors">
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{tc.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {tc.input
                        ? <span className="text-[10px] text-slate-500 truncate max-w-[200px]">"{tc.input.slice(0, 60)}{tc.input.length > 60 ? '…' : ''}"</span>
                        : <span className="text-[10px] text-slate-600 italic">No input</span>}
                      {tc.rules?.length > 0 && (
                        <span className="text-[10px] text-slate-500">· {tc.rules.length} rule{tc.rules.length !== 1 ? 's' : ''}</span>
                      )}
                      {tc.context?.length > 0 && (
                        <span className="text-[10px] text-slate-500">· {tc.context.length} context</span>
                      )}
                    </div>
                  </div>

                  {/* Inline result badge */}
                  {results[tc.id] && !results[tc.id].running && (
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${results[tc.id].passed ? 'text-green-400 bg-green-500/10' : results[tc.id].error ? 'text-amber-400 bg-amber-400/10' : 'text-red-400 bg-red-500/10'}`}>
                      {results[tc.id].passed ? '✓ Pass' : results[tc.id].error ? '⚠ Error' : '✗ Fail'}
                    </span>
                  )}
                  {results[tc.id]?.running && (
                    <span className="text-[10px] text-[#A29BFE]">⏳</span>
                  )}

                  <button onClick={() => setEditingId(tc.id)}
                    className="text-[11px] text-slate-500 hover:text-white bg-white/5 hover:bg-white/8 px-2 py-1 rounded-md transition-colors shrink-0">
                    Edit
                  </button>
                </div>
              )}

              {/* Editor */}
              {editingId === tc.id && (
                <TestCaseEditor
                  tc={tc}
                  onChange={updateTestCase}
                  onDelete={() => deleteTestCase(tc.id)}
                  onClose={() => setEditingId(null)}
                />
              )}

              {/* Result detail */}
              {results[tc.id] && (
                <ResultRow
                  tc={tc}
                  result={results[tc.id]}
                  expanded={expandedResult === tc.id}
                  onExpand={() => setExpandedResult(p => p === tc.id ? null : tc.id)}
                />
              )}
            </div>
          ))}
        </div>
      )}

      {/* Context testing info banner */}
      {testCases.some(tc => tc.context?.length > 0) && (
        <div className="bg-[#6C5CE7]/8 border border-[#6C5CE7]/20 rounded-xl px-4 py-3">
          <p className="text-[11px] text-[#A29BFE]">
            💡 Some test cases have context injection enabled. During preview runs, context data is not fetched — context-aware tests are fully accurate only when run by an end user who has a saved profile.
          </p>
        </div>
      )}
    </div>
  )
}
