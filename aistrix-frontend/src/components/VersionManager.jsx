import { useState, useEffect, useCallback, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { timeAgo } from '../utils'
import { runPrompt, evaluateCase } from './TestSuite'
import { track, EVENTS } from '../lib/analytics'

export const VERSION_SETUP_SQL = `create table app_versions (
  id            uuid primary key default gen_random_uuid(),
  app_id        uuid references apps(id) on delete cascade,
  user_id       uuid references auth.users(id) on delete cascade,
  version_num   int  not null default 1,
  system_prompt text,
  ai_model      text,
  ai_provider   text,
  label         text,
  semver        text,
  changelog     text,
  created_at    timestamptz default now()
);
alter table app_versions enable row level security;
create policy "owner" on app_versions
  using  (auth.uid() = user_id)
  with check (auth.uid() = user_id);`

export const VERSION_MIGRATE_SQL = `alter table app_versions add column if not exists semver text;
alter table app_versions add column if not exists changelog text;`

// ─── Semver helpers ───────────────────────────────────────────────────────────

function parseSemver(s) {
  if (!s) return null
  const m = s.match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  if (!m) return null
  return { major: +m[1], minor: +m[2], patch: +m[3] }
}

function bumpSemver(latest, type) {
  const v = parseSemver(latest) || { major: 1, minor: 0, patch: 0 }
  if (type === 'major') return `v${v.major + 1}.0.0`
  if (type === 'minor') return `v${v.major}.${v.minor + 1}.0`
  return `v${v.major}.${v.minor}.${v.patch + 1}`
}

function nextSemver(versions, type) {
  const latest = versions.find(v => v.semver)?.semver
  return bumpSemver(latest, type)
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useVersions(appId, userId) {
  const [versions, setVersions]     = useState([])
  const [loading, setLoading]       = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  const load = useCallback(async () => {
    if (!appId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .eq('app_id', appId)
      .eq('user_id', userId)
      .order('version_num', { ascending: false })
    setLoading(false)
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) setNeedsSetup(true)
      return
    }
    setNeedsSetup(false)
    setVersions(data || [])
  }, [appId, userId])

  useEffect(() => { load() }, [load])

  return { versions, loading, needsSetup, reload: load, setVersions }
}

// Called by PromptStudio on save (silent — no semver/changelog here)
export async function saveVersionSnapshot(app, userId, prompt) {
  try {
    const { count } = await supabase
      .from('app_versions')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', app.id)
      .eq('user_id', userId)
    await supabase.from('app_versions').insert({
      app_id: app.id,
      user_id: userId,
      version_num: (count ?? 0) + 1,
      system_prompt: prompt,
      ai_model: app.ai_model,
      ai_provider: app.ai_provider,
    })
  } catch { /* silently fail if table doesn't exist yet */ }
}

// ─── Setup card ───────────────────────────────────────────────────────────────

export function VersionSetupCard({ onRetry }) {
  return (
    <div className="bg-[#171B33] border border-[#6C5CE7]/20 rounded-2xl p-6 space-y-3 text-center">
      <div className="text-3xl">📦</div>
      <div>
        <p className="text-white font-semibold text-sm">Versioning managed automatically</p>
        <p className="text-slate-400 text-sm mt-1">
          Version history is handled by Aistrix during deployment.<br />
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

// ─── Version list ─────────────────────────────────────────────────────────────

export default function VersionManager({ app, user, onRollback, selectedId, onSelect }) {
  const { versions, loading, needsSetup, reload, setVersions } = useVersions(app.id, user.id)
  const [saving, setSaving]           = useState(false)
  const [bumpType, setBumpType]       = useState('patch')   // patch | minor | major
  const [changelog, setChangelog]     = useState('')
  const [showSaveForm, setShowSaveForm] = useState(false)
  const [editLabelId, setEditLabelId] = useState(null)
  const [labelDraft, setLabelDraft]   = useState('')
  const [expandId, setExpandId]       = useState(null)
  const [migrateCopied, setMigrateCopied] = useState(false)
  const [testGate, setTestGate]       = useState(null) // null | { results, passCount, total, running }
  const testAbortRef = useRef(null)
  const toast = useToast()

  const nextVer = nextSemver(versions, bumpType)
  const hasSemverCol = versions.length === 0 || versions[0]?.semver !== undefined

  async function doSave() {
    setSaving(true)
    const { count } = await supabase
      .from('app_versions')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', app.id)
      .eq('user_id', user.id)

    const { data, error } = await supabase.from('app_versions').insert({
      app_id: app.id,
      user_id: user.id,
      version_num: (count ?? 0) + 1,
      system_prompt: app.system_prompt,
      ai_model: app.ai_model,
      ai_provider: app.ai_provider,
      semver: nextVer,
      changelog: changelog.trim() || null,
    }).select().single()
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setVersions(prev => [data, ...prev])
    setChangelog('')
    setShowSaveForm(false)
    setTestGate(null)
    toast(`${nextVer} saved`, 'success', 2000)
    track(EVENTS.VERSION_SAVED, { app_id: app.id, app_name: app.name, semver: nextVer, bump_type: bumpType })
  }

  async function saveSnapshot() {
    if (!app.system_prompt?.trim()) {
      toast('App has no system prompt — write one in Prompt Studio first', 'error', 4000)
      return
    }

    // Fetch test cases for this app
    const { data: testCases, error: tcErr } = await supabase
      .from('app_test_cases')
      .select('id, name, input, rules')
      .eq('app_id', app.id)
      .eq('user_id', user.id)

    // No test table or no tests — skip gate
    if (tcErr || !testCases?.length) { await doSave(); return }

    // Run tests
    testAbortRef.current?.abort()
    const ctrl = new AbortController()
    testAbortRef.current = ctrl
    setTestGate({ results: [], passCount: 0, total: testCases.length, running: true })
    setShowSaveForm(true)

    const results = []
    for (const tc of testCases) {
      if (ctrl.signal.aborted) break
      try {
        const output = await runPrompt(app, tc.input, ctrl.signal)
        const { passed, results: ruleResults } = evaluateCase(output, tc.rules)
        results.push({ id: tc.id, name: tc.name, passed, output, ruleResults })
      } catch (e) {
        if (e.name === 'AbortError') break
        results.push({ id: tc.id, name: tc.name, passed: false, error: e.message })
      }
      const passCount = results.filter(r => r.passed).length
      setTestGate({ results: [...results], passCount, total: testCases.length, running: true })
    }
    const passCount = results.filter(r => r.passed).length
    setTestGate({ results, passCount, total: testCases.length, running: false })

    if (passCount === testCases.length) {
      toast(`All ${testCases.length} tests passed — saving ${nextVer}`, 'success', 3000)
      await doSave()
    }
  }

  async function rollback(v) {
    const { error } = await supabase.from('apps')
      .update({ system_prompt: v.system_prompt, ai_model: v.ai_model, ai_provider: v.ai_provider })
      .eq('id', app.id)
    if (error) { toast(error.message, 'error'); return }
    onRollback?.({ ...app, system_prompt: v.system_prompt, ai_model: v.ai_model, ai_provider: v.ai_provider })
    toast(`Rolled back to ${v.semver || `v${v.version_num}`}`, 'success', 3000)
  }

  async function saveLabel(v) {
    const { error } = await supabase.from('app_versions')
      .update({ label: labelDraft.trim() || null }).eq('id', v.id)
    if (error) { toast(error.message, 'error'); return }
    setVersions(prev => prev.map(x => x.id === v.id ? { ...x, label: labelDraft.trim() || null } : x))
    setEditLabelId(null)
  }

  async function deleteVersion(id) {
    const { error } = await supabase.from('app_versions').delete().eq('id', id)
    if (error) { toast(error.message, 'error'); return }
    setVersions(prev => prev.filter(v => v.id !== id))
  }

  if (needsSetup) return <VersionSetupCard onRetry={reload} />

  // Columns may not exist yet if user ran old SQL — show migration hint
  const needsMigration = versions.length > 0 && versions[0].semver === undefined

  return (
    <div className="space-y-3">
      {/* Migration hint */}
      {needsMigration && (
        <div className="bg-amber-500/5 border border-amber-500/20 rounded-xl px-4 py-3 flex items-center gap-3">
          <p className="text-amber-400 text-xs flex-1">
            Run <code className="bg-black/20 px-1 rounded">{VERSION_MIGRATE_SQL}</code> to enable semver + changelog columns.
          </p>
          <button onClick={() => { navigator.clipboard.writeText(VERSION_MIGRATE_SQL); setMigrateCopied(true); setTimeout(() => setMigrateCopied(false), 2000) }}
            className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-1 rounded-md shrink-0 transition-colors hover:bg-amber-400/20">
            {migrateCopied ? '✓ Copied' : '📋 Copy SQL'}
          </button>
        </div>
      )}

      {/* Header + save button */}
      <div className="flex items-center justify-between">
        <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">
          {versions.length} snapshot{versions.length !== 1 ? 's' : ''}
        </p>
        <button onClick={() => { setShowSaveForm(p => !p); setTestGate(null); testAbortRef.current?.abort() }}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors">
          {showSaveForm ? '✕ Cancel' : '📸 Save snapshot'}
        </button>
      </div>

      {/* Save form */}
      {showSaveForm && (
        <div className="bg-[#171B33] border border-[#6C5CE7]/20 rounded-2xl p-4 space-y-3">
          {/* Bump type */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-2">Version bump</p>
            <div className="flex items-center gap-2">
              <div className="flex bg-[#0E1424] rounded-lg p-0.5 gap-0.5">
                {[
                  { key: 'patch', label: 'Patch', hint: 'Bug fix / wording tweak' },
                  { key: 'minor', label: 'Minor', hint: 'New capability added' },
                  { key: 'major', label: 'Major', hint: 'Breaking / full rewrite' },
                ].map(({ key, label, hint }) => (
                  <button key={key} onClick={() => setBumpType(key)}
                    title={hint}
                    className={`text-[11px] font-semibold px-3 py-1.5 rounded-md transition-all ${bumpType === key ? 'bg-[#6C5CE7] text-white shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-sm font-bold text-[#A29BFE]">{nextVer}</span>
            </div>
            <p className="text-[10px] text-slate-600 mt-1">
              {bumpType === 'patch' ? 'Bug fix or minor wording tweak — no behaviour change.' :
               bumpType === 'minor' ? 'New capability added, backwards compatible.' :
               'Breaking change or full prompt rewrite.'}
            </p>
          </div>

          {/* Changelog */}
          <div>
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide mb-1">Changelog <span className="text-slate-700 font-normal normal-case">(optional)</span></p>
            <textarea
              value={changelog}
              onChange={e => setChangelog(e.target.value)}
              placeholder="What changed? e.g. 'Tightened output format, removed verbose intro paragraph'"
              rows={2}
              className="w-full bg-[#0E1424] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 resize-none"
            />
          </div>

          {/* Test gate results */}
          {testGate && (
            <div className={`rounded-xl border p-3 space-y-2 ${
              testGate.running ? 'border-white/10 bg-white/5' :
              testGate.passCount === testGate.total ? 'border-emerald-500/20 bg-emerald-500/5' :
              'border-red-500/20 bg-red-500/5'
            }`}>
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-slate-300">
                  {testGate.running
                    ? `Running tests… ${testGate.results.length}/${testGate.total}`
                    : testGate.passCount === testGate.total
                      ? `✓ All ${testGate.total} tests passed`
                      : `${testGate.passCount}/${testGate.total} tests passed`}
                </p>
                {!testGate.running && testGate.passCount < testGate.total && (
                  <button onClick={doSave} disabled={saving}
                    className="text-[10px] font-semibold px-2 py-1 rounded-md bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white border border-white/10 transition-colors disabled:opacity-40">
                    Save anyway
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {testGate.results.map(r => (
                  <div key={r.id} className="flex items-center gap-2">
                    <span className={`text-[10px] font-bold w-3 shrink-0 ${r.passed ? 'text-emerald-400' : 'text-red-400'}`}>
                      {r.passed ? '✓' : '✗'}
                    </span>
                    <span className="text-[11px] text-slate-400 truncate">{r.name}</span>
                    {r.error && <span className="text-[10px] text-red-400 truncate">{r.error}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex justify-end">
            <button onClick={saveSnapshot} disabled={saving || testGate?.running}
              className="text-xs font-semibold px-4 py-2 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] text-white transition-colors disabled:opacity-40">
              {saving ? 'Saving…' : testGate?.running ? 'Running tests…' : `Save ${nextVer}`}
            </button>
          </div>
        </div>
      )}

      {loading && <p className="text-slate-500 text-sm text-center py-4">Loading…</p>}

      {!loading && versions.length === 0 && (
        <div className="bg-[#0E1424] border border-white/5 rounded-xl p-6 text-center">
          <p className="text-slate-400 text-sm">No snapshots yet.</p>
          <p className="text-slate-600 text-xs mt-1">
            Click "Save snapshot" to capture the current prompt. Snapshots are also saved automatically each time you save in Prompt Studio.
          </p>
        </div>
      )}

      {versions.map(v => {
        const isSelected = selectedId === v.id
        const isExpanded = expandId === v.id
        const vLabel     = v.semver || `v${v.version_num}`
        return (
          <div
            key={v.id}
            onClick={() => onSelect?.(v)}
            className={`rounded-xl border transition-all cursor-pointer ${isSelected ? 'border-[#6C5CE7]/50 bg-[#6C5CE7]/8' : 'border-white/5 bg-[#0E1424] hover:border-white/10'}`}
          >
            <div className="flex items-center gap-3 px-4 py-3">
              {/* Version badge */}
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 font-mono ${isSelected ? 'bg-[#6C5CE7] text-white' : 'bg-white/5 text-slate-400'}`}>
                {vLabel}
              </span>

              <div className="flex-1 min-w-0">
                {/* Label (editable) */}
                {editLabelId === v.id ? (
                  <input autoFocus value={labelDraft}
                    onChange={e => setLabelDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') saveLabel(v); if (e.key === 'Escape') setEditLabelId(null) }}
                    onBlur={() => saveLabel(v)}
                    onClick={e => e.stopPropagation()}
                    placeholder="Add a label…"
                    className="bg-transparent text-white text-xs focus:outline-none border-b border-[#6C5CE7] w-full pb-0.5"
                  />
                ) : (
                  <p className="text-white text-xs font-medium truncate">
                    {v.label || vLabel}
                    <button
                      onClick={e => { e.stopPropagation(); setLabelDraft(v.label || ''); setEditLabelId(v.id) }}
                      className="ml-1.5 text-slate-600 hover:text-slate-400 text-[9px]">✎</button>
                  </p>
                )}

                {/* Meta row */}
                <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-500 flex-wrap">
                  <span>{timeAgo(v.created_at)}</span>
                  {v.ai_model && <span>· {v.ai_provider === 'openai' ? '🟢' : '🟣'} {v.ai_model.split('-').slice(0, 3).join('-')}</span>}
                  {v.changelog && <span className="text-slate-600 truncate max-w-[180px]">· {v.changelog}</span>}
                </div>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1.5 shrink-0" onClick={e => e.stopPropagation()}>
                <button onClick={() => setExpandId(p => p === v.id ? null : v.id)}
                  className="text-[10px] text-slate-500 hover:text-white bg-white/5 px-2 py-1 rounded-md transition-colors">
                  {isExpanded ? 'Hide' : 'View'}
                </button>
                <button onClick={() => rollback(v)}
                  className="text-[10px] text-[#A29BFE] hover:text-white bg-[#6C5CE7]/10 hover:bg-[#6C5CE7]/20 px-2 py-1 rounded-md transition-colors border border-[#6C5CE7]/20">
                  ↺ Restore
                </button>
                <button onClick={() => deleteVersion(v.id)}
                  className="text-[10px] text-slate-600 hover:text-red-400 transition-colors px-1">×</button>
              </div>
            </div>

            {/* Expanded: changelog + prompt */}
            {isExpanded && (
              <div className="px-4 pb-3 border-t border-white/5 pt-3 space-y-3">
                {v.changelog && (
                  <div>
                    <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1">Changelog</p>
                    <p className="text-xs text-slate-400 leading-relaxed">{v.changelog}</p>
                  </div>
                )}
                <div>
                  <p className="text-[9px] text-slate-600 uppercase font-semibold mb-1.5">Prompt at this version</p>
                  <pre className="text-[11px] text-slate-400 bg-[#09101F] rounded-lg p-3 whitespace-pre-wrap leading-relaxed max-h-48 overflow-y-auto font-mono">
                    {v.system_prompt || '(empty prompt)'}
                  </pre>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
