import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { publicEnvironment } from './config/public-env.mjs'

// Placeholders for a machine with no .env (CI, a fresh clone). Code that builds
// the Supabase client when it is imported needs a URL and key to exist; the
// tests never connect to it. A real .env still wins.
const TEST_ENV = {
  NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'test-anon-key',
}

// Tests use process.env directly so vi.stubEnv remains effective.
export default defineConfig(({ mode }) => {
  const env = publicEnvironment({ ...loadEnv(mode, process.cwd(), ''), ...process.env })
  for (const [key, value] of Object.entries(TEST_ENV)) env[key] ||= value
  return {
    plugins: [react()],
    test: {
      env,
      // The database tests start an in-memory Postgres and apply every migration;
      // that takes tens of seconds on a cold or busy machine.
      testTimeout: 120_000,
      hookTimeout: 180_000,
    },
  }
})
