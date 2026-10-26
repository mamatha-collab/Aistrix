import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'
import { safeReturnPath } from '../../../lib/authPaths'

export async function GET(request) {
  const url = new URL(request.url)
  const next = safeReturnPath(url.searchParams.get('next'))
  // A relative Location retains the browser's actual origin, even when a
  // reverse proxy/Next.js normalizes request.url's hostname internally.
  let response = new NextResponse(null, { status: 307, headers: { Location: next } })
  response.headers.set('Cache-Control', 'private, no-store')
  const client = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { cookies: {
    getAll: () => request.cookies.getAll(),
    setAll(values, headers = {}) {
      values.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
      for (const [name, value] of Object.entries(headers)) response.headers.set(name, value)
    },
  } })
  const code = url.searchParams.get('code')
  let succeeded = false
  if (code) {
    try {
      const { error } = await client.auth.exchangeCodeForSession(code)
      succeeded = !error
    } catch { /* Return a generic retry path; never place codes/tokens in errors. */ }
  }
  if (!succeeded) {
    const failed = new URLSearchParams({ error: 'callback_failed', next })
    const redirect = new NextResponse(null, { status: 307, headers: { Location: `/login?${failed}` } })
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
    for (const name of ['cache-control', 'expires', 'pragma']) {
      const value = response.headers.get(name)
      if (value) redirect.headers.set(name, value)
    }
    redirect.headers.set('Cache-Control', 'private, no-store')
    response = redirect
  }
  response.headers.set('Referrer-Policy', 'no-referrer')
  return response
}
