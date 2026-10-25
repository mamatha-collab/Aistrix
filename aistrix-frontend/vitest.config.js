import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { publicEnvironment } from './config/public-env.mjs'

// Tests use process.env directly so vi.stubEnv remains effective.
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  test: { env: publicEnvironment({ ...loadEnv(mode, process.cwd(), ''), ...process.env }) },
}))
