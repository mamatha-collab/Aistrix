import { useEffect, useState } from 'react'
import { manageRequest } from '../../lib/manageApi'
import AppRunSurface from '../../components/AppRunSurface'

export default function CustomerPreview({ appId, user, dirty = false }) {
  const [open, setOpen] = useState(false)
  const [version, setVersion] = useState('draft')
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    if (!open) return
    let active = true
    setData(null); setError('')
    manageRequest(`/v1/apps/${appId}/preview?version=${version}`).then(result => {
      if (!result.app?.id || result.app.preview_version !== version || result.version !== version) throw new Error('The selected preview version could not be verified.')
      if (active) setData(result)
    }).catch(error => { if (active) setError(error.message) })
    return () => { active = false }
  }, [open, appId, version, refresh])
  return <section aria-label="Customer preview" className="space-y-3 rounded-2xl border border-white/10 bg-[#111827] p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-white">Customer preview</h3><button onClick={() => setOpen(value => !value)} className="text-xs text-[#A29BFE]">{open ? 'Close preview' : 'Open customer preview'}</button></div>
    <p className="text-xs text-slate-400">Use the customer runner with a saved draft or published release. Preview runs use your keys and may call configured tools or webhooks. Use sample data and test destinations.</p>
    {dirty && <p className="text-xs text-amber-200">Unsaved changes are excluded. Save the design before previewing those changes.</p>}
    {open && <>
      <div className="flex flex-wrap gap-3 text-xs"><label className="text-slate-300">Preview version<select aria-label="Preview version" value={version} onChange={event => { setData(null); setVersion(event.target.value) }} className="ml-2 rounded-lg border border-white/10 bg-[#0E1424] p-2 text-white"><option value="draft">Saved draft</option><option value="live">Published release</option></select></label><button onClick={() => { setData(null); setRefresh(value => value + 1) }} className="text-[#A29BFE]">Reload preview</button></div>
      {error && <p role="alert" className="text-xs text-amber-200">{error}</p>}
      {!data && !error && <p role="status" className="text-xs text-slate-400">Loading saved version…</p>}
      {data?.version === version && <><p className="text-xs text-slate-300">{version === 'draft' ? 'Saved draft — customers do not see this version.' : `Published v${data.live_version}${data.is_published ? '' : ' — currently offline'}.`} Previewing does not publish changes.</p><AppRunSurface key={`${appId}:${version}:${refresh}`} app={data.app} user={user} /></>}
    </>}
  </section>
}
