import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { publicEnvironment, vitePublicDefinitions } from './config/public-env.mjs'

// The rollback build uses the same brand as the Next.js build.
function brandTitle(mode) {
  const name = publicEnvironment({ ...loadEnv(mode, process.cwd(), ''), ...process.env }).NEXT_PUBLIC_BRAND_NAME || 'Aistrix'
  return { name: 'brand-title', transformIndexHtml: html => html.replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`) }
}

export default defineConfig(({ mode, command }) => ({
  // Tests use process.env directly so vi.stubEnv remains effective.
  define: mode === 'test' ? {} : vitePublicDefinitions(publicEnvironment({ ...loadEnv(mode, process.cwd(), ''), ...process.env }, { development: command === 'serve' })),
  test: { env: publicEnvironment({ ...loadEnv(mode, process.cwd(), ''), ...process.env }) },
  plugins: [
    react(),
    tailwindcss(),
    brandTitle(mode),
  ],
  build: {
    chunkSizeWarningLimit: 800,
  },
}))
