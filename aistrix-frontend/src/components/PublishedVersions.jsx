import { useCallback, useEffect, useState } from 'react'
import { track, EVENTS } from '../lib/analytics'
import { useToast } from '../hooks/useToast'
import { listVersions, rollbackVersion } from '../lib/release'
import { timeAgo } from '../utils'
import ConfirmDialog from './ConfirmDialog'

// Every publish saves a numbered version (v1, v2…). End users run the live
// one; any earlier version can be made live again. The draft isn't changed.
// `usage` (optional): Monitor's per-version split, shown next to each version.
export default function PublishedVersions({ app, onAppUpdated, usage = null }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [confirming, setConfirming] = useState(null)   // version_num in the confirm dialog
  const [busy, setBusy] = useState(null)

  const load = useCallback(async () => {
    try { setData(await listVersions(app.id)); setError('') } catch (e) { setError(e.message) }
  }, [app.id])

  useEffect(() => { load() }, [load])

  async function rollback(num) {
    setBusy(num)
    try {
      const res = await rollbackVersion(app.id, num)
      toast(`v${num} is live again`, 'success', 3000)
      track(EVENTS.BUILD_ROLLED_BACK, { app_id: app.id, version: num })
      onAppUpdated?.({ ...app, live_version: res.live_version, is_published: true, promoted_at: res.promoted_at,
        has_draft_changes: res.has_draft_changes ?? true })
      await load()
    } catch (e) {
      toast(e.message, 'error', 6000)
    } finally {
      setBusy(null)
      setConfirming(null)
    }
  }

  const versions = data?.versions || []
  return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-3">
      <div>
        <p className="text-xs font-bold text-white uppercase tracking-wider">Published versions</p>
        <p className="text-[11px] text-slate-500 mt-1">Every publish saves a version. End users run the live one while you change the draft.</p>
      </div>

      {error && <p className="text-xs text-amber-300">{error}</p>}
      {!data && !error && <p className="text-xs text-slate-500">Loading versions…</p>}
      {data?.setup_required && <p className="text-xs text-amber-300">Version history needs a database update on this server.</p>}
      {data && !data.setup_required && !versions.length && (
        <p className="text-xs text-slate-500">No published versions yet. Publishing from Deploy saves v1.</p>
      )}

      <div className="space-y-1.5">
        {versions.map(v => (
          <div key={v.version_num} className="flex items-center gap-3 px-3 py-2 rounded-xl bg-white/[0.02]">
            <span className={`text-xs font-bold w-9 shrink-0 ${v.is_live ? 'text-emerald-400' : 'text-slate-300'}`}>v{v.version_num}</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-slate-200 truncate">
                {v.changelog || 'Published'}
                {v.is_live && <span className="ml-2 text-[10px] text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">● Live</span>}
              </p>
              <p className="text-[11px] text-slate-500 mt-0.5">
                {timeAgo(v.created_at)}{v.tests?.total ? ` · ${v.tests.passed}/${v.tests.total} test checks passed` : ''}
              </p>
              {usage && (() => {
                const u = usage.find(x => x.version === v.version_num)
                return <p className={`text-[11px] mt-0.5 ${u?.error_rate >= 0.05 ? 'text-amber-300' : 'text-slate-400'}`}>
                  {u ? `${u.runs.toLocaleString()} runs in 30 days · ${Math.round(u.error_rate * 1000) / 10}% failed` : 'No runs in 30 days'}
                </p>
              })()}
            </div>
            {!v.is_live && (
              <button onClick={() => setConfirming(v.version_num)} disabled={busy != null}
                className="text-[11px] font-semibold px-3 py-1 rounded-lg border transition-colors shrink-0 disabled:opacity-40 bg-white/5 hover:bg-white/10 border-white/10 text-slate-300">
                {busy === v.version_num ? 'Rolling back…' : 'Roll back'}
              </button>
            )}
          </div>
        ))}
      </div>

      {confirming != null && (
        <ConfirmDialog title={`Make v${confirming} live?`} subtitle={`${app.emoji || ''} ${app.name}`.trim()}
          confirmLabel={`Make v${confirming} live`} busyLabel="Rolling back…"
          onCancel={() => setConfirming(null)} onConfirm={() => rollback(confirming)}>
          End users switch to v{confirming} right away{data?.live_version ? `, replacing v${data.live_version}` : ''}. Your draft isn't changed,
          and you can switch back from this list at any time.
        </ConfirmDialog>
      )}
    </div>
  )
}
