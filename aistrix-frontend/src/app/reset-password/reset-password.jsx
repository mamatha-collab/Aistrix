'use client'

import { useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../supabase'

export default function ResetPassword() {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (password.length < 8 || password !== confirm) { setError('Use at least 8 characters and enter the same password twice.'); return }
    setSaving(true); setError('')
    try {
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      setPassword(''); setConfirm(''); setSaved(true)
    } catch { setError('Your password could not be updated. Request a new reset link and try again.') }
    finally { setSaving(false) }
  }
  return <main className="min-h-screen grid place-items-center px-6 text-white">
    <form onSubmit={submit} className="w-full max-w-sm space-y-4">
      <h1 className="text-2xl font-bold">Reset your password</h1>
      {saved ? <><p role="status">Your password was updated.</p><Link href="/dashboard" className="text-[#A29BFE] underline">Continue to your workspace</Link></> : <>
        <label className="block">New password<input required minLength={8} autoComplete="new-password" type="password" value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-lg bg-[#1A2038] px-3 py-2" /></label>
        <label className="block">Confirm new password<input required minLength={8} autoComplete="new-password" type="password" value={confirm} onChange={event => setConfirm(event.target.value)} className="mt-2 w-full rounded-lg bg-[#1A2038] px-3 py-2" /></label>
        {error && <p role="alert" className="text-amber-400">{error}</p>}
        <button disabled={saving} type="submit" className="rounded-lg bg-[#6C5CE7] px-4 py-2 disabled:opacity-50">{saving ? 'Saving…' : 'Save password'}</button>
      </>}
    </form>
  </main>
}
