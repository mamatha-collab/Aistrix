import { describe, expect, it } from 'vitest'
import { filterMarketApps, loadMarketApp, loadMarketApps, marketListing } from './marketplace'

const app = { id:'a', name:'Available app', description:'Ready to use', created_by:'owner', tags:['writing'],
  is_published:true, visibility:'public', domains:{ name:'Writing & Content' } }

function clientFor(rows, error = null) {
  const calls = []
  return { calls, from(table) {
    const filters = []
    const query = {
      select(columns) { calls.push({ table, columns, filters }); return this },
      eq(field, value) { filters.push([field,value]); return this },
      order() { return this },
      range(start, end) { return Promise.resolve({ data:rows.filter(row => filters.every(([k,v]) => row[k] === v)).slice(start,end+1), error }) },
      maybeSingle() { return Promise.resolve({ data:rows.find(row => filters.every(([k,v]) => row[k] === v)) || null, error }) },
    }
    return query
  } }
}

describe('public app discovery', () => {
  it('includes published public apps without listings and ignores draft listing metadata', async () => {
    const client = clientFor([app, { ...app,id:'private',visibility:'private' }, { ...app,id:'draft',is_published:false }])
    const listings = await loadMarketApps(client)
    expect(listings).toHaveLength(1)
    expect(listings[0]).toMatchObject({ app_id:'a', title:app.name, tagline:app.description, category:'Writing & Content' })
    expect(marketListing({ ...app, marketplace_listings:{ status:'draft',title:'Secret draft title' } }).title).toBe(app.name)
    expect(client.calls[0].filters).toEqual([['is_published',true],['visibility','public']])
    expect(client.calls[0].columns).not.toMatch(/system_prompt|prod_snapshot|webhook_url/)
  })

  it('preserves live listing details and falls back for empty metadata', () => {
    const listing = marketListing({ ...app, marketplace_listings:[{ id:'listing',status:'live', title:'Custom title',tagline:' ',category:'Productivity' }] })
    expect(listing).toMatchObject({ title:'Custom title', tagline:app.description,category:'Productivity',tags:['writing'] })
    expect(filterMarketApps([listing],'All','available')).toHaveLength(1)
    expect(filterMarketApps([listing],'Productivity','custom')).toHaveLength(1)
    expect(filterMarketApps([listing],'Engineering','custom')).toHaveLength(0)
  })

  it('reads beyond the database response limit so search includes later apps', async () => {
    const client = clientFor(Array.from({ length:503 }, (_,i) => ({ ...app,id:String(i),name:`App ${i}` })))
    const listings = await loadMarketApps(client)
    expect(listings).toHaveLength(503)
    expect(client.calls).toHaveLength(2)
    expect(filterMarketApps(listings,'All','App 502')).toHaveLength(1)
  })

  it('opens an unlisted public app but refuses private and unpublished detail pages', async () => {
    const client = clientFor([app,{ ...app,id:'private',visibility:'private' },{ ...app,id:'draft',is_published:false }])
    expect((await loadMarketApp(client,'a')).title).toBe(app.name)
    expect(await loadMarketApp(client,'private')).toBeNull()
    expect(await loadMarketApp(client,'draft')).toBeNull()
  })

  it('reports catalog outages instead of silently treating them as empty', async () => {
    await expect(loadMarketApps(clientFor([], { message:'Catalog unavailable' }))).rejects.toThrow('Catalog unavailable')
    await expect(loadMarketApp(clientFor([], { message:'Catalog unavailable' }),'a')).rejects.toThrow('Catalog unavailable')
  })
})
