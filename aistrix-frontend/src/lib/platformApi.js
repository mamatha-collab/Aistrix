import { manageRequest } from './manageApi'

const root = '/v1/platform'
export const resourcePath = key => `${root}/resources/${key.split('/').map(encodeURIComponent).join('/')}`
export const listPlatformResources = () => manageRequest(`${root}/resources`)
export const getPlatformResource = key => manageRequest(resourcePath(key))
export const listPlatformRuns = key => manageRequest(`${root}/runs?resource=${encodeURIComponent(key)}&limit=50`)
export const getPlatformRun = id => manageRequest(`${root}/runs/${encodeURIComponent(id)}`)
export const getPlatformEvents = id => manageRequest(`${root}/runs/${encodeURIComponent(id)}/events`)
export const getPlatformEvals = id => manageRequest(`${root}/releases/${encodeURIComponent(id)}/evals`)
export const getPlatformRelease = id => manageRequest(`${root}/releases/${encodeURIComponent(id)}`)
export const validatePlatformSpec = spec => manageRequest(`${root}/specs/validate`, { method: 'POST', body: JSON.stringify({ spec }) })
export const releasePlatformSpec = spec => manageRequest(`${root}/releases`, { method: 'POST', body: JSON.stringify({ spec }) })
export const runPlatformEval = suite => manageRequest(`${root}/evals`, { method: 'POST', body: JSON.stringify({ suite }) })
