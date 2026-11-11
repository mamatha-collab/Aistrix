import type { JsonObject } from '../types/domain'
import { manageRequest } from './manageApi'

const root = '/v1/platform'
export const resourcePath = (key: string) => `${root}/resources/${key.split('/').map(encodeURIComponent).join('/')}`
export const listPlatformResources = () => manageRequest(`${root}/resources`)
export const getPlatformResource = (key: string) => manageRequest(resourcePath(key))
export const listPlatformRuns = (key: string) => manageRequest(`${root}/runs?resource=${encodeURIComponent(key)}&limit=50`)
export const getPlatformRun = (id: string) => manageRequest(`${root}/runs/${encodeURIComponent(id)}`)
export const getPlatformEvents = (id: string) => manageRequest(`${root}/runs/${encodeURIComponent(id)}/events`)
export const getPlatformEvals = (id: string) => manageRequest(`${root}/releases/${encodeURIComponent(id)}/evals`)
export const getPlatformRelease = (id: string) => manageRequest(`${root}/releases/${encodeURIComponent(id)}`)
export const validatePlatformSpec = (spec: JsonObject) => manageRequest(`${root}/specs/validate`, { method: 'POST', body: JSON.stringify({ spec }) })
export const releasePlatformSpec = (spec: JsonObject) => manageRequest(`${root}/releases`, { method: 'POST', body: JSON.stringify({ spec }) })
export const runPlatformEval = (suite: string) => manageRequest(`${root}/evals`, { method: 'POST', body: JSON.stringify({ suite }) })
