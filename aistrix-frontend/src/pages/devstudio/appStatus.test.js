import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../supabase', () => ({ supabase: { auth: {} } }))
const { appStatus, AppNavigator } = await import('./shared.jsx')

describe('one status per app in the app list', () => {
  it('names each state plainly', () => {
    expect(appStatus({ is_published: true, live_version: 3 }).label).toBe('Live v3')
    expect(appStatus({ is_published: true, live_version: 3, has_draft_changes: true })).toMatchObject({ label: 'Live v3', edits: true })
    expect(appStatus({ is_published: false, status: 'pending' }).label).toBe('In review')
    expect(appStatus({ is_published: false, live_version: 2 }).label).toBe('Offline')
    expect(appStatus({ is_published: false }).label).toBe('Not live')
  })

  it('a published app with edits stays Live (it was shown as DRAFT before)', () => {
    const html = renderToStaticMarkup(createElement(AppNavigator, {
      apps: [
        { id: 'a', name: 'Edited', is_published: true, live_version: 2, has_draft_changes: true },
        { id: 'b', name: 'Listed', is_published: true, live_version: 1 },
        { id: 'c', name: 'Ready', is_published: false },
        { id: 'd', name: 'Idea', is_published: false },
      ],
      phaseByAppId: { c: 'deploy' }, listedIds: new Set(['b']),
      onSelectApp() {}, onSwitchTab() {}, onMovePhase() {}, compact: true,
    }))
    expect(html).not.toContain('>DRAFT<')
    expect(html).toContain("Live v2: users run this release. You have edits that aren&#x27;t released yet.")
    expect(html).toContain('Live v1: users run this release. Listed on the Marketplace.')
    expect(html).toContain('Not published yet') // Ready, in the Publishing group
    expect(html.match(/aria-label="Not published yet/g)).toHaveLength(1) // Idea (still designing) has no badge
    expect(html).toContain('Publishing')
    expect(html).not.toContain('App pipeline')            // removed: it repeated the list and tabs
    expect(html).toContain('title="Edited · AI app"')     // the app type moved to the hover text
  })
})
