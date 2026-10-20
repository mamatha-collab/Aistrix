import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// The page title follows the brand (VITE_BRAND_NAME, as in src/lib/brand.js).
function brandTitle(mode) {
  const name = loadEnv(mode, process.cwd(), 'VITE_').VITE_BRAND_NAME || 'Aistrix'
  return { name: 'brand-title', transformIndexHtml: html => html.replace(/<title>[^<]*<\/title>/, `<title>${name}</title>`) }
}

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    tailwindcss(),
    brandTitle(mode),
  ],
  build: {
    chunkSizeWarningLimit: 800,
  },
}))
