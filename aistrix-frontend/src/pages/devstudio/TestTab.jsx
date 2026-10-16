import SimpleTestPanel from '../../components/SimpleTestPanel'
import { DEV_PHASES, getDevPhase } from './shared'


// ─── Tab: Test ────────────────────────────────────────────────────────────────

export function TestTab({ apps, allApps = apps, user, selectedAppId, phaseByAppId = {}, onMovePhase, onOpenKeys }) {
  const activeAppId = apps.some(a => a.id === selectedAppId) ? selectedAppId : apps[0]?.id || null
  const selectedApp = apps.find(a => a.id === activeAppId)
  if (!allApps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-10 text-center">
      <p className="text-slate-400 text-sm">Create an app in Design before testing.</p>
    </div>
  )

  if (!apps.length) return (
    <div className="bg-[#171B33] border border-white/5 rounded-2xl p-12 text-center">
      <div className="text-4xl mb-3">🧪</div>
      <p className="text-white font-medium mb-1">No apps are in Test</p>
      <p className="text-slate-400 text-sm mb-5">Move a Design or Deploy app here when you need to validate changes before publishing.</p>
      <div className="flex justify-center gap-2 flex-wrap">
        {allApps.map(a => (
          <button key={a.id} onClick={() => onMovePhase?.(a.id, 'test')}
            className="text-xs px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors">
            {a.emoji} {a.name} · {DEV_PHASES[getDevPhase(a, phaseByAppId)]?.label}
          </button>
        ))}
      </div>
    </div>
  )

  return (
    <SimpleTestPanel key={selectedApp?.id} app={selectedApp} user={user} onMovePhase={onMovePhase} onOpenKeys={onOpenKeys} />
  )
}
