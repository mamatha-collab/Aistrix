export const PROVIDER_REFUSAL = /out of credit|turned this run away|Rate limit reached|API key — check Settings|does not have permission for this model|No \w+ API key is available|runs on your own \w+ API key|service error — try again|Request timed out/i

export function isBlockingRunProblem(message = '') {
  return PROVIDER_REFUSAL.test(message) || /rate limit|api key|provider|timed out|quota|allowance|could not reach|network|out of credit|refused this run/i.test(message)
}
