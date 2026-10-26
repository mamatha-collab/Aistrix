import { PROVIDER_STYLE } from '../lib/providers'

import { BRAND } from '../lib/brand'
// Explains an app's "Who pays for runs" setting for its provider.
export default function BillingModeHint({ mode, provider, freeRuns, className = '' }) {
  const name = PROVIDER_STYLE[provider?.id]?.name || provider?.label || 'AI'
  const perDay = freeRuns === '' || freeRuns == null ? 20 : Number(freeRuns)
  const text = mode === 'byok'
    ? `Users add their own ${name} key in Settings → Keys before running this app. Website visitors need to sign in.`
    : provider?.connected
      ? `Users run this app free on your ${name} key (····${provider.last4 || ''}), up to ${perDay} run${perDay === 1 ? '' : 's'} each per day.`
      : `Add your ${name} key in Settings → Keys to pay for users' runs. Until then, users run it on their own key or the ${BRAND} free allowance.`
  return <p className={`text-[10px] text-slate-500 leading-relaxed ${className}`}>{text}</p>
}
