import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKSPACE_ALIASES } from './config/route-aliases.mjs'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  env: { NEXT_PUBLIC_AUTH_CALLBACK_PATH: '/auth/callback' },
  // No trailing separator: on Windows "…\aistrix-frontend\" stops Turbopack
  // from ignoring .next, so its own dev log retriggers builds and reloads.
  turbopack: { root: dirname(fileURLToPath(import.meta.url)) },
  async redirects() {
    return Object.entries(WORKSPACE_ALIASES).map(([source, destination]) => ({ source, destination, permanent: false }))
  },
}

export default nextConfig
