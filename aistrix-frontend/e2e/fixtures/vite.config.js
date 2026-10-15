import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  envDir: false,
  envPrefix: 'FIXTURE_',
  plugins: [react(), tailwindcss()],
  // Bundle the PDF library up front: optimizing it on first use reloads the page mid-download.
  optimizeDeps: { include: ['jspdf', 'jspdf-autotable'] },
  server: { hmr: false, watch: { ignored: ['**/test-results/**', '**/e2e/local/**'] } },
  resolve: {
    alias: [{ find: /^(\.\.\/)+supabase$/, replacement: fileURLToPath(new URL('./supabase.js', import.meta.url)) }],
  },
})
