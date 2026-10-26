// Only these existing, public settings may cross the Vite -> Next.js boundary.
// Never copy process.env wholesale into a browser build.
export const PUBLIC_ENV_KEYS = [
  'API_URL', 'PUBLIC_API_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY',
  'STRIPE_PUBLIC_KEY', 'AUTH_GOOGLE', 'BRAND_NAME', 'BRAND_DOMAIN',
  'SENTRY_DSN', 'SENTRY_DISABLE', 'ENVIRONMENT', 'POSTHOG_KEY', 'POSTHOG_HOST',
  'LEGAL_COMPANY', 'LEGAL_ADDRESS', 'LEGAL_JURISDICTION', 'LEGAL_DATA_REGION',
  'LEGAL_MINIMUM_AGE',
]

export function publicEnvironment(source, { development = false } = {}) {
  const values = Object.fromEntries(PUBLIC_ENV_KEYS.map(key => [
    `NEXT_PUBLIC_${key}`, source[`NEXT_PUBLIC_${key}`] ?? source[`VITE_${key}`] ?? '',
  ]))
  // Preserve the opt-in local demo flow, without promoting its credentials to
  // production configuration. These are intentionally visible in a dev browser.
  if (development) {
    for (const key of ['DEMO_EMAIL', 'DEMO_PASSWORD']) {
      values[`NEXT_PUBLIC_${key}`] = source[`NEXT_PUBLIC_${key}`] ?? source[`VITE_${key}`] ?? ''
    }
  }
  return values
}

export function vitePublicDefinitions(values) {
  return Object.fromEntries(Object.entries({
    NEXT_PUBLIC_DEMO_EMAIL: '',
    NEXT_PUBLIC_DEMO_PASSWORD: '',
    NEXT_PUBLIC_AUTH_CALLBACK_PATH: '',
    ...values,
  }).map(([key, value]) => [
    `process.env.${key}`, JSON.stringify(value),
  ]))
}
