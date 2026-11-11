import { redirect } from 'next/navigation'
import { createSessionClient } from '../../server/supabase'
import ResetPassword from './reset-password'

export const metadata = { title: 'Reset password | Aistrix', robots: { index: false, follow: false } }

export default async function ResetPasswordPage() {
  const client = await createSessionClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect('/login?error=recovery_required')
  return <ResetPassword />
}
