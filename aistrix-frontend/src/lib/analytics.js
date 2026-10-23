/**
 * Analytics — thin PostHog wrapper.
 *
 * Initialises PostHog once from VITE_POSTHOG_KEY / VITE_POSTHOG_HOST.
 * All exports are no-ops when the key is absent, so callers never need
 * to guard every call site.
 *
 * Usage:
 *   import { track, identify, resetIdentity } from '../lib/analytics'
 *   track('app_run_completed', { app_id, app_name, provider })
 */

const KEY  = import.meta.env.VITE_POSTHOG_KEY
const HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://app.posthog.com'

// Analytics cookies need the visitor's consent first (CookieConsent): nothing
// is loaded or sent until they accept, and declining (or withdrawing) stops it.
const CONSENT_KEY = 'aistrix_cookie_consent'          // 'accepted' | 'declined'
export const analyticsConfigured = !!KEY

export function consentChoice() {
  try { return localStorage.getItem(CONSENT_KEY) } catch { return null }
}

export function setConsent(choice) {
  try { localStorage.setItem(CONSENT_KEY, choice) } catch { /* private mode: ask again next time */ }
  if (choice === 'accepted') getPostHog()
  else if (ph) { ph.opt_out_capturing(); ph.reset() }
  window.dispatchEvent(new Event('aistrix:consent'))
}

// Lets the Privacy Policy reopen the choice.
export function reopenConsent() {
  try { localStorage.removeItem(CONSENT_KEY) } catch { /* ignore */ }
  window.dispatchEvent(new Event('aistrix:consent'))
}

let ph = null

function getPostHog() {
  if (ph) return ph
  if (!KEY || consentChoice() !== 'accepted') return null
  // Dynamic import keeps posthog-js out of the critical path when unconfigured
  import('posthog-js').then(({ default: posthog }) => {
    posthog.init(KEY, {
      api_host: HOST,
      autocapture: false,        // manual events only — avoids PII leakage
      capture_pageview: true,
      persistence: 'localStorage+cookie',
      loaded: p => { ph = p },
    })
    posthog.opt_in_capturing()
    ph = posthog
  }).catch(() => {})
  return null
}

// Start right away only if the visitor already accepted.
getPostHog()

/**
 * Track a named event with optional properties.
 * Safe to call before PostHog finishes initialising — PostHog queues events.
 */
export function track(event, props = {}) {
  if (!KEY) return
  const p = getPostHog()
  if (p) p.capture(event, props)
}

/**
 * Associate the current session with a user identity.
 * Call after sign-in.
 */
export function identify(userId, traits = {}) {
  if (!KEY) return
  const p = getPostHog()
  if (p) p.identify(userId, traits)
}

/**
 * Reset identity on sign-out.
 */
export function resetIdentity() {
  if (!KEY) return
  const p = getPostHog()
  if (p) p.reset()
}

// ─── Event name constants ─────────────────────────────────────────────────────
export const EVENTS = {
  // App runner
  APP_RUN_STARTED:        'app_run_started',
  APP_RUN_COMPLETED:      'app_run_completed',
  APP_RUN_FAILED:         'app_run_failed',
  APP_RATED:              'app_rated',

  // Payment funnel
  PAYMENT_MODAL_OPENED:   'payment_modal_opened',
  CHECKOUT_STARTED:       'checkout_started',
  CHECKOUT_COMPLETED:     'checkout_completed',
  CHECKOUT_CANCELLED:     'checkout_cancelled',

  // Marketplace
  MARKETPLACE_VIEWED:     'marketplace_viewed',
  MARKETPLACE_APP_VIEWED: 'marketplace_app_viewed',
  MARKETPLACE_APP_CLICKED:'marketplace_app_clicked',

  // Developer
  DEV_PROFILE_VIEWED:     'dev_profile_viewed',
  LISTING_SUBMITTED:      'listing_submitted',

  // Dev Studio
  VERSION_SAVED:          'version_saved',
  TEST_SUITE_RUN:         'test_suite_run',

  // Build flow (Design → Test → Deploy): where developers get stuck.
  // Properties are ids, counts and versions only — never prompts or inputs.
  BUILD_APP_CREATED:      'build_app_created',
  BUILD_DESIGN_SAVED:     'build_design_saved',
  BUILD_PHASE_MOVED:      'build_phase_moved',
  BUILD_TESTS_RUN:        'build_tests_run',
  BUILD_PUBLISH_BLOCKED:  'build_publish_blocked',
  BUILD_PUBLISHED:        'build_published',
  BUILD_PROMOTED:         'build_promoted',
  BUILD_ROLLED_BACK:      'build_rolled_back',
}
