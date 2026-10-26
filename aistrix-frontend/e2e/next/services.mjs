import http from 'node:http'
import { fixtureToken, fixtureUser } from './auth-fixture.mjs'

const developer = '00000000-0000-4000-8000-000000000201'
const publicId = '00000000-0000-4000-8000-000000000101'
const apps = [
  { id: publicId, created_by: developer, name: 'Public Invoice Helper', description: 'Organize invoice details with a published workflow.',
    emoji: '✦', tags: ['invoices'], is_published: true, visibility: 'public', is_paid: false, total_runs: 10,
    domains: { name: 'Productivity' }, marketplace_listings: [
      { id: 'listing-1', app_id: publicId, user_id: developer, title: 'Public Invoice Helper', tagline: 'Make invoice work easier.', status: 'live', category: 'Productivity' },
      { id: 'draft-listing', title: 'PRIVATE draft listing', status: 'draft' },
    ] },
  { id: '00000000-0000-4000-8000-000000000102', created_by: developer, name: 'PRIVATE hidden app', is_published: true, visibility: 'private' },
  { id: '00000000-0000-4000-8000-000000000103', created_by: developer, name: 'PRIVATE unpublished app', is_published: false, visibility: 'public' },
]
const profiles = [{ user_id: developer, display_name: 'Fixture Developer', bio: 'Builds practical workflow tools.' }]

function filtered(rows, query) {
  return rows.filter(row => [...query].every(([key, value]) => {
    if (value.startsWith('eq.')) {
      const expected = value.slice(3)
      return String(row[key]) === expected
    }
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(row[key])
    return true
  }))
}

http.createServer((request, response) => {
  response.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:4175')
  response.setHeader('Access-Control-Allow-Headers', 'authorization,apikey,content-type,x-client-info,x-workspace-id')
  response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS')
  if (request.method === 'OPTIONS') { response.writeHead(200).end(); return }
  const url = new URL(request.url, 'http://127.0.0.1:4176')
  let rows
  if (url.pathname === '/health') { response.writeHead(200).end('ok'); return }
  if (url.pathname === '/auth/v1/user') {
    const valid = request.headers.authorization === `Bearer ${fixtureToken}`
    response.writeHead(valid ? 200 : 401, { 'Content-Type': 'application/json' })
      .end(JSON.stringify(valid ? fixtureUser : { message: 'Invalid synthetic token' }))
    return
  }
  if (url.pathname === '/rest/v1/workspace_members') rows = [{ role: 'owner', workspace: {
    id: '00000000-0000-4000-8000-000000000401', name: 'Fixture workspace', slug: 'fixture', is_personal: true, plan: 'free',
  } }, { role: 'member', workspace: {
    id: '00000000-0000-4000-8000-000000000402', name: 'Fixture team', slug: 'fixture-team', is_personal: false, plan: 'free',
  } }]
  else if (url.pathname === '/v1/providers') {
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ providers: [] }))
    return
  }
  else if (url.pathname === '/rest/v1/public_developer_profiles') {
    response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: 'PGRST205', message: 'Could not find public_developer_profiles in the schema cache' }))
    return
  }
  else if (url.pathname === '/rest/v1/apps') rows = filtered(apps, url.searchParams)
  else if (url.pathname === '/rest/v1/developer_profiles') {
    if (/github|twitter|avatar_url/.test(url.searchParams.get('select') || '')) {
      response.writeHead(400, { 'Content-Type': 'application/json' }).end(JSON.stringify({ code: '42703', message: 'column developer_profiles.github does not exist' }))
      return
    }
    rows = filtered(profiles, url.searchParams)
  }
  else if (url.pathname === '/rest/v1/app_reviews') rows = []
  else if (url.pathname.startsWith('/rest/v1/')) rows = []
  else { response.writeHead(404, { 'Content-Type': 'application/json' }).end(JSON.stringify({ message: 'Synthetic fixture route not found' })); return }
  response.setHeader('Content-Type', 'application/json')
  response.setHeader('Cache-Control', 'no-store')
  const offset = Number(url.searchParams.get('offset') || 0)
  const limit = Number(url.searchParams.get('limit') || rows.length)
  rows = rows.slice(offset, offset + limit)
  response.writeHead(200).end(JSON.stringify(request.headers.accept?.includes('vnd.pgrst.object+json') ? rows[0] || null : rows))
}).listen(4176, '127.0.0.1', () => console.log('Synthetic public catalog service on 127.0.0.1:4176'))
