// Used only by the Vite rollback and isolated UI fixtures, never by Next.
import { BrowserRouter, useLocation, useNavigate, useParams } from 'react-router-dom'
import { NavigationContext } from './navigation'

export function LegacyNavigationBridge({ children }) {
  const location = useLocation()
  const navigate = useNavigate()
  const routeParams = useParams()
  const match = location.pathname.match(/^\/(app|embed|marketplace|dev|invite)\/([^/]+)/)
  const key = match?.[1] === 'dev' ? 'userId' : match?.[1] === 'invite' ? 'token' : 'id'
  const params = Object.keys(routeParams).length ? routeParams : match ? { [key]: decodeURIComponent(match[2]) } : {}
  return <NavigationContext.Provider value={{ location, navigate, params }}>{children}</NavigationContext.Provider>
}

export default function LegacyBrowserNavigation({ children }) {
  return <BrowserRouter><LegacyNavigationBridge>{children}</LegacyNavigationBridge></BrowserRouter>
}
