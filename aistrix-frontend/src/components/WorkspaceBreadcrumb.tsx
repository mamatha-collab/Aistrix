import type { CapabilityId } from '../types/domain'
import { ArrowLeft } from 'lucide-react'
import { developerCapabilityLabel } from '../lib/developerCapabilities'

export default function WorkspaceBreadcrumb({ capability, label, onHome }: { capability?: CapabilityId | null; label?: string | null; onHome: () => void }) {
  const current = label || developerCapabilityLabel(capability)
  return <nav aria-label="Developer workspace breadcrumb" className="flex min-w-0 items-center gap-2 text-sm sm:gap-3">
    <button onClick={onHome} aria-label="Developer Workspace" className="inline-flex min-h-11 shrink-0 items-center gap-2 font-semibold text-white hover:text-violet-200">
      {current && <ArrowLeft size={15} aria-hidden="true" />}Developer workspace
    </button>
    {current && <><span aria-hidden="true" className="text-slate-500">/</span><span aria-current="page" className="min-w-0 truncate text-violet-200" title={current}>{current}</span></>}
  </nav>
}
