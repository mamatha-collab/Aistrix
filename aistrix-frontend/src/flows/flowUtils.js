import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { parseSSELine } from '../lib/sse'
import { API_URL } from './flowConstants'

export function shortModelName(model) {
  if (!model) return 'AI'
  if (model.includes('haiku')) return 'Haiku'
  if (model.includes('sonnet')) return 'Sonnet'
  if (model.includes('opus')) return 'Opus'
  if (model.includes('gpt-4o-mini')) return 'GPT-4o Mini'
  if (model.includes('gpt-4o')) return 'GPT-4o'
  return model
}

export function useTodayProgress(flow, userId) {
  const [ran, setRan] = useState(null)
  const steps = flow.steps || []
  useEffect(() => {
    if (!steps.length || !userId) return
    const ids = steps.map(s => s.app_id).filter(Boolean)
    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    supabase.from('run_history').select('app_id').eq('user_id', userId).in('app_id', ids)
      .gte('created_at', todayStart.toISOString())
      .then(({ data }) => setRan(new Set((data || []).map(r => r.app_id))))
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when flow.id or userId changes
  }, [flow.id, userId])
  const done = ran ? [...ran].filter(id => steps.some(s => s.app_id === id)).length : 0
  return { done, total: steps.length }
}

export function mergeMemory(prev, fresh) {
  const next = { ...prev }
  for (const [k, v] of Object.entries(fresh || {})) {
    if (Array.isArray(v)) {
      const existing = Array.isArray(next[k]) ? next[k] : (next[k] ? [next[k]] : [])
      next[k] = [...new Set([...existing, ...v.map(String)])]
    } else if (v !== null && v !== '') {
      next[k] = v
    }
  }
  return next
}

export async function streamRun(body, session, onToken) {
  const res = await fetch(`${API_URL}/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  })
  const reader = res.body.getReader(); const decoder = new TextDecoder()
  let buf = '', full = '', provider = null, model = null, usage = null
  while (true) {
    const { done, value } = await reader.read(); if (done) break
    buf += decoder.decode(value, { stream: true })
    const lines = buf.split('\n'); buf = lines.pop()
    for (const line of lines) {
      const d = parseSSELine(line)
      if (!d) continue
      if (d.token) { full += d.token; onToken?.(full) }
      if (d.done) { provider = d.provider || null; model = d.model || null; usage = d.usage || null }
    }
  }
  return { result: full, provider, model, usage }
}

export async function sendToIntegration(url, flow, results, steps) {
  const text = `*${flow.emoji} ${flow.name}* — workflow complete\n\n` +
    steps.map((s, i) => `*${i + 1}. ${s.app_name}*\n${(results[i] || '').slice(0, 1500)}`).join('\n\n')
  await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ text, workspace: flow.name, steps: steps.map((s, i) => ({ app_name: s.app_name, result: results[i] || '' })) }),
  })
}

export async function extractFacts(text, session) {
  try {
    const { result: full } = await streamRun({
      input: text.slice(0, 8000),
      system_prompt: 'Extract durable facts about the person/subject discussed: skills, accessibility needs or disabilities, identity, constraints, preferences, goals. Return ONLY a flat JSON object of short key:value pairs (use arrays for multi-value keys, e.g. "skills":["C++","Python"]). No prose, no markdown fences. If nothing durable is found, return {}.',
      ai_provider: 'claude',
    }, session)
    const match = full.match(/\{[\s\S]*\}/)
    return match ? JSON.parse(match[0]) : {}
  } catch { return {} }
}
