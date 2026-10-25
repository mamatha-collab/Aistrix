// Local test service only. This token is deliberately unsigned and is never
// accepted by a hosted Supabase instance or the Aistrix backend.
export const fixtureUser = {
  id: '00000000-0000-4000-8000-000000000301', email: 'fixture@example.invalid',
  aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {},
  created_at: '2026-01-01T00:00:00Z',
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
export const fixtureToken = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: fixtureUser.id, aud: 'authenticated', role: 'authenticated', exp: 4102444800 })}.synthetic-signature`
export const fixtureSession = {
  access_token: fixtureToken, refresh_token: 'synthetic-refresh', token_type: 'bearer',
  expires_at: 4102444800, expires_in: 3600, user: fixtureUser,
}
