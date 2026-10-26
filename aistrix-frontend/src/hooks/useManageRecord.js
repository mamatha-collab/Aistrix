import { useEffect, useState } from 'react'
import { manageRequest } from '../lib/manageApi'

export function useManageRecord(path, userId) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setData(null)
    setError('')
    if (!path) { setLoading(false); return }
    setLoading(true)
    manageRequest(path, { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setData(result) })
      .catch(e => { if (!controller.signal.aborted) setError(e.message) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [path, userId, revision])
  return { data, error, loading, refresh: () => setRevision(n => n + 1) }
}

