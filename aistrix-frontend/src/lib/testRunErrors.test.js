import { expect, it } from 'vitest'
import { isBlockingRunProblem } from './testRunErrors'

it.each([
  'OpenAI turned this run away.', 'Rate limit reached', 'Your account is out of credit',
  'No OpenAI API key is available', 'Request timed out', 'Could not reach the server',
  'This key does not have permission for this model',
])('stops the suite when later tests would repeat the same refusal: %s', message => {
  expect(isBlockingRunProblem(message)).toBe(true)
})

it.each(['Missing required summary section', 'Expected JSON output', 'Answer did not include the company name'])('continues after an ordinary failed assertion: %s', message => {
  expect(isBlockingRunProblem(message)).toBe(false)
})
