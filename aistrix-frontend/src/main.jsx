import { createRoot } from 'react-dom/client'
import BrowserApplication from './BrowserApplication.jsx'
import LegacyBrowserNavigation from './legacy-navigation.jsx'
import './index.css'
import { reloadOnceForNewVersion } from './utils/chunkReload.js'

// Retained only for the Vite rollback/test build during the Next.js migration.
window.addEventListener('vite:preloadError', event => {
  if (reloadOnceForNewVersion()) event.preventDefault()
})

createRoot(document.getElementById('root')).render(<BrowserApplication RouterComponent={LegacyBrowserNavigation} />)
