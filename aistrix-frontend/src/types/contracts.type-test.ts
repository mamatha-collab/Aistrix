// Compile-only regressions. These declarations are not imported by the app.
import type { Navigate } from '../navigation'
import type { PythonManifest } from './domain'
import { manageRequest } from '../lib/manageApi'

declare const navigate: Navigate
declare const manifest: PythonManifest

function checkNavigationContract() {
  navigate('/developer', { replace: true })
  // @ts-expect-error Navigation options are booleans, not serialized strings.
  navigate('/developer', { replace: 'true' })
  // @ts-expect-error Navigation targets must be internal location objects or strings.
  navigate({ hostname: 'example.invalid' })
}

async function checkRequestContract() {
  const response = await manageRequest('/v1/platform/runs')
  // @ts-expect-error Network fields remain unknown until validated by a decoder.
  const runs: string[] = response.runs
  return runs
}

function checkRuntimeContract() {
  // @ts-expect-error Sandboxed Python manifests cannot opt into network access.
  const unrestricted: PythonManifest = { ...manifest, network: 'all' }
  return unrestricted
}

export type ContractChecks = [typeof checkNavigationContract, typeof checkRequestContract, typeof checkRuntimeContract]
