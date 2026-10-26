import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { publicEnvironment } from '../config/public-env.mjs'

// Build browser-test artifacts against synthetic local services only. No real
// environment's public keys, analytics or API endpoints enter this artifact.
const values = publicEnvironment({
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4176',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'local-fixture-public-key',
  NEXT_PUBLIC_API_URL: 'http://127.0.0.1:4176',
  NEXT_PUBLIC_BRAND_NAME: 'Aistrix', NEXT_PUBLIC_BRAND_DOMAIN: 'aistrix.ai',
})
const child = spawn(process.execPath, [fileURLToPath(new URL('./next.mjs', import.meta.url)), 'build', 'production'], {
  stdio: 'inherit', env: { ...process.env, ...values },
})
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
