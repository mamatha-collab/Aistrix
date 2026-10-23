// Improve's comparison history (app_comparisons; the app's editors only).
import { supabase } from '../supabase'

const clip = (text, max) => String(text ?? '').slice(0, max)
export const sideOf = (version, prompt) => ({
  label: version?.id === 'draft' ? 'Draft candidate' : version?.label || (version?.version_num != null ? `v${version.version_num}` : 'Version'),
  version_num: version?.id === 'draft' ? null : version?.version_num ?? null,
  prompt: clip(prompt, 20000),
  provider: version?.version_data?.ai_provider || version?.ai_provider || null,
  model: version?.version_data?.ai_model || version?.ai_model || null,
})

export async function listComparisons(appId, limit = 20) {
  const { data, error } = await supabase.from('app_comparisons').select('*')
    .eq('app_id', appId).order('created_at', { ascending: false }).limit(limit)
  if (error) throw new Error(error.message)
  return data || []
}

export async function saveComparison({ appId, userId, input, baseline, candidate, baselineOutput, candidateOutput }) {
  const { data, error } = await supabase.from('app_comparisons').insert({
    app_id: appId, user_id: userId, input: clip(input, 8000), baseline, candidate,
    baseline_output: clip(baselineOutput, 20000), candidate_output: clip(candidateOutput, 20000),
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}

export async function deleteComparison(id) {
  const { error } = await supabase.from('app_comparisons').delete().eq('id', id)
  if (error) throw new Error(error.message)
}

// Turns a compared input into a saved test (Build → Test runs it).
export async function saveComparisonAsTest({ appId, userId, input, type, expectation }) {
  if (!input?.trim()) throw new Error('This comparison has no input to test.')
  if (!['must-contain', 'must-not-contain'].includes(type) || !expectation?.trim()) throw new Error('Define what the answer must include or avoid.')
  const { data, error } = await supabase.from('app_test_cases').insert({
    app_id: appId, user_id: userId, name: `Comparison · ${new Date().toLocaleDateString()}`, input: input.trim(),
    category: 'functional', rules: [{ type, value: expectation.trim() }], context: [],
  }).select().single()
  if (error) throw new Error(error.message)
  return data
}
