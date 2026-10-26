import { notFound } from 'next/navigation'
import { getPublicApp } from '../../../../server/catalog'
import CatalogView from '../../catalog-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }) {
  const { id } = await params
  const listing = await getPublicApp(id)
  return listing ? { title: `${listing.title} | Aistrix`, description: listing.tagline || listing.description,
    alternates: { canonical: `/marketplace/${id}` }, openGraph: { title: listing.title, description: listing.tagline || listing.description } }
    : { title: 'App not found | Aistrix', robots: { index: false } }
}

export default async function MarketplaceApp({ params }) {
  const listing = await getPublicApp((await params).id)
  if (!listing) notFound()
  return <CatalogView kind="app" listing={listing} />
}
