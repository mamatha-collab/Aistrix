'use client'

import { useEffect } from 'react'
import CookieConsent from '../../components/CookieConsent'
import { initializeBrowser } from '../../lib/browserRuntime'

export default function PublicRuntime() {
  useEffect(() => { initializeBrowser() }, [])
  return <CookieConsent />
}
