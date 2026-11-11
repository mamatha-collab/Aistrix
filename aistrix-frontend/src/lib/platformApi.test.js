import { describe, expect, it, vi } from 'vitest'
vi.mock('./manageApi', () => ({ manageRequest: vi.fn() }))
import { manageRequest } from './manageApi'
import { getPlatformEvents, getPlatformResource, getPlatformRun, listPlatformRuns } from './platformApi'

describe('platform inspection requests', () => {
  it('encodes resource identity in detail and run filtering requests', () => {
    getPlatformResource('Application/team/invoice')
    expect(manageRequest).toHaveBeenLastCalledWith('/v1/platform/resources/Application/team/invoice')
    listPlatformRuns('Application/team/invoice')
    expect(manageRequest).toHaveBeenLastCalledWith('/v1/platform/runs?resource=Application%2Fteam%2Finvoice&limit=50')
  })
  it('uses the same pinned run identity for state and event inspection', () => {
    getPlatformRun('run/id')
    expect(manageRequest).toHaveBeenLastCalledWith('/v1/platform/runs/run%2Fid')
    getPlatformEvents('run/id')
    expect(manageRequest).toHaveBeenLastCalledWith('/v1/platform/runs/run%2Fid/events')
  })
})
