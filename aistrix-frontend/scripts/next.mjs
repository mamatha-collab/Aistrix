// Explicit staging/production selection mirrors the current Vite commands.
// Existing .env files remain untouched; only allowlisted public aliases migrate.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { loadEnv } from 'vite'
import { publicEnvironment } from '../config/public-env.mjs'

const [command = 'dev', mode = 'staging', ...args] = process.argv.slice(2)
if (!['dev', 'build'].includes(command) || !['staging', 'production'].includes(mode)) {
  throw new Error('Usage: node scripts/next.mjs <dev|build> <staging|production> [Next.js arguments]')
}
const values = publicEnvironment({ ...loadEnv(mode, process.cwd(), ''), ...process.env }, { development: command === 'dev' })
if (values.NEXT_PUBLIC_API_URL) {
  console.info(`Next.js ${mode}: API origin ${new URL(values.NEXT_PUBLIC_API_URL).origin}`)
}
const child = spawn(process.execPath, [
  fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url)), command, ...args,
], { stdio: 'inherit', env: { ...process.env, ...values, NEXT_TELEMETRY_DISABLED: '1' } })
child.on('error', error => { console.error(error.message); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
