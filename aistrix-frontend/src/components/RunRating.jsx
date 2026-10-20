import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { rateRun } from '../lib/feedback'

// run_history ratings go through the server: the rating and comment reach
// the app's developers (the question and answer only if the user ticks the
// box); thread_messages only has a `rating` column. table defaults to run_history.
export default function RunRating({ runId, table = 'run_history' }) {
  const [value, setValue] = useState(null)   // 1 | -1 | null
  const [showFeedback, setShowFeedback] = useState(false)
  const [feedbackText, setFeedbackText] = useState('')
  const [shareRun, setShareRun] = useState(false)
  const [saving, setSaving] = useState(false)
  const toast = useToast()

  if (!runId) return null

  async function submit(v, text = '') {
    setSaving(true)
    let shared = false
    try {
      if (table === 'thread_messages') {
        const { error } = await supabase.from(table).update({ rating: v }).eq('id', runId)
        if (error) throw error
      } else {
        shared = (await rateRun(runId, { rating: v, comment: text, shareRun: v === -1 && shareRun })).shared_with_developer
      }
    } catch (error) {
      setSaving(false)
      toast(error.message || 'Could not save your rating', 'error')
      return
    }
    setSaving(false)
    setValue(v)
    setShowFeedback(false)
    toast(v === 1 ? 'Thanks! 👍' : shared ? "Thanks — sent to the app's developer 👎" : 'Thanks for the feedback 👎', 'info', 2500)
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
      {showFeedback && table !== 'thread_messages' && (
        <label className="flex items-center gap-1.5 text-[10px] text-slate-400 max-w-56 text-right">
          <input type="checkbox" checked={shareRun} onChange={e => setShareRun(e.target.checked)} className="accent-[#6C5CE7]" />
          Include my question and the answer so the developer can fix it
        </label>
      )}
    </div>
  )
}
