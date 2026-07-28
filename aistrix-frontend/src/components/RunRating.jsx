import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

// Per-run feedback (useful / not useful), shared across every runner surface
// so capture doesn't drift between them. Writes straight to `${table}.rating`
// — defaults to run_history (RunHistory.jsx already reads and displays it);
// pass table="thread_messages" for conversation-mode replies.
export default function RunRating({ runId, table = 'run_history' }) {
  const [rating, setRating] = useState(null)
  const toast = useToast()

  if (!runId) return null

  async function submit(value) {
    const { error } = await supabase.from(table).update({ rating: value }).eq('id', runId)
    if (error) { toast(error.message, 'error'); return }
    setRating(value)
    toast(value === 1 ? 'Thanks for the feedback! 👍' : "Got it — we'll improve this 👎", 'info', 2500)
  }

  return (
    <div className="flex items-center gap-1">
      <button onClick={() => submit(1)} aria-label="Mark this run as useful" aria-pressed={rating === 1}
        className={`text-base transition-all ${rating === 1 ? 'opacity-100 scale-125' : 'opacity-40 hover:opacity-80'}`}>👍</button>
      <button onClick={() => submit(-1)} aria-label="Mark this run as not useful" aria-pressed={rating === -1}
        className={`text-base transition-all ${rating === -1 ? 'opacity-100 scale-125' : 'opacity-40 hover:opacity-80'}`}>👎</button>
    </div>
  )
}
