import type { RoutePageProps } from '../../../../types/routes'
import { notFound } from 'next/navigation'
import { getPublicDeveloper } from '../../../../server/catalog'
import CatalogView from '../../catalog-view'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: Pick<RoutePageProps, 'params'>) {
  const { userId } = await params
  const developer = await getPublicDeveloper(userId)
  return developer ? { title: `${developer.profile.display_name || 'Developer'} | Aistrix`, description: developer.profile.bio || 'Published Aistrix apps.',
    alternates: { canonical: `/dev/${userId}` } } : { title: 'Developer not found | Aistrix', robots: { index: false } }
}

export default async function Developer({ params }: Pick<RoutePageProps, 'params'>) {
  const developer = await getPublicDeveloper((await params).userId)
  if (!developer) notFound()
  return <CatalogView kind="developer" developer={developer} />
}
