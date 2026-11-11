import type { AnchorHTMLAttributes, ComponentType, ReactNode } from 'react'
import { createContext, useCallback, useContext, useMemo } from 'react'

export type NavigationTarget = string | { pathname?: string; search?: string; hash?: string }
export interface NavigationOptions { replace?: boolean; preventScrollReset?: boolean }
export type Navigate = (to: NavigationTarget | number, options?: NavigationOptions) => void
export interface NavigationValue {
  location: { pathname: string; search: string; hash: string }
  params: Record<string, string | string[] | undefined>
  navigate: Navigate
  LinkComponent?: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }>
}
export const NavigationContext = createContext<NavigationValue | null>(null)

function useNavigation() {
  const value = useContext(NavigationContext)
  if (!value) throw new Error('Navigation requires an application navigation provider.')
  return value
}

export const useNavigate = () => useNavigation().navigate
export const useLocation = () => useNavigation().location
export const useParams = () => useNavigation().params

type URLSearchParamsInit = string | URLSearchParams | string[][] | Record<string, string>

export function useSearchParams() {
  const { location, navigate } = useNavigation()
  const search = useMemo(() => new URLSearchParams(location.search), [location.search])
  const setSearch = useCallback((next: URLSearchParamsInit | ((previous: URLSearchParams) => URLSearchParamsInit), options?: NavigationOptions) => {
    const values = new URLSearchParams(typeof next === 'function' ? next(new URLSearchParams(search)) : next)
    navigate(`${location.pathname}${values.size ? `?${values}` : ''}`, options)
  }, [search, location.pathname, navigate])
  return [search, setSearch] as const
}

export function navigationHref(to: NavigationTarget) {
  if (typeof to === 'string') return to
  return `${to.pathname || ''}${to.search || ''}${to.hash || ''}`
}

export function Link({ to, onClick, children, ...props }: Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'> & { to: NavigationTarget; children?: ReactNode }) {
  const { navigate, LinkComponent } = useNavigation()
  const href = navigationHref(to)
  if (LinkComponent) return <LinkComponent href={href} onClick={onClick} {...props}>{children}</LinkComponent>
  return <a href={href} {...props} onClick={event => {
    onClick?.(event)
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || props.target || props.download) return
    event.preventDefault()
    navigate(href)
  }}>{children}</a>
}
