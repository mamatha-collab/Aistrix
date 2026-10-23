// Customer feedback: a customer rates their run (the rating and comment go to
// the app's developers; the question and answer only if they choose), and
// developers triage it. Who gave the feedback is never shown.
import { manageRequest } from './manageApi'

export const FEEDBACK_STATUSES = [
  ['new', 'New'], ['investigating', 'Investigating'], ['fixed', 'Fixed'], ['verified', 'Verified'], ['dismissed', 'Dismissed'],
]
export const statusLabel = status => FEEDBACK_STATUSES.find(([id]) => id === status)?.[1] || status

export const rateRun = (runId, { rating, comment = '', shareRun = false }) =>
  manageRequest(`/v1/runs/${encodeURIComponent(runId)}/feedback`, {
    method: 'POST', body: JSON.stringify({ rating, comment: comment.trim() || null, share_run: shareRun }),
  })

// { items, counts } — status: 'open' (new + investigating), 'all', or one status
export const getAppFeedback = (appId, status = 'open', { offset = 0, limit = 200, signal } = {}) =>
  manageRequest(`/v1/apps/${encodeURIComponent(appId)}/feedback?status=${encodeURIComponent(status)}&offset=${offset}&limit=${limit}`, { signal })

export const updateFeedback = (id, patch) =>
  manageRequest(`/v1/feedback/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
