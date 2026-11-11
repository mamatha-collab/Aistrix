import { useState } from 'react'
import { manageRequest } from '../lib/manageApi'
import { useBuilderNavigation } from '../hooks/useBuilderNavigation'

export default function CreateCodeApp({ presentation = 'inline', navigationGuardRef, onLeave, onClose, onBack, onCreated }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useBuilderNavigation({ enabled: true, navigationGuardRef, hasChanges: !!name, busy, onLeave })
  async function create(event) {
    event.preventDefault(); setBusy(true); setError('')
    try {
      const result = await manageRequest('/v1/code-apps', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      if (!result.app?.id || result.app.app_type !== 'code_job') throw new Error('The code application could not be verified.')
      onCreated(result.app)
    } catch (error) { setError(error.message) }
    finally { setBusy(false) }
  }
  return <div className={presentation === 'inline' ? 'mx-auto max-w-3xl p-5' : 'fixed inset-0 z-50 overflow-y-auto bg-[#101426] p-8'}>
    <button onClick={onBack || onClose} disabled={busy} className="text-sm text-slate-400">← App types</button>
    <h1 className="mt-6 text-2xl font-semibold text-white">New Code Application</h1>
    <p className="mt-3 text-sm text-slate-300">Name your Python project, then describe changes in AI Studio or edit the files yourself. Preview structured input and output in an isolated worker. AI code generation uses your provider key; creating the project and running Python do not require one.</p>
    <p className="mt-3 text-xs text-slate-400">Source editing works before hosting is configured. Builds and previews use the configured isolated execution provider. This first release supports Python jobs with networking disabled; web servers and mobile builds are not included yet.</p>
    <form onSubmit={create} className="mt-6 space-y-4">
      <label className="block text-sm text-white">Application name<input autoFocus required maxLength={100} value={name} disabled={busy} onChange={event => setName(event.target.value)} className="mt-2 block w-full rounded-xl border border-white/10 bg-[#171B33] p-3" /></label>
      {error && <p role="alert" className="text-sm text-red-300">{error}</p>}
      <button disabled={busy || !name.trim()} className="rounded-xl bg-[#6C5CE7] px-5 py-3 text-sm font-semibold text-white disabled:opacity-40">{busy ? 'Creating…' : 'Create code application'}</button>
    </form>
  </div>
}
