import { APP_PUBLIC_SELECT } from './appColumns'

// A marketplace listing enriches an app; it isn't required for discovery.
// Use only public columns and explicit publication/visibility filters even
// when the caller is staff or an editor with broader database permissions.
export const MARKET_APP_SELECT = `${APP_PUBLIC_SELECT}, domains(name), marketplace_listings(id, app_id, user_id, title, tagline, description, category, tags, status)`
const CHUNK_SIZE = 500

export function marketListing(app) {
  const listings = Array.isArray(app.marketplace_listings) ? app.marketplace_listings : [app.marketplace_listings]
  const listing = listings.find(row => row?.status === 'live')
  const domain = Array.isArray(app.domains) ? app.domains[0] : app.domains
  return {
    id: app.id, app_id: app.id, user_id: app.created_by,
    ...listing, apps: app,
    // A listing with an empty field must still have a useful card/detail.
    title: listing?.title?.trim() || app.name,
    tagline: listing?.tagline?.trim() || app.description,
    description: listing?.description?.trim() || app.description,
    category: listing?.category?.trim() || domain?.name || 'Other',
    tags: listing?.tags || app.tags || [],
  }
}

export async function loadMarketApps(client, { select = MARKET_APP_SELECT, developerId } = {}) {
  const apps = []
  // PostgREST caps responses. Read every page so search/category filters
  // include the whole catalog, rather than just the first server page.
  for (let start = 0; ; start += CHUNK_SIZE) {
    let query = client.from('apps').select(select)
      .eq('is_published', true).eq('visibility', 'public')
    if (developerId) query = query.eq('created_by', developerId)
    const { data, error } = await query
      .order('created_at', { ascending: false }).order('id', { ascending: true })
      .range(start, start + CHUNK_SIZE - 1)
    if (error) throw new Error(error.message)
    apps.push(...(data || []))
    if (!data || data.length < CHUNK_SIZE) break
  }
  return apps.map(marketListing)
}

export async function loadMarketApp(client, id, { select = MARKET_APP_SELECT } = {}) {
  const { data, error } = await client.from('apps').select(select)
    .eq('id', id).eq('is_published', true).eq('visibility', 'public').maybeSingle()
  if (error) throw new Error(error.message)
  return data ? marketListing(data) : null
}

export function filterMarketApps(listings, category, search) {
  const needle = search.trim().toLowerCase()
  return listings.filter(row => (category === 'All' || row.category === category)
    && (!needle || [row.title, row.apps?.name].some(value => String(value || '').toLowerCase().includes(needle))))
}
