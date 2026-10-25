import { fileURLToPath } from 'node:url'
import { WORKSPACE_ALIASES } from './config/route-aliases.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_AUTH_CALLBACK_PATH: '/auth/callback' },
  turbopack: { root: fileURLToPath(new URL('.', import.meta.url)) },
  async redirects() {
    return Object.entries(WORKSPACE_ALIASES).map(([source, destination]) => ({ source, destination, permanent: false }))
  },
}

export default nextConfig
