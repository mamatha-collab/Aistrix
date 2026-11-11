'use client'

import type { User } from '@supabase/supabase-js'
import type { PublicListing, PublicProfile } from '../../lib/publicCatalog'
import { useEffect, useState } from 'react'
import NextNavigation from '../next-navigation'
import { MarketplacePage, MarketplaceAppPage } from '../../screens/MarketplacePage'
import DeveloperProfilePage from '../../screens/DeveloperProfilePage'
import { supabase, browserSessionReady } from '../../supabase'
import MarketplaceConsole from '../../components/MarketplaceConsole'

type CatalogProps = { kind: 'catalog'; listings: PublicListing[] } | { kind: 'app'; listing: PublicListing } | { kind: 'developer'; developer: { profile: PublicProfile; listings: PublicListing[] } }

// Native pages own URLs, server data, metadata and 404 responses.
export default function CatalogView(props: CatalogProps) {
  const [user, setUser] = useState<User | null>(null)
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
    <MarketplaceConsole user={user} sessionReady={sessionReady} detail={props.kind !== 'catalog'}>
    {props.kind === 'catalog' && <MarketplacePage user={user} initialListings={props.listings} />}
    {props.kind === 'app' && <MarketplaceAppPage initialListing={props.listing} />}
    {props.kind === 'developer' && <DeveloperProfilePage initialProfile={props.developer.profile} initialListings={props.developer.listings} />}
    </MarketplaceConsole>
  </NextNavigation>
}
