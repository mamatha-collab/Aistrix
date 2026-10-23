import { describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  autoMap, newApprovalStep, newAppStep, outputFields, releaseProblems, schemaKey, sourceOptions, stepIssues,
  typeFit, versionLabel, withStepIds,
} from './workflowModel'

vi.mock('../supabase', () => ({ supabase: { auth: {} } }))
const { WorkflowCanvas, StepSettings } = await import('./WorkflowDesigner.jsx')
const { ProgressRing } = await import('./WorkflowRunPanels.jsx')

const scorer = { id: 'scorer', name: 'Qualify lead', emoji: '📊', is_published: true, live_version: 2 }
const writer = { id: 'writer', name: 'Draft reply', emoji: '✉️', is_published: false }
const SCHEMAS = {
  'scorer@2': { input: [{ field: 'company', type: 'string' }], output: [{ field: 'score', type: 'number' }, { field: 'email', type: 'string' }], structured: true },
  'writer@draft': { input: [{ field: 'customer_email', type: 'string' }, { field: 'score', type: 'number' }, { field: 'note', type: 'string', required: false }], output: [], structured: false },
}
const flowWith = (steps, fields = [{ field: 'company', type: 'string' }]) => ({ id: 'f', name: 'Lead', trigger: { type: 'webhook', fields }, steps })

describe('workflow steps', () => {
  it('a published app step pins its live release; an unpublished one starts as a draft', () => {
    const a = newAppStep([], scorer)
    expect(a).toMatchObject({ id: 's1', version: 'published', pinned_version: 2 })
    expect(versionLabel(a)).toBe('Published · v2')
    const b = newAppStep([a], writer)
    expect(b).toMatchObject({ id: 's2', version: 'draft', pinned_version: null })
    expect(versionLabel(b)).toBe('Draft · editors only')
    expect(schemaKey(a)).toBe('scorer@2')
    expect(schemaKey(newApprovalStep([a, b]))).toBe(null)
  })

  it('old steps without ids get unique ones', () => {
    expect(withStepIds([{ id: 's2' }, {}, {}]).map(s => s.id)).toEqual(['s2', 's1', 's3'])
  })
})

describe('wiring', () => {
  const s1 = { ...newAppStep([], scorer) }
  const s2 = { ...newAppStep([s1], writer) }

  it('offers the trigger fields and earlier steps (structured fields plus whole output)', () => {
    const opts = sourceOptions(flowWith([s1, s2]), 1, SCHEMAS).map(o => o.value)
    expect(opts).toEqual(['trigger.company', 'trigger.text', 's1.score', 's1.email', 's1.text'])
    expect(outputFields(s2, SCHEMAS)).toEqual([{ field: 'text', type: 'string', whole: true }])
  })

  it('auto-connect matches names loosely and adds conversions', () => {
    const flow = flowWith([s1, s2])
    const targets = [{ field: 'customer_email', type: 'string' }, { field: 'score', type: 'number' }, { field: 'Company', type: 'string' }]
    const opts = sourceOptions(flow, 1, SCHEMAS)
    expect(autoMap(targets, opts)).toEqual({ score: { from: 's1.score' }, Company: { from: 'trigger.company' } })
    expect(autoMap([{ field: 'company', type: 'number' }], opts)).toEqual({ company: { from: 'trigger.company', transform: 'to_number' } })
  })

  it('type fit: anything into text is fine, text into numbers needs a conversion', () => {
    expect(typeFit('number', 'string')).toBe('ok')
    expect(typeFit('string', 'number')).toBe('lossy')
  })

  it('reports unconnected required fields, broken wires and drafts', () => {
    const wired = { ...s2, input_map: { score: { from: 's1.score' }, customer_email: { from: 's9.gone' } } }
    const issues = stepIssues(flowWith([s1, wired]), 1, SCHEMAS)
    expect(issues.map(i => i.text)).toEqual([
      'Uses a draft. Switch to a published version before release.',
      '"customer_email" is connected to something that no longer exists.',
    ])
    const ok = { ...wired, version: 'published', pinned_version: 2, app_id: 'scorer', input_map: { company: { from: 'trigger.company' } } }
    const s1Wired = { ...s1, input_map: { company: { from: 'trigger.company' } } }
    expect(releaseProblems(flowWith([s1Wired, ok]), SCHEMAS)).toEqual([])
    expect(releaseProblems(flowWith([s1, wired]), SCHEMAS).some(p => p.draft)).toBe(true)
    expect(stepIssues(flowWith([{ ...s1, input_map: {} }]), 0, SCHEMAS)[0].text).toBe('"company" isn\'t connected.')
  })
})

