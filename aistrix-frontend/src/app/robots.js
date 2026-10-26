import { WORKSPACE_ROUTES } from '../lib/workspaceRoutes'

export default function robots() {
  const origin = `https://${process.env.NEXT_PUBLIC_BRAND_DOMAIN || 'aistrix.ai'}`
  return {
    rules: { userAgent: '*', allow: ['/marketplace', '/dev/', '/privacy', '/terms'], disallow: [
      ...Object.keys(WORKSPACE_ROUTES), '/login', '/auth/', '/reset-password', '/app/', '/embed/', '/invite/', '/gallery',
    ] },
    sitemap: `${origin}/sitemap.xml`,
  }
}
