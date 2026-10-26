'use client'

import { useEffect, useState } from 'react'
import NextNavigation from '../next-navigation'
import { MarketplacePage, MarketplaceAppPage } from '../../screens/MarketplacePage'
import DeveloperProfilePage from '../../screens/DeveloperProfilePage'
import { supabase, browserSessionReady } from '../../supabase'

// Native pages own URLs, server data, metadata and 404 responses.
export default function CatalogView({ kind, listings, listing, developer }) {
  const [user, setUser] = useState(null)
  useEffect(() => {
    let live = true
    browserSessionReady.then(() => supabase.auth.getSession()).then(({ data }) => { if (live) setUser(data.session?.user || null) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (live) setUser(session?.user || null)
    })
    return () => { live = false; subscription.unsubscribe() }
  }, [])
  return <NextNavigation>
    {kind === 'catalog' && <MarketplacePage user={user} initialListings={listings} />}
    {kind === 'app' && <MarketplaceAppPage initialListing={listing} />}
    {kind === 'developer' && <DeveloperProfilePage initialProfile={developer.profile} initialListings={developer.listings} />}
  </NextNavigation>
}
