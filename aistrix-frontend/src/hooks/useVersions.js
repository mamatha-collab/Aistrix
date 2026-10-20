// Published versions of an app (app_versions; any editor of the app can read them).
import { useCallback, useEffect, useState, useRef } from 'react'
import { supabase } from '../supabase'

export function useVersions(appId) {
  const generation = useRef(0)
  const [error, setError] = useState('')
  const [versions, setVersions]     = useState([])
  const [loading, setLoading]       = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  const load = useCallback(async () => {
    const request = ++generation.current
    setVersions([]); setError(''); setNeedsSetup(false)
    if (!appId) { setLoading(false); return }
    setLoading(true)
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .eq('app_id', appId)
      .not('version_num', 'is', null)
      .order('version_num', { ascending: false })
    if (request !== generation.current) return
    setLoading(false)
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) setNeedsSetup(true)
      setError(error.message || 'Versions could not be loaded.')
      return
    }
    setNeedsSetup(false)
    setVersions(data || [])
  }, [appId])

  useEffect(() => { load(); return () => { generation.current += 1 } }, [load])

  return { versions, loading, needsSetup, error, reload: load, setVersions }
}
