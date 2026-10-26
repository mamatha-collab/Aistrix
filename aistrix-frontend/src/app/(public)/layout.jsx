import Link from 'next/link'
import PublicRuntime from './runtime'
import { BRAND } from '../../lib/brand'

export default function PublicLayout({ children }) {
  return <>
    <header className="border-b border-white/10 bg-[#0E1424] text-white">
      <nav aria-label="Public navigation" className="max-w-7xl mx-auto flex flex-wrap items-center gap-5 px-6 py-4">
        <Link href="/marketplace" className="font-bold text-lg">{BRAND}</Link>
        <Link href="/marketplace" className="text-sm text-slate-300">Marketplace</Link>
        <Link href="/developer" className="text-sm text-slate-300">Dev Studio</Link>
        <Link href="/dashboard" className="text-sm text-slate-300">My workspace</Link>
        <Link href="/login" className="ml-auto text-sm text-[#A29BFE]">Sign in</Link>
      </nav>
    </header>
    <PublicRuntime />
    <main className="min-h-screen flex flex-col">{children}</main>
  </>
}
