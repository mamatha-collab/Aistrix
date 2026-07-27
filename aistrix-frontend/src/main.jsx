import { StrictMode } from 'react'
import * as Sentry from '@sentry/react'

// Sentry — only initialises if DSN is provided
if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_ENVIRONMENT || 'production',
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
    // Only skip if explicitly set to 'skip' — allows testing in dev
    beforeSend: (event) => import.meta.env.VITE_SENTRY_DISABLE === 'true' ? null : event,
  })
}
import { initTheme } from './utils/theme.js'
initTheme()
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import { ToastProvider } from './components/Toast.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <ToastProvider>
          <App />
        </ToastProvider>
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)