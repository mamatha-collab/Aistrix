'use client'

import { useEffect, useState } from 'react'
import NextNavigation from '../next-navigation'
import { MarketplacePage, MarketplaceAppPage } from '../../screens/MarketplacePage'
import DeveloperProfilePage from '../../screens/DeveloperProfilePage'
import { supabase, browserSessionReady } from '../../supabase'
import MarketplaceConsole from '../../components/MarketplaceConsole'

// Native pages own URLs, server data, metadata and 404 responses.
export default function CatalogView({ kind, listings, listing, developer }) {
  const [user, setUser] = useState(null)
  const [sessionReady, setSessionReady] = useState(false)
  useEffect(() => {
    let live = true
    browserSessionReady.then(() => supabase.auth.getSession()).then(({ data }) => {
      if (live) { setUser(data.session?.user || null); setSessionReady(true) }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (live) setUser(session?.user || null)
    })
    return () => { live = false; subscription.unsubscribe() }
  }, [])
  return <NextNavigation>
    <MarketplaceConsole user={user} sessionReady={sessionReady} detail={kind !== 'catalog'}>
    {kind === 'catalog' && <MarketplacePage user={user} initialListings={listings} />}
    {kind === 'app' && <MarketplaceAppPage initialListing={listing} />}
    {kind === 'developer' && <DeveloperProfilePage initialProfile={developer.profile} initialListings={developer.listings} />}
    </MarketplaceConsole>
  </NextNavigation>
}
