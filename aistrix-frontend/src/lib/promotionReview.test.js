import { expect, it } from 'vitest'
import { reviewState, sameReviewValue } from './promotionReview'

it('detects page-only changes in the promotion review', () => {
  expect(sameReviewValue(reviewState({ pages: ['old'] }), reviewState({ pages: ['new'] }))).toBe(false)
})

it('detects tool additions, removals and configuration-only changes', () => {
  const tool = { name: 'lookup', type: 'http', config: { url: '/old' } }
  const live = reviewState({}, {}, [tool])
  for (const tools of [[], [tool, { name: 'search' }], [{ ...tool, config: { url: '/new' } }]]) {
    expect(sameReviewValue(live, reviewState({}, {}, tools))).toBe(false)
  }
})

it('ignores tool ordering, database metadata and object key ordering', () => {
  const tools = [{ name: 'a', config: { method: 'GET', url: '/a' } }, { name: 'b' }]
  const reordered = [{ name: 'b', id: 'row-b' }, { name: 'a', id: 'row-a', config: { url: '/a', method: 'GET' } }]
  expect(sameReviewValue(reviewState({}, {}, tools), reviewState({}, {}, reordered))).toBe(true)
})

it('ignores workflow phase but detects design changes', () => {
  const live = reviewState({}, { dev_phase: 'deploy', inputs: ['task'] })
  expect(sameReviewValue(live, reviewState({}, { dev_phase: 'test', inputs: ['task'] }))).toBe(true)
  expect(sameReviewValue(live, reviewState({}, { inputs: ['company'] }))).toBe(false)
})
