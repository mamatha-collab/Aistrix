import { readdirSync, readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const allowed = new Set(JSON.parse(readFileSync(resolve(root, 'config/legacy-javascript.json'), 'utf8')))
function files(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? files(path) : [relative(root, path).replaceAll('\\', '/')]
  })
}
const legacy = new Set(files(resolve(root, 'src')).filter(path => /\.jsx?$/.test(path) && !path.includes('.test.')))
const added = [...legacy].filter(path => !allowed.has(path))
const migrated = [...allowed].filter(path => !legacy.has(path))
if (added.length || migrated.length) {
  if (added.length) console.error(`New application source must use TypeScript:\n${added.join('\n')}`)
  if (migrated.length) console.error(`Remove migrated files from config/legacy-javascript.json:\n${migrated.join('\n')}`)
  process.exitCode = 1
} else {
  console.info(`TypeScript boundary passed; ${legacy.size} inventoried legacy JS modules remain.`)
}
