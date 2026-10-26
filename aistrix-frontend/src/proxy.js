import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { hasSessionCookies, safeReturnPath } from './lib/authPaths'
import { requiresWorkspaceSession } from './lib/workspaceRoutes'

function signInRedirect(request, prior) {
  const next = safeReturnPath(request.nextUrl.pathname + request.nextUrl.search)
  // Proxy responses require an absolute Location. Preserve the incoming Host:
  // NextURL normalizes loopback IPs to localhost, which changes cookie origins.
  const target = new URL('/login', request.url)
  if (request.headers.get('host')) target.host = request.headers.get('host')
  target.searchParams.set('next', next)
  const response = new NextResponse(null, { status: 307, headers: {
    Location: target.toString(), 'Cache-Control': 'private, no-store',
  } })
  prior.cookies.getAll().forEach(cookie => response.cookies.set(cookie))
  for (const name of ['pragma', 'expires']) {
    if (prior.headers.has(name)) response.headers.set(name, prior.headers.get(name))
  }
  return response
}

export async function proxy(request) {
  let response = NextResponse.next({ request })
  if (request.nextUrl.pathname === '/auth/callback') return response
  const privateRoute = requiresWorkspaceSession(request.nextUrl.pathname)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!hasSessionCookies(request.cookies.getAll(), url)) return privateRoute ? signInRedirect(request, response) : response
  // Authenticated responses must never be stored in a shared public cache.
  response.headers.set('Cache-Control', 'private, no-store')
  const client = createServerClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll(values, headers = {}) {
      values.forEach(({ name, value }) => request.cookies.set(name, value))
      const prior = response.cookies.getAll()
      response = NextResponse.next({ request })
      prior.forEach(cookie => response.cookies.set(cookie))
      values.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
      response.headers.set('Cache-Control', 'private, no-store')
    },
  } })
  // Check before the browser-only shell can defer a nested page's render.
  // getUser also checks revoked sessions with Auth on private requests.
  if (privateRoute) {
    const { data, error } = await client.auth.getUser()
    if (error || !data?.user) return signInRedirect(request, response)
    if (['/admin', '/moderator'].includes(request.nextUrl.pathname)) {
      const result = await client.from('user_roles').select('role').eq('user_id', data.user.id).maybeSingle()
      const allowed = request.nextUrl.pathname === '/admin'
        ? result.data?.role === 'admin' : ['admin', 'moderator'].includes(result.data?.role)
      if (result.error || !allowed) {
        const denied = NextResponse.rewrite(new URL('/_not-found', request.url), { status: 404 })
        response.cookies.getAll().forEach(cookie => denied.cookies.set(cookie))
        denied.headers.set('Cache-Control', 'private, no-store')
        return denied
      }
    }
  } else await client.auth.getClaims()
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|css|js|woff2?)$).*)'],
}
