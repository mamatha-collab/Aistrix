import { safeReturnPath } from '../../lib/authPaths'
import Login from './login'

export const metadata = { title: 'Sign in | Aistrix', robots: { index: false, follow: false } }

export default async function LoginPage({ searchParams }) {
  const query = await searchParams
  return <Login nextPath={safeReturnPath(query.next)} failed={query.error === 'callback_failed'} recoveryRequired={query.error === 'recovery_required'} />
}
