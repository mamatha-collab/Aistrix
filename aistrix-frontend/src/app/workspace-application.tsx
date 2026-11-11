'use client'

import type { ChildrenProps } from '../types/domain'


import BrowserApplication from '../BrowserApplication'
import NextNavigation from './next-navigation'

export default function WorkspaceApplication({ children }: ChildrenProps) {
  return <BrowserApplication RouterComponent={NextNavigation}>{children}</BrowserApplication>
}
