// Published versions of an app (app_versions; any editor of the app can read them).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'

export function useVersions(appId) {
  const [versions, setVersions]     = useState([])
  const [loading, setLoading]       = useState(false)
  const [needsSetup, setNeedsSetup] = useState(false)

  const load = useCallback(async () => {
    if (!appId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('app_versions')
      .select('*')
      .eq('app_id', appId)
      .not('version_num', 'is', null)
      .order('version_num', { ascending: false })
    setLoading(false)
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) setNeedsSetup(true)
      return
    }
    setNeedsSetup(false)
    setVersions(data || [])
  }, [appId])

  useEffect(() => { load() }, [load])

  return { versions, loading, needsSetup, reload: load, setVersions }
}
