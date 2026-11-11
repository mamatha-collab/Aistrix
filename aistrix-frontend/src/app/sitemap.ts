import { getPublicCatalog } from '../server/catalog'
import { isPublicId } from '../lib/publicCatalog'

export const dynamic = 'force-dynamic'

export default async function sitemap() {
  const origin = `https://${process.env.NEXT_PUBLIC_BRAND_DOMAIN || 'aistrix.ai'}`
  const paths = new Set(['/marketplace', '/privacy', '/terms'])
  // Anonymous, uncached catalog reads exclude private/unpublished tools and
  // make an unpublish effective without retaining stale sitemap entries.
  for (const listing of await getPublicCatalog()) {
    if (!listing.apps?.is_published || listing.apps.visibility !== 'public') continue
    if (isPublicId(listing.app_id)) paths.add(`/marketplace/${listing.app_id}`)
    if (isPublicId(listing.apps.created_by)) paths.add(`/dev/${listing.apps.created_by}`)
  }
  return [...paths].map(path => ({ url: `${origin}${path}` }))
}
