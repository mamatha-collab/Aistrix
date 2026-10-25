import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../supabase', () => ({ supabase: { auth: {} } }))
vi.mock('../lib/session', () => ({ sessionExpired: () => false }))

async function render(googleOn) {
  vi.resetModules()
  vi.stubEnv('NEXT_PUBLIC_AUTH_GOOGLE', googleOn ? 'true' : '')
  const { default: Auth } = await import('./Auth.jsx')
  return renderToStaticMarkup(createElement(Auth, { developer: true }))
}

describe('Continue with Google', () => {
  it('stays hidden until Google sign-in is set up for this environment', async () => {
    expect(await render(false)).not.toContain('Continue with Google')
  })

  it('shows on the sign-in page once turned on', async () => {
    const html = await render(true)
    expect(html).toContain('Continue with Google')
    expect(html).toContain('Sign in to Developer')
  })
})
