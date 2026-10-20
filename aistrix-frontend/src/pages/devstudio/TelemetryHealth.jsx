export default function TelemetryHealth({ health }) {
  if (!health || (health.status === 'ok' && health.recovery_path_configured !== false)) return null
  return <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200 space-y-1">
    {health.status === 'unavailable' ? <p>Run tracking recovery storage is unavailable. Activity and quality figures may be incomplete; contact your server operator.</p>
      : health.status === 'delayed' ? <p>{health.pending} run outcome{health.pending === 1 ? '' : 's'} awaiting delivery from this server. Figures may be incomplete while Aistrix retries automatically.</p> : null}
    {health.recovery_path_configured === false && <p>Production setup: configure telemetry recovery on persistent server storage so queued outcomes survive server replacement.</p>}
  </div>
}
