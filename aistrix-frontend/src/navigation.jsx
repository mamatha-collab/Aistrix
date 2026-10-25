import { createContext, useCallback, useContext, useMemo } from 'react'

export const NavigationContext = createContext(null)

function useNavigation() {
  const value = useContext(NavigationContext)
  if (!value) throw new Error('Navigation requires an application navigation provider.')
  return value
}

export const useNavigate = () => useNavigation().navigate
export const useLocation = () => useNavigation().location
export const useParams = () => useNavigation().params

export function useSearchParams() {
  const { location, navigate } = useNavigation()
  const search = useMemo(() => new URLSearchParams(location.search), [location.search])
  const setSearch = useCallback((next, options) => {
    const values = new URLSearchParams(typeof next === 'function' ? next(new URLSearchParams(search)) : next)
    navigate(`${location.pathname}${values.size ? `?${values}` : ''}`, options)
  }, [search, location.pathname, navigate])
  return [search, setSearch]
}

export function navigationHref(to) {
  if (typeof to === 'string') return to
  return `${to.pathname || ''}${to.search || ''}${to.hash || ''}`
}

export function Link({ to, onClick, children, ...props }) {
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
