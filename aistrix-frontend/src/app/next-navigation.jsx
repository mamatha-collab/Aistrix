'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation'
import NextLink from 'next/link'
import { NavigationContext, navigationHref } from '../navigation'

// Next owns navigation, dynamic parameters and links throughout the application.
export default function NextNavigation({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const query = useSearchParams()
  const params = useParams()
  const [hash, setHash] = useState('')
  useEffect(() => {
    const update = () => setHash(window.location.hash)
    update()
    window.addEventListener('hashchange', update)
    window.addEventListener('popstate', update)
    return () => {
      window.removeEventListener('hashchange', update)
      window.removeEventListener('popstate', update)
    }
  }, [pathname, query])
  const navigate = useCallback((to, options = {}) => {
    if (typeof to === 'number') { window.history.go(to); return }
    const href = navigationHref(to)
    const settings = { scroll: !options.preventScrollReset }
    if (options.replace) router.replace(href, settings)
    else router.push(href, settings)
  }, [router])
  const value = useMemo(() => ({
    location: { pathname, search: query.size ? `?${query}` : '', hash },
    params, navigate, LinkComponent: NextLink,
  }), [pathname, query, hash, params, navigate])
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>
}
