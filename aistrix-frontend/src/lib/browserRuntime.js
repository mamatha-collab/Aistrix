import * as Sentry from '@sentry/react'
import { initTheme } from '../utils/theme.js'
import { installApiWorkspaceHeader } from './workspace.js'

let initialized = false

export function initializeBrowser() {
  if (initialized || typeof window === 'undefined') return
  initialized = true
  if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
    Sentry.init({
      dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
      environment: process.env.NEXT_PUBLIC_ENVIRONMENT || 'production',
      integrations: [Sentry.browserTracingIntegration()],
      tracesSampleRate: 0.1,
      beforeSend: event => process.env.NEXT_PUBLIC_SENTRY_DISABLE === 'true' ? null : event,
    })
  }
  initTheme()
  installApiWorkspaceHeader()
}
