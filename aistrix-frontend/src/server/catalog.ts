import type { SupabaseClient } from '@supabase/supabase-js'
import type { PublicProfile, PublicListing } from '../lib/publicCatalog'
import 'server-only'
import { cache } from 'react'
import { createPublicClient } from './supabase'
import { loadMarketApp, loadMarketApps } from '../lib/marketplace'
import { PUBLIC_CATALOG_SELECT, publicListing, publicProfile, isPublicId } from '../lib/publicCatalog'
import { loadPublicProfiles } from '../lib/publicProfiles'

async function profiles(client: SupabaseClient, ids: string[]): Promise<Map<string, PublicProfile>> {
  if (!ids.length) return new Map()
  const data = await loadPublicProfiles(client, ids)
  const result = new Map<string, PublicProfile>()
  for (const row of data || []) { const profile = publicProfile(row); if (profile?.user_id) result.set(profile.user_id, profile) }
  return result
}

export const getPublicCatalog = cache(async (): Promise<PublicListing[]> => {
  const client = createPublicClient()
  const rows = await loadMarketApps(client, { select: PUBLIC_CATALOG_SELECT })
  const developers = await profiles(client, [...new Set(rows.map((row: { user_id?: string }) => row.user_id).filter((id: string | undefined): id is string => typeof id === 'string'))])
  return rows.map((row: Record<string, unknown>) => publicListing({ ...row, developer_profiles: typeof row.user_id === 'string' ? developers.get(row.user_id) : undefined })).filter((listing: PublicListing | null): listing is PublicListing => listing !== null)
})

export const getPublicApp = cache(async (id: unknown) => {
  if (!isPublicId(id)) return null
  const client = createPublicClient()
  const row = await loadMarketApp(client, id, { select: PUBLIC_CATALOG_SELECT })
  if (!row) return null
  const developers = await profiles(client, row.user_id ? [row.user_id] : [])
  return publicListing({ ...row, developer_profiles: typeof row.user_id === 'string' ? developers.get(row.user_id) : undefined })
})

export const getPublicDeveloper = cache(async (id: unknown) => {
  if (!isPublicId(id)) return null
  const client = createPublicClient()
  const [developers, apps] = await Promise.all([
    profiles(client, [id]), loadMarketApps(client, { select: PUBLIC_CATALOG_SELECT, developerId: id }),
  ])
  const listings = apps.map(publicListing).filter((listing: PublicListing | null): listing is PublicListing => listing !== null)
  const profile = developers.get(id)
  return profile || listings.length ? { profile: profile || { user_id: id }, listings } : null
})
