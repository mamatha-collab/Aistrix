import { getPublicCatalog } from '../../../server/catalog'
import CatalogView from '../catalog-view'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Marketplace | Aistrix', alternates: { canonical: '/marketplace' } }

export default async function Marketplace() {
  const listings = await getPublicCatalog()
  return <><h1 className="sr-only">Aistrix marketplace</h1><CatalogView kind="catalog" listings={listings} /></>
}
