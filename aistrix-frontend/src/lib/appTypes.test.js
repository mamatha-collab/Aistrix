import { describe, expect, it } from 'vitest'
import { APP_TYPES, getAppTypeMeta } from './appTypes'
import { FILE_APP_TYPES } from './fileApps'
import { BUSINESS_NAV, ENTITIES, entityForView } from './entities'
describe('shared object definitions', () => {
  it('provides unique app identities with consistent metadata and legacy aliases', () => {
    expect(new Set(APP_TYPES.map(t => t.id)).size).toBe(APP_TYPES.length)
    for (const type of APP_TYPES) {
      expect(getAppTypeMeta(type.id)).toMatchObject({ label: type.label, icon: type.icon, color: type.color })
    }
    expect(getAppTypeMeta('chat')).toBe(getAppTypeMeta('chatbot'))
    expect(getAppTypeMeta('document')).toBe(getAppTypeMeta('data'))
    expect(FILE_APP_TYPES).toEqual(['data', 'vision', 'voice'])
    expect(getAppTypeMeta('unknown').label).toBe('AI app')
  })
  it('maps both workflow routes and navigation surfaces to the same identity and icon', () => {
    expect(entityForView('flows')).toBe(ENTITIES.workflows)
    for (const group of BUSINESS_NAV) for (const item of group.items) {
      expect(item.icon).toBe(entityForView(item.view).Icon)
      expect(item.label).toBe(entityForView(item.view).label)
    }
    expect(ENTITIES.workflows.table).toBe('flows')
    expect(ENTITIES.apps.table).toBe('apps')
  })
})
