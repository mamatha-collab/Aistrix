import type { RefObject } from 'react'

export type NavigationGuard = (action: () => void) => boolean
export type NavigationGuardRef = RefObject<NavigationGuard | null>
export interface BuilderNavigationOptions {
  enabled: boolean
  navigationGuardRef?: NavigationGuardRef
  hasChanges: boolean
  busy?: boolean
  onLeave?: () => void
}
