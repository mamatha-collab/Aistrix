import type { App, Blueprint } from '../../types/application'
import { readinessChecks } from './shared'

export default function BuildChecklist({ app, bp, isDirty, saving, onSave, onGoToTest, serverProblems }: { app: App; bp: Blueprint; isDirty: boolean; saving: boolean; onSave: () => boolean | Promise<boolean>; onGoToTest?: () => void; serverProblems: string[] | null }) {
  const checks = readinessChecks(app, bp)
  const complete = checks.every(check => check.ok)
  const remaining = checks.filter(check => !check.ok)
  async function next() {
    if (isDirty && !await onSave()) return
    onGoToTest?.()
  }
  return <section aria-label="Build checklist" className="space-y-3 rounded-2xl border border-white/10 bg-[#171B33] p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold text-white">Build checklist</h3>
      <span className="text-xs text-slate-400">{checks.length - remaining.length}/{checks.length} design checks complete</span>
    </div>
    <p className="text-xs text-slate-300">{!complete ? `Next: ${remaining[0]?.label || 'Complete the design'}.` : isDirty ? 'Next: save this design, then test the same draft.' : 'Next: test the saved draft before publishing.'}</p>
    <ul className="grid gap-2 sm:grid-cols-2">{checks.map(check => <li key={check.key} className={`text-xs ${check.ok ? 'text-emerald-300' : 'text-slate-400'}`}><span aria-hidden="true">{check.ok ? '✓' : '○'}</span> {check.label}</li>)}</ul>
    <ol className="grid gap-2 text-xs sm:grid-cols-3" aria-label="Build stages">
      <li className="rounded-lg border border-white/10 p-3"><strong className="text-white">1. Design</strong><p className="mt-1 text-slate-400">{complete && !isDirty ? 'Saved design checks complete' : 'Complete the checklist and save'}</p></li>
      <li className="rounded-lg border border-white/10 p-3"><strong className="text-white">2. Test</strong><p className="mt-1 text-slate-400">Run required checks against this saved draft</p></li>
      <li className="rounded-lg border border-white/10 p-3"><strong className="text-white">3. Deploy</strong><p className="mt-1 text-slate-400">Review release checks, preview, then publish</p></li>
    </ol>
    {serverProblems === null ? <p className="text-[11px] text-slate-400">Saved-release checks have not been verified yet.</p>
      : (serverProblems?.length || 0) > 0 ? <div className="text-xs text-amber-200"><p>Before publishing, also resolve:</p><ul className="mt-1 list-disc pl-4">{serverProblems?.map((problem, index) => <li key={index}>{problem}</li>)}</ul></div>
        : <p className="text-[11px] text-slate-400">Deploy checks decide publication after tests pass. Completing a design does not mark tests as passed.</p>}
    <button disabled={!complete || saving} onClick={next} className="rounded-xl bg-[#6C5CE7] px-4 py-2 text-xs font-semibold text-white disabled:opacity-40">{saving ? 'Saving…' : isDirty ? 'Save and go to Test' : 'Go to Test'}</button>
  </section>
}
