import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const reportPath = resolve('.test-tmp/hosted-acceptance.json')
const required = ['E2E_BASE_URL', 'E2E_API_URL', 'E2E_EMAIL', 'E2E_PASSWORD']
const missing = required.filter(key => !process.env[key])
const pending = ['Real Stripe test-mode checkout/refund/payout reconciliation', 'Email delivery and links', 'Restore exercise', 'Hosted capacity and tenant isolation']
function report(status, reason) {
  mkdirSync(resolve('.test-tmp'), { recursive: true })
  writeFileSync(reportPath, JSON.stringify({ status, reason, at: new Date().toISOString(), pending }, null, 2))
}
if (missing.length || process.env.E2E_ENVIRONMENT !== 'staging') {
  const reason = `Hosted checks not run. Configure ${[...missing, ...(process.env.E2E_ENVIRONMENT !== 'staging' ? ['E2E_ENVIRONMENT=staging'] : [])].join(', ')} using a dedicated test account.`
  report('not_run', reason)
  console.error(reason)
  process.exit(2)
}
for (const key of ['E2E_BASE_URL', 'E2E_API_URL']) {
  let target
  try { target = new URL(process.env[key]) } catch { /* invalid */ }
  if (!target || target.protocol !== 'https:' || target.username || target.password || target.search || target.hash) {
    report('not_run', `${key} must be an HTTPS URL without credentials, a query, or a fragment.`)
    console.error(`${key} is not a valid staging target.`)
    process.exit(2)
  }
}
const run = spawnSync(process.execPath, ['node_modules/@playwright/test/cli.js', 'test', '--config', 'playwright.config.js'], { stdio: 'inherit', env: process.env })
report(run.status === 0 ? 'browser_checks_passed' : 'failed', run.status === 0 ? 'Read-only browser and API checks passed. External launch exercises remain pending.' : 'Hosted browser/API checks failed; inspect the test output.')
process.exit(Number.isInteger(run.status) ? run.status : 1)
