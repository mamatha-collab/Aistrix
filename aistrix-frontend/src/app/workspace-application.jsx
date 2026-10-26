'use client'

import BrowserApplication from '../BrowserApplication'
import NextNavigation from './next-navigation'

export default function WorkspaceApplication({ children }) {
  return <BrowserApplication RouterComponent={NextNavigation}>{children}</BrowserApplication>
}
