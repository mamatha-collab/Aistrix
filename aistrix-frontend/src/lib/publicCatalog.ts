import { isRecord } from '../types/domain'
const APP_FIELDS = ['id', 'name', 'description', 'emoji', 'color', 'tags', 'created_by',
  'is_published', 'visibility', 'is_paid', 'price_per_run', 'total_runs', 'created_at']
const LISTING_FIELDS = ['id', 'app_id', 'user_id', 'title', 'tagline', 'description', 'category', 'tags']
const PROFILE_FIELDS = ['user_id', 'display_name', 'bio', 'website', 'github', 'twitter', 'avatar_url']
const pick = (row: Record<string, unknown>, fields: readonly string[]) => Object.fromEntries(fields.filter(key => row?.[key] !== undefined).map(key => [key, row[key]]))

export const PUBLIC_CATALOG_SELECT = `${APP_FIELDS.join(',')},domains(name),marketplace_listings(id,app_id,user_id,title,tagline,description,category,tags,status)`
export const PUBLIC_PROFILE_SELECT = PROFILE_FIELDS.join(',')
export const isPublicId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)

export function publicProfile(row: unknown): PublicProfile | null {
  if (!isRecord(row)) return null
  const result = pick(row, PROFILE_FIELDS)
  return isPublicProfile(result) ? result : null
}

export function publicListing(row: unknown): PublicListing | null {
  if (!isRecord(row) || !isRecord(row.apps) || !row.apps.is_published || row.apps.visibility !== 'public') return null
  const result = { ...pick(row, LISTING_FIELDS), apps: pick(row.apps, APP_FIELDS), developer_profiles: publicProfile(row.developer_profiles) }
  return isPublicListing(result) ? result : null
}

export interface PublicProfile extends Record<string, unknown> {
  user_id?: string
  display_name?: string | null
  bio?: string | null
}
export interface PublicListing extends Record<string, unknown> {
  app_id: string
  title: string
  tagline?: string | null
  description?: string | null
  apps: Record<string, unknown> & { created_by?: string; is_published: boolean; visibility: string }
  developer_profiles: PublicProfile | null
}
function isPublicProfile(value: Record<string, unknown>): value is PublicProfile {
  return (value.user_id === undefined || typeof value.user_id === 'string') &&
    ['display_name', 'bio'].every(key => value[key] === undefined || value[key] === null || typeof value[key] === 'string')
}
function isPublicListing(value: Record<string, unknown>): value is PublicListing {
  return typeof value.app_id === 'string' && typeof value.title === 'string' && isRecord(value.apps) &&
    typeof value.apps.is_published === 'boolean' && typeof value.apps.visibility === 'string' &&
    (value.apps.created_by === undefined || typeof value.apps.created_by === 'string') &&
    ['tagline', 'description'].every(key => value[key] === undefined || value[key] === null || typeof value[key] === 'string')
}
