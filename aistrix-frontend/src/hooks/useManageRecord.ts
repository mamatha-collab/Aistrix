import { useEffect, useState } from 'react'
import { manageRequest } from '../lib/manageApi'

interface ManageRecordState<T> { data: T | null; error: string; loading: boolean; refresh: () => void }
export function useManageRecord(path: string | null, userId: string | undefined): ManageRecordState<Record<string, unknown>>
export function useManageRecord<T>(path: string | null, userId: string | undefined, decode: (value: Record<string, unknown>) => T): ManageRecordState<T>
export function useManageRecord<T>(path: string | null, userId: string | undefined, decode?: (value: Record<string, unknown>) => T): ManageRecordState<T | Record<string, unknown>> {
  const [data, setData] = useState<T | Record<string, unknown> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    if (!path) { setLoading(false); return }
    setLoading(true)
    manageRequest(path, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(decode ? decode(result) : result) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [path, userId, revision, decode])
  return { data, error, loading, refresh: () => setRevision(n => n + 1) }
}

