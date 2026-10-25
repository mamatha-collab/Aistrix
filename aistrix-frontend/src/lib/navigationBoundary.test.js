import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { WORKSPACE_ROUTES } from './workspaceRoutes'

const source = fileURLToPath(new URL('../', import.meta.url))
function files(directory) {
  if (!existsSync(directory)) return []
  return readdirSync(directory).flatMap(name => {
    const path = resolve(directory, name)
    return statSync(path).isDirectory() ? files(path) : [path]
  })
}

describe('Next.js migration boundaries', () => {
  it('keeps the legacy router outside every production entry import graph', () => {
    const pending = [...files(resolve(source, 'app')).filter(path => /\.[jm]sx?$/.test(path)), resolve(source, 'proxy.js')]
    const visited = new Set()
    const prohibited = []
    while (pending.length) {
      const path = pending.pop()
      if (visited.has(path)) continue
      visited.add(path)
      const text = readFileSync(path, 'utf8')
      for (const match of text.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s*)['"]([^'"]+)['"]/g)) {
        const specifier = match[1]
        if (specifier === 'react-router-dom' || specifier.includes('legacy-navigation')) prohibited.push({ path, specifier })
        if (!specifier.startsWith('.')) continue
        const base = resolve(dirname(path), specifier)
        const target = [base, `${base}.js`, `${base}.jsx`, `${base}.mjs`].find(candidate => existsSync(candidate) && statSync(candidate).isFile())
        if (target && ['.js', '.jsx', '.mjs'].includes(extname(target))) pending.push(target)
      }
    }
    expect(visited.size).toBeGreaterThan(50)
    expect(prohibited).toEqual([])
  })

  it('gives every workspace screen an explicit standard App Router page', () => {
    for (const path of Object.keys(WORKSPACE_ROUTES)) {
      expect(existsSync(resolve(source, 'app/(workspace)', path.slice(1), 'page.jsx')), path).toBe(true)
    }
    expect(files(resolve(source, 'app')).some(path => path.includes('...path'))).toBe(false)
    expect(files(resolve(source, 'pages')).filter(path => /\.[jt]sx?$/.test(path))).toEqual([])
  })
})
