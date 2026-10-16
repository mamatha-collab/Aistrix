import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

// run_history stores rating_type/rating_value/feedback_text; thread_messages
// only has a `rating` column. table defaults to run_history.
export default function RunRating({ runId, table = 'run_history' }) {
  const [value, setValue] = useState(null)   // 1 | -1 | null
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  if (!runId) return null

  async function submit(v, text = '') {
    setSaving(true)
    const patch = table === 'thread_messages'
      ? { rating: v }
      : { rating_type: 'thumb', rating_value: v, feedback_text: text || null }
    const { error } = await supabase.from(table).update(patch).eq('id', runId)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setValue(v)
    setShowFeedback(false)
    toast(v === 1 ? 'Thanks! 👍' : "Got it — we'll use this to improve 👎", 'info', 2500)
  }

  if (value !== null) {
    return (
      <span className={`text-sm ${value === 1 ? 'opacity-80' : 'opacity-60'}`}>
        {value === 1 ? '👍' : '👎'}
      </span>
    )
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1">
        <button onClick={() => submit(1)} disabled={saving} aria-label="Helpful"
          className="text-base opacity-40 hover:opacity-100 transition-all">👍</button>
        <button onClick={() => setShowFeedback(v => !v)} disabled={saving} aria-label="Not helpful"
          className="text-base opacity-40 hover:opacity-100 transition-all">👎</button>
      </div>
      {showFeedback && (
        <div className="flex gap-1 items-center">
          <input
            autoFocus
            value={feedbackText}
            onChange={e => setFeedbackText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit(-1, feedbackText) }}
            placeholder="What went wrong? (optional)"
            className="text-[11px] bg-[#0E1424] border border-white/10 rounded-lg px-2 py-1 text-white placeholder-slate-600 focus:outline-none focus:border-[#6C5CE7]/40 w-44"
          />
          <button onClick={() => submit(-1, feedbackText)} disabled={saving}
            className="text-[10px] font-semibold text-white bg-[#6C5CE7] hover:bg-[#7C6CFF] px-2 py-1 rounded-lg transition-colors">
            Send
          </button>
        </div>
      )}
    </div>
  )
}
