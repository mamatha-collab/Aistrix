import 'server-only'
import { cache } from 'react'
import { createPublicClient } from './supabase'
import { loadMarketApp, loadMarketApps } from '../lib/marketplace'
import { PUBLIC_CATALOG_SELECT, publicListing, publicProfile, isPublicId } from '../lib/publicCatalog'
import { loadPublicProfiles } from '../lib/publicProfiles'

async function profiles(client, ids) {
  if (!ids.length) return new Map()
  const data = await loadPublicProfiles(client, ids)
  return new Map((data || []).map(row => [row.user_id, publicProfile(row)]))
}

export const getPublicCatalog = cache(async () => {
  const client = createPublicClient()
  const rows = await loadMarketApps(client, { select: PUBLIC_CATALOG_SELECT })
  const developers = await profiles(client, [...new Set(rows.map(row => row.user_id).filter(Boolean))])
  return rows.map(row => publicListing({ ...row, developer_profiles: developers.get(row.user_id) })).filter(Boolean)
})

export const getPublicApp = cache(async id => {
  if (!isPublicId(id)) return null
  const client = createPublicClient()
  const row = await loadMarketApp(client, id, { select: PUBLIC_CATALOG_SELECT })
  if (!row) return null
  const developers = await profiles(client, row.user_id ? [row.user_id] : [])
  return publicListing({ ...row, developer_profiles: developers.get(row.user_id) })
})

export const getPublicDeveloper = cache(async id => {
  if (!isPublicId(id)) return null
  const client = createPublicClient()
  const [developers, apps] = await Promise.all([
    profiles(client, [id]), loadMarketApps(client, { select: PUBLIC_CATALOG_SELECT, developerId: id }),
  ])
  const listings = apps.map(publicListing).filter(Boolean)
  const profile = developers.get(id)
  return profile || listings.length ? { profile: profile || { user_id: id }, listings } : null
})