describe('designer', () => {
  const s1 = newAppStep([], scorer)
  const flow = flowWith([s1, newApprovalStep([s1])])
  it('shows the trigger, each step with its version and the add buttons', () => {
    const html = renderToStaticMarkup(createElement(WorkflowCanvas, { flow, apps: [scorer, writer], schemas: SCHEMAS, selected: 0, onSelect() {}, onChange() {} }))
    expect(html).toContain('Webhook')
    expect(html).toContain('Qualify lead')
    expect(html).toContain('Published · v2')
    expect(html).toContain('Review &amp; approve')
    expect(html.match(/aria-label="Add a step here"/g)).toHaveLength(3)
  })
  it('the settings panel shows app, version and input mapping', () => {
    const html = renderToStaticMarkup(createElement(StepSettings, { flow, selected: 0, apps: [scorer, writer], schemas: SCHEMAS, onChange() {}, onSelect() {} }))
    expect(html).toContain('Input mapping')
    expect(html).toContain('Draft · testing only')
    expect(html).toContain('company')
  })
})

describe('run progress', () => {
  it('the ring reports finished steps and spins only while working', () => {
    const working = renderToStaticMarkup(createElement(ProgressRing, { done: 1, total: 3, status: 'running' }))
    expect(working).toContain('1 of 3 steps finished, working')
    expect(working).toContain('animate-spin')
    const done = renderToStaticMarkup(createElement(ProgressRing, { done: 3, total: 3, status: 'done' }))
    expect(done).not.toContain('animate-spin')
    expect(done).toContain('3/3')
  })
})

describe('branches and AI fill', () => {
  const s1 = { ...newAppStep([], scorer), input_map: { company: { from: 'trigger.company' } } }
  const s2 = { ...newAppStep([s1], writer), version: 'published', pinned_version: 2, app_id: 'scorer', input_map: { company: { from: 'trigger.company' } } }

  it('a branch shows its name, or the check itself', async () => {
    const { conditionLabel } = await import('./workflowModel')
    expect(conditionLabel({ from: 's1.score', op: 'gte', value: '7', label: 'Qualified' })).toBe('Qualified')
    expect(conditionLabel({ from: 's1.score', op: 'gte', value: '7' })).toBe('score ≥ 7')
    expect(conditionLabel({ from: 's1.email', op: 'empty' })).toBe('email empty')
    expect(conditionLabel(null)).toBe(null)
  })

  it('a check needs a value and a source that still exists', () => {
    const bad = { ...s2, run_if: { from: 's9.score', op: 'gte', value: '' } }
    expect(stepIssues(flowWith([s1, bad]), 1, SCHEMAS).map(i => i.text)).toEqual([
      'Its "run only if" check uses something that no longer exists.',
      'Its "run only if" check needs a value to compare with.',
    ])
    const good = { ...s2, run_if: { from: 's1.score', op: 'gte', value: '7' } }
    expect(stepIssues(flowWith([s1, good]), 1, SCHEMAS)).toEqual([])
  })

  it('with AI fill on, unconnected required fields are not problems', () => {
    const open = { ...s1, input_map: {} }
    expect(stepIssues(flowWith([open]), 0, SCHEMAS).some(i => i.level === 'error')).toBe(true)
    expect(stepIssues(flowWith([{ ...open, ai_fill: true }]), 0, SCHEMAS)).toEqual([])
  })
})

describe('schedule times', () => {
  it('lists UTC hours in local time and keeps weekly days right across midnight', async () => {
    const { localTimeLabel, toUtcDay, toLocalDay } = await import('./WorkflowRunPanels.jsx')
    expect(localTimeLabel(3, 330)).toBe('08:30')          // India: UTC 03:00 = 08:30
    expect(localTimeLabel(23, 330)).toBe('04:30')         // …next day
    expect(toUtcDay(1, 23, 330)).toBe(0)                  // Monday 04:30 local = Sunday 23:00 UTC
    expect(toLocalDay(0, 23, 330)).toBe(1)
    expect(toUtcDay(5, 2, -420)).toBe(6)                  // Friday 19:00 PDT = Saturday 02:00 UTC
  })
})
