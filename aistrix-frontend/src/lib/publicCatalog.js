const APP_FIELDS = ['id', 'name', 'description', 'emoji', 'color', 'tags', 'created_by',
  'is_published', 'visibility', 'is_paid', 'price_per_run', 'total_runs', 'created_at']
const LISTING_FIELDS = ['id', 'app_id', 'user_id', 'title', 'tagline', 'description', 'category', 'tags']
const PROFILE_FIELDS = ['user_id', 'display_name', 'bio', 'website', 'github', 'twitter', 'avatar_url']
const pick = (row, fields) => Object.fromEntries(fields.filter(key => row?.[key] !== undefined).map(key => [key, row[key]]))

export const PUBLIC_CATALOG_SELECT = `${APP_FIELDS.join(',')},domains(name),marketplace_listings(id,app_id,user_id,title,tagline,description,category,tags,status)`
export const PUBLIC_PROFILE_SELECT = PROFILE_FIELDS.join(',')
export const isPublicId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export function publicProfile(row) {
  return row ? pick(row, PROFILE_FIELDS) : null
}

export function publicListing(row) {
  if (!row?.apps?.is_published || row.apps.visibility !== 'public') return null
  return { ...pick(row, LISTING_FIELDS), apps: pick(row.apps, APP_FIELDS), developer_profiles: publicProfile(row.developer_profiles) }
}
