import { lazy } from 'react'
import { isAdmin, isModerator } from '../utils/roles'

const Overview = lazy(() => import('../screens/OverviewPage'))
const Profiles = lazy(() => import('../screens/ProfilesPage'))
const History = lazy(() => import('./RunHistory'))
const Goals = lazy(() => import('../screens/GoalsPage'))
const Events = lazy(() => import('../screens/EventsPage'))
const Analytics = lazy(() => import('../screens/AnalyticsPage'))
const Reports = lazy(() => import('../screens/ReportsPage'))
const Settings = lazy(() => import('../screens/SettingsPage'))
const Alerts = lazy(() => import('../screens/AlertsPage'))
const Developer = lazy(() => import('../screens/DevStudioPage'))
const DataSources = lazy(() => import('../screens/DataSourcesPage'))
const Integrations = lazy(() => import('../screens/IntegrationsPage'))
const Admin = lazy(() => import('../screens/AdminPage'))
const Moderator = lazy(() => import('../screens/ModeratorPage'))
const Knowledge = lazy(() => import('../screens/KnowledgeVaultPage'))
const Gallery = lazy(() => import('../screens/Gallery'))
const App = lazy(() => import('../screens/AppPage'))
const Docs = lazy(() => import('../screens/AppDocsPage'))
const Embed = lazy(() => import('../screens/AppEmbedPage'))
const Invite = lazy(() => import('../screens/InvitePage'))
const Marketplace = lazy(() => import('../screens/MarketplacePage').then(m => ({ default: m.MarketplacePage })))
const Listing = lazy(() => import('../screens/MarketplacePage').then(m => ({ default: m.MarketplaceAppPage })))
const DeveloperProfile = lazy(() => import('../screens/DeveloperProfilePage'))

// Next pages and the rollback renderer share screen components, not routers.
export default function WorkspaceScreens({ screen, user, userRole, changeView, onSelectApp, onRunEvent, developerProps, pathname }) {
  switch (screen) {
    case 'overview': return <Overview user={user} onSelectApp={onSelectApp} />
    case 'profiles': return <Profiles user={user} />
    case 'history': return <History user={user} inline onClose={() => changeView('flows')} />
    case 'goals': return <Goals user={user} />
    case 'events': return <Events user={user} onRunEvent={onRunEvent} />
    case 'analytics': return <Analytics user={user} />
    case 'reports': return <Reports user={user} />
    case 'settings': return <Settings user={user} />
    case 'alerts': return <Alerts user={user} />
    case 'developer': return <Developer user={user} {...developerProps} />
    case 'data_sources': return <DataSources user={user} />
    case 'integrations': return <Integrations user={user} />
    case 'admin': return isAdmin(userRole) ? <Admin user={user} /> : <p role="alert" className="p-6 text-slate-400">Administrator access required.</p>
    case 'moderator': return isModerator(userRole) ? <Moderator user={user} userRole={userRole} /> : <p role="alert" className="p-6 text-slate-400">Moderator access required.</p>
    case 'knowledge_vault': return <Knowledge user={user} />
    case 'app': return <App />
    case 'docs': return <Docs />
    case 'embed': return <Embed />
    case 'gallery': return <Gallery />
    case 'invite': return <Invite user={user} />
    case 'developer_profile': return <DeveloperProfile />
    case 'marketplace': return pathname?.startsWith('/marketplace/') ? <Listing appId={pathname.split('/')[2]} /> : <Marketplace user={user} />
    // These layers live in the layout so running work survives switching tabs.
    case 'apps': case 'flows': return null
    default: return null
  }
}
