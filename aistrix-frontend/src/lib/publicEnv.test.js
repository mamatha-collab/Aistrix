import { describe, expect, it } from 'vitest'
import { publicEnvironment, vitePublicDefinitions } from '../../config/public-env.mjs'

describe('browser configuration migration', () => {
  it('maps legacy public settings and prefers explicitly configured Next.js values', () => {
    expect(publicEnvironment({ VITE_API_URL: 'https://old.example', NEXT_PUBLIC_API_URL: 'https://new.example', VITE_BRAND_NAME: 'Aistrix' }))
      .toMatchObject({ NEXT_PUBLIC_API_URL: 'https://new.example', NEXT_PUBLIC_BRAND_NAME: 'Aistrix' })
  })

  it('does not export arbitrary public-looking keys, service keys or credentials', () => {
    const env = publicEnvironment({
      SUPABASE_SERVICE_ROLE_KEY: 'private', OPENAI_API_KEY: 'private',
      VITE_SECRET: 'private', NEXT_PUBLIC_SECRET: 'private', VITE_DEMO_PASSWORD: 'private',
    })
    expect(JSON.stringify(env)).not.toContain('private')
    expect(env).not.toHaveProperty('NEXT_PUBLIC_SECRET')
    expect(env).not.toHaveProperty('NEXT_PUBLIC_DEMO_PASSWORD')
  })

  it('honors explicit empty values rather than reviving legacy configuration', () => {
    expect(publicEnvironment({ NEXT_PUBLIC_AUTH_GOOGLE: '', VITE_AUTH_GOOGLE: 'true' }).NEXT_PUBLIC_AUTH_GOOGLE).toBe('')
  })

  it('keeps optional demo credentials in explicit local development only', () => {
    const source = { VITE_DEMO_EMAIL: 'demo@example.invalid', VITE_DEMO_PASSWORD: 'dev-only' }
    expect(publicEnvironment(source)).not.toHaveProperty('NEXT_PUBLIC_DEMO_PASSWORD')
    expect(publicEnvironment(source, { development: true })).toMatchObject({
      NEXT_PUBLIC_DEMO_EMAIL: 'demo@example.invalid', NEXT_PUBLIC_DEMO_PASSWORD: 'dev-only',
    })
  })

  it('defines only individual browser references for the temporary Vite build', () => {
    const definitions = vitePublicDefinitions(publicEnvironment({ VITE_API_URL: 'https://api.example' }))
    expect(definitions['process.env.NEXT_PUBLIC_API_URL']).toBe('"https://api.example"')
    expect(definitions).not.toHaveProperty('process.env')
    expect(definitions['process.env.NEXT_PUBLIC_DEMO_PASSWORD']).toBe('""')
  })
})
