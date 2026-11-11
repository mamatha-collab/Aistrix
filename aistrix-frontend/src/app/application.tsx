'use client'

import type { ChildrenProps } from '../types/domain'


import BrowserApplication from './workspace-application'

export default function Application({ children }: ChildrenProps) {
  return <BrowserApplication>{children}</BrowserApplication>
}
