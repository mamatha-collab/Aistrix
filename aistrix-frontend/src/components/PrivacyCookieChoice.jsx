'use client'

import { analyticsConfigured, reopenConsent } from '../lib/analytics'

export default function PrivacyCookieChoice() {
  return analyticsConfigured ? <> <button onClick={reopenConsent} className="text-[#A29BFE] underline">Change your cookie choice</button></> : null
}
