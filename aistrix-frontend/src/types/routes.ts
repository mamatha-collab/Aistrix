export type SearchQuery = Record<string, string | string[] | undefined>
export type RoutePageProps = { params: Promise<Record<string, string>>; searchParams: Promise<SearchQuery> }
