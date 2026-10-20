import { useEffect, useRef, useState } from 'react'
import { getAppMonitor, getMonitorOverview } from '../lib/monitor'

export function useMonitor(appIds, scope, days) {
  const [state, setState] = useState({ key: '', data: null, loading: true, error: '', updatedAt: null })
  const refreshRef = useRef(() => {})
  const key = `${appIds}:${scope}:${days}`
  useEffect(() => {
    let active = true, controller = null, busy = false
    const read = async () => {
      if (!active || busy) return
      busy = true
      controller = new AbortController()
      setState(s => ({ ...(s.key === key ? s : { key, data: null, updatedAt: null }), loading: true, error: '' }))
      try {
        const data = scope === 'all' ? await getMonitorOverview(appIds.split(',').filter(Boolean), days, controller.signal) : await getAppMonitor(scope, days, controller.signal)
        if (active) setState({ key, data, loading: false, error: '', updatedAt: Date.now() })
      } catch (e) {
        if (active && e.name !== 'AbortError') setState(s => ({ ...s, loading: false, error: e.message || 'Monitoring is unavailable.' }))
      } finally { busy = false }
    }
    refreshRef.current = read
    if (appIds) read()
    else setState({ key, data: null, loading: false, error: '', updatedAt: null })
    const visible = () => { if (appIds && document.visibilityState === 'visible') read() }
    const timer = setInterval(visible, 60000)
    document.addEventListener('visibilitychange', visible)
    return () => { active = false; controller?.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [appIds, scope, days, key])
  return { ...(state.key === key ? state : { data: null, loading: true, error: '', updatedAt: null }), refresh: () => refreshRef.current() }
}
