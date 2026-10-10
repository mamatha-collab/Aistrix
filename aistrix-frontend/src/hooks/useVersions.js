// Version history for an app's prompt (app_versions table).
import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../supabase'

export function useVersions(appId, userId) {
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
      .eq('user_id', userId)
      .order('version_num', { ascending: false })
    setLoading(false)
    if (error) {
      if (error.code === '42P01' || error.message?.includes('does not exist')) setNeedsSetup(true)
      return
    }
    setNeedsSetup(false)
    setVersions(data || [])
  }, [appId, userId])

  useEffect(() => { load() }, [load])

  return { versions, loading, needsSetup, reload: load, setVersions }
}

// Called by PromptStudio on save (silent — no semver/changelog here)
export async function saveVersionSnapshot(app, userId, prompt) {
  try {
    const { count } = await supabase
      .from('app_versions')
      .select('id', { count: 'exact', head: true })
      .eq('app_id', app.id)
      .eq('user_id', userId)
    await supabase.from('app_versions').insert({
      app_id: app.id,
      user_id: userId,
      version_num: (count ?? 0) + 1,
      system_prompt: prompt,
      ai_model: app.ai_model,
      ai_provider: app.ai_provider,
    })
  } catch { /* silently fail if table doesn't exist yet */ }
}

