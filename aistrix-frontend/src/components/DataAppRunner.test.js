import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../supabase', () => ({ supabase: { auth: {} } }))
vi.mock('../hooks/useToast', () => ({ useToast: () => () => {} }))
const { default: DataAppRunner } = await import('./DataAppRunner.jsx')
const { buildTemplateCases } = await import('../lib/testTemplates.js')
const { isFileApp } = await import('../lib/fileApps.js')

const render = app_type => renderToStaticMarkup(createElement(DataAppRunner, { app: { id: 'a1', name: 'App', app_type }, user: { id: 'u1' }, inline: true }))

describe('one file runner for Data, Vision and Voice apps', () => {
  it('Data apps keep their data types and file upload', () => {
    const html = render('data')
    expect(html).toContain('CSV / Table')
    expect(html).toContain('Upload file')
  })

  it('Vision apps ask for images and an optional instruction', () => {
    const html = render('vision')
    expect(html).toContain('Add up to 4 images')
    expect(html).toContain('What should the app do with them?')
    expect(html).toContain('Analyse images')
    expect(html).not.toContain('CSV / Table')
  })

  it('Voice apps take a recording and show the transcript to check', () => {
    const html = render('voice')
    expect(html).toContain('Upload recording')
    expect(html).toContain('Transcript (check or edit it before processing)')
    expect(html).toContain('Process recording')
    expect(html).not.toContain('CSV / Table')
  })

  it('all three open in the file runner everywhere apps are shown', () => {
    expect(['data', 'vision', 'voice'].every(t => isFileApp({ app_type: t }))).toBe(true)
    expect(isFileApp({ app_type: 'prompt' })).toBe(false)
  })
})

describe('starter tests for the new types', () => {
  const categories = type => new Set(buildTemplateCases({ name: 'X', app_type: type }).map(c => c.category))

  it('Voice tests run on a transcript and cover what publishing needs', () => {
    const cases = buildTemplateCases({ name: 'Meeting notes', app_type: 'voice' })
    expect(cases[0].input).toMatch(/^Transcript:/)
    expect([...categories('voice')]).toEqual(expect.arrayContaining(['functional', 'app_specific', 'edge', 'safety']))
  })

  it('Vision tests check the app never invents image content', () => {
    const cases = buildTemplateCases({ name: 'Receipts', app_type: 'vision' })
    expect(cases.some(c => /no image was provided/.test(JSON.stringify(c.rules)))).toBe(true)
    expect([...categories('vision')]).toEqual(expect.arrayContaining(['functional', 'app_specific', 'edge', 'safety']))
  })
})
