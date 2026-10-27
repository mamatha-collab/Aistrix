import { isApiCall, isApproval, schemaKey, versionLabel } from './workflowModel'

export default function WorkflowPrivacy({ flow, schemas, onChange, disabled }) {
  const privateOnly = flow.privacy === 'private_only'
  return <section aria-label="Workflow privacy" className="space-y-3 rounded-xl border border-white/10 bg-[#111827] p-4">
    <label className="block text-xs font-semibold text-slate-200">Execution privacy
      <select aria-label="Execution privacy" value={flow.privacy || 'standard'} disabled={disabled} onChange={event => onChange({ ...flow, privacy: event.target.value })}
        className="ml-3 max-w-full rounded-lg border border-white/10 bg-[#0E1424] px-3 py-2 text-xs text-white">
        <option value="standard">Standard</option><option value="private_only">Private only</option>
      </select>
    </label>
    <p className="text-xs leading-relaxed text-slate-400">{privateOnly
      ? 'Only operator-approved private models and tools without external access are permitted. External APIs, AI input filling, and result webhooks are blocked. There is no fallback to a public AI provider. Approval steps are allowed.'
      : 'Steps may use external AI providers, APIs, tools and result webhooks configured in their releases. Choose Private only to restrict outbound execution.'}</p>
    <details className="text-xs text-slate-300">
      <summary className="cursor-pointer">Model and tool access by step</summary>
      <ul className="mt-2 space-y-2">
        {(flow.steps || []).map((step, index) => {
          const contract = schemas[schemaKey(step)]?.contract
          const privacy = contract?.privacy
          return <li key={step.id || index} className="rounded-lg border border-white/5 p-2">
            <p className="font-semibold">Step {index + 2}: {step.app_name || (isApproval(step) ? 'Approval' : isApiCall(step) ? 'API call' : 'App')}</p>
            {isApproval(step) ? <p>Human approval; permitted in private workflows.</p>
              : isApiCall(step) ? <p>External API call; blocked in private workflows.</p>
                : !contract ? <p>Model and tool access not verified. Validate the workflow before running.</p>
                  : <>
                    <p>{versionLabel(step)} · {privacy?.model_route === 'private' ? 'Approved private model' : 'External AI model'} · {contract.side_effects === 'none' ? 'No external tool access' : contract.side_effects === 'external_read' ? 'Tools can read external services' : 'Tools may change external services'}</p>
                    {!!privacy?.external_destinations?.length && <p className="break-words">Destinations: {privacy.external_destinations.join(', ')}</p>}
                    {privacy?.output_webhook && <p>Results sent to a webhook; blocked in private workflows.</p>}
                  </>}
            {step.ai_fill && <p>AI input filling uses an external model; blocked in private workflows.</p>}
          </li>
        })}
      </ul>
      <p className="mt-2 text-slate-400">The server verifies these rules before a run and again before dispatching each step. Save and validate after changing privacy or steps.</p>
    </details>
  </section>
}
