import { useCallback, useMemo, useState } from 'react'
import { NavigationContext } from '../../src/navigation'

// In-memory stand-in for the app's Next navigation, for isolated UI fixtures.
const PARAM_ROUTES = [
  [/^\/dev\/([^/]+)/, 'userId'],
  [/^\/invite\/([^/]+)/, 'token'],
  [/^\/(?:app|embed|marketplace)\/([^/]+)/, 'id'],
]

function parse(href) {
  const url = new URL(href, 'http://fixture.invalid')
  return { pathname: url.pathname, search: url.search, hash: url.hash }
}

export default function MemoryNavigation({ initialPath = '/', children }) {
  const [history, setHistory] = useState({ entries: [parse(initialPath)], index: 0 })
  const location = history.entries[history.index]
  const navigate = useCallback((to, options = {}) => setHistory(current => {
    if (typeof to === 'number') {
      return { ...current, index: Math.min(Math.max(current.index + to, 0), current.entries.length - 1) }
    }
    const from = current.entries[current.index].pathname
    const next = parse(typeof to === 'string' ? to : `${to.pathname || from}${to.search || ''}${to.hash || ''}`)
    const kept = current.entries.slice(0, current.index + (options.replace ? 0 : 1))
    return { entries: [...kept, next], index: kept.length }
  }), [])
  const params = useMemo(() => {
    for (const [pattern, key] of PARAM_ROUTES) {
      const match = location.pathname.match(pattern)
      if (match) return { [key]: decodeURIComponent(match[1]) }
    }
    return {}
  }, [location.pathname])
  const value = useMemo(() => ({ location, navigate, params }), [location, navigate, params])
  return <NavigationContext.Provider value={value}>
    {typeof children === 'function' ? children(location) : children}
  </NavigationContext.Provider>
}
