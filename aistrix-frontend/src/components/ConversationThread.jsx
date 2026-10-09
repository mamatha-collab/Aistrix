import { useState, useEffect, useRef } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import OutputRenderer from './OutputRenderer'
import { streamRun } from '../lib/runStream'
import RunRating from './RunRating'
import { friendlyErrorMessage } from '../utils/appActions'

// The whole conversation is sent as the run input, which the backend caps at
// 20k characters — keep the most recent turns that fit.
const HISTORY_CHAR_BUDGET = 14000

function buildConversationInput(greeting, history, userMsg) {
  const turns = []
  let used = userMsg.length
  for (let i = history.length - 1; i >= 0; i--) {
    const line = `${history[i].role === 'user' ? 'User' : 'Assistant'}: ${history[i].content}`
    if (used + line.length > HISTORY_CHAR_BUDGET) break
    turns.unshift(line)
    used += line.length
  }
  if (greeting && turns.length === history.length && used + greeting.length < HISTORY_CHAR_BUDGET) {
    turns.unshift(`Assistant: ${greeting}`)
  }
  return turns.length
    ? `Conversation history:\n${turns.join('\n\n')}\n\nUser: ${userMsg}`
    : userMsg
}

// Signed-out website visitors (embed widget with visitor access) have no
// account to save threads to, so their conversation lives in this tab only.
const visitorKey = appId => `aistrix:chat:${appId}`

function loadVisitorMessages(appId) {
  try { return JSON.parse(sessionStorage.getItem(visitorKey(appId)) || '[]') } catch { return [] }
}

export default function ConversationThread({ app, user, threadId: initialThreadId, onClose, inline = false }) {
  const visitor = !user
  const [messages, setMessages] = useState(() => (visitor ? loadVisitorMessages(app.id) : []))
  const [threadId, setThreadId] = useState(initialThreadId || null)
  const [threads, setThreads] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [streaming, setStreaming] = useState('')
  const [showThreads, setShowThreads] = useState(false)
  const bottomRef = useRef(null)
  const toast = useToast()

  useEffect(() => {
    if (visitor) return
    loadThreads()
    if (threadId) loadMessages(threadId)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only re-run when app.id or user.id changes
  }, [app.id, user?.id])

  useEffect(() => {
    if (!visitor) return
    try { sessionStorage.setItem(visitorKey(app.id), JSON.stringify(messages.map(({ id, role, content }) => ({ id, role, content })))) } catch { /* storage blocked — keep it in memory */ }
  }, [visitor, app.id, messages])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, streaming])

  async function loadThreads() {
    const { data } = await supabase.from('conversation_threads')
      .select('*').eq('app_id', app.id).eq('user_id', user.id)
      .order('created_at', { ascending: false }).limit(10)
    setThreads(data || [])
  }

  async function loadMessages(tid) {
    const { data } = await supabase.from('thread_messages')
      .select('*').eq('thread_id', tid).order('created_at')
    setMessages(data || [])
  }

  // "+ New" just clears the view; the thread is saved with the first message.
  function startNewThread() {
    setThreadId(null); setMessages([]); setStreaming(''); setShowThreads(false)
  }

  async function ensureThread(firstMessage) {
    if (visitor || threadId) return threadId
    const { data, error } = await supabase.from('conversation_threads').insert({
      app_id: app.id, user_id: user.id, title: firstMessage.slice(0, 50),
    }).select().single()
    if (error) throw new Error(`Couldn't start the conversation: ${error.message}`)
    setThreadId(data.id)
    loadThreads()
    return data.id
  }

  async function switchThread(tid) {
    setThreadId(tid); setShowThreads(false); setStreaming('')
    loadMessages(tid)
  }

  async function sendMessage() {
    if (!input.trim() || loading) return
    const userMsg = input.trim(); setInput(''); setLoading(true); setStreaming('')
    const history = messages.filter(m => m.role === 'user' || m.role === 'assistant')
    const localId = `local-${Date.now()}`
    // Show it locally right away so the conversation doesn't look like it ate
    // the message while the save is in flight (or if it fails).
    setMessages(prev => [...prev, { id: localId, role: 'user', content: userMsg }])

    let tid
    try {
      tid = await ensureThread(userMsg)
    } catch (e) {
      toast(e.message, 'error')
      setMessages(prev => prev.filter(m => m.id !== localId))
      setInput(userMsg)
      setLoading(false)
      return
    }

    async function saveUserMessage() {
      if (visitor) return
      const { data: row, error } = await supabase.from('thread_messages').insert({
        thread_id: tid, role: 'user', content: userMsg,
      }).select().single()
      if (row) { setMessages(prev => prev.map(m => m.id === localId ? row : m)); return }
      if (error) toast(`Message sent, but wasn't saved: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveUserMessage })
    }
    await saveUserMessage()

    try {
      const { text: full, usage: finalUsage } = await streamRun({
        app_id: app.id,
        input: buildConversationInput(app.greeting, history, userMsg),
        system_prompt: app.system_prompt || 'You are a helpful assistant.',
        run_mode: 'conversation',
        ai_provider: app.ai_provider || 'claude',
        ai_model: app.ai_model || null,
        output_type: 'markdown',
      }, { onToken: setStreaming })
      if (!full.trim()) throw new Error('The assistant returned an empty reply. Please try again.')

      // Save assistant message
      const asstLocalId = `local-${Date.now()}`
      async function saveAssistantMessage() {
        if (visitor) return
        const { data: row, error } = await supabase.from('thread_messages').insert({
          thread_id: tid, role: 'assistant', content: full,
        }).select().single()
        // Usage isn't persisted (thread_messages has no token columns) — attach
        // it locally so the bubble can show it for this session either way.
        if (row) { setMessages(prev => prev.map(m => m.id === asstLocalId ? { ...row, usage: finalUsage } : m)); return }
        if (error) toast(`Reply wasn't saved: ${error.message}`, 'error', 8000, { label: 'Retry', onClick: saveAssistantMessage })
      }
      // Without this, the reply the user just watched stream in would vanish
      // the moment `streaming` clears below — show it locally right away.
      setMessages(prev => [...prev, { id: asstLocalId, role: 'assistant', content: full, usage: finalUsage }])
      setStreaming('')
      await saveAssistantMessage()
    } catch (e) {
      // A failed or cut-off reply is not saved; the user's message stays so
      // they can simply send again.
      setStreaming('')
      toast(friendlyErrorMessage(e), 'error', 8000)
    } finally {
      setLoading(false)
    }
  }

  const body = (
    <div className="flex flex-col h-full">
      {/* Thread selector */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
        <button onClick={() => setShowThreads(v => !v)}
          className="text-xs text-slate-400 hover:text-white bg-[#1F2444] px-2.5 py-1 rounded-lg transition-colors flex items-center gap-1">
          💬 {threads.find(t => t.id === threadId)?.title?.slice(0, 24) || 'New conversation'}
          <span className="text-slate-600">▾</span>
        </button>
        <button onClick={startNewThread} className="text-xs text-slate-500 hover:text-white px-2 py-1 transition-colors">+ New</button>
      </div>

      {showThreads && threads.length > 0 && (
        <div className="border-b border-white/5 bg-[#0F1225] max-h-36 overflow-y-auto">
          {threads.map(t => (
            <button key={t.id} onClick={() => switchThread(t.id)}
              className={`w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5 ${t.id === threadId ? 'text-[#6C5CE7]' : 'text-slate-400'}`}>
              {t.title || 'Untitled conversation'}
            </button>
          ))}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && !streaming && app.greeting && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl px-4 py-2.5 text-sm bg-[#1F2444] text-slate-200 rounded-bl-sm">
              <div className="prose-result text-sm">
                <OutputRenderer result={app.greeting} outputType="markdown" />
              </div>
            </div>
          </div>
        )}
        {messages.length === 0 && !streaming && !app.greeting && (
          <div className="text-center py-8">
            <p className="text-slate-500 text-sm">Start a conversation</p>
            <p className="text-slate-600 text-xs mt-1">The AI will remember everything you say in this thread</p>
          </div>
        )}
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm ${
              msg.role === 'user'
                ? 'bg-[#6C5CE7] text-white rounded-br-sm'
                : 'bg-[#1F2444] text-slate-200 rounded-bl-sm'
            }`}>
              {msg.role === 'user' ? (
                <p className="text-sm leading-relaxed">{msg.content}</p>
              ) : (
                <>
                  <div className="prose-result text-sm">
                    <OutputRenderer result={msg.content} outputType="markdown" />
                  </div>
                  {(msg.usage || !String(msg.id).startsWith('local-')) && (
                    <div className="flex items-center gap-2 mt-1">
                      {msg.usage && (
                        <p className="text-[10px] text-slate-500" title="Tokens used for this reply">
                          ↑{msg.usage.input_tokens?.toLocaleString()} ↓{msg.usage.output_tokens?.toLocaleString()} tok
                        </p>
                      )}
                      {!String(msg.id).startsWith('local-') && <RunRating table="thread_messages" runId={msg.id} />}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        ))}
        {streaming && (
          <div className="flex justify-start">
            <div className="max-w-[85%] bg-[#1F2444] rounded-2xl rounded-bl-sm px-4 py-2.5">
              <div className="prose-result text-sm">
                <OutputRenderer result={streaming} outputType="markdown" loading />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-3 border-t border-white/5">
        <div className="flex gap-2">
          <input
            className="flex-1 bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
            placeholder="Message..."
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
          />
          <button onClick={sendMessage} disabled={loading || !input.trim()}
            className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-4 py-2.5 rounded-xl transition-colors font-medium shrink-0">
            {loading ? '⟳' : '↑'}
          </button>
        </div>
        <p className="text-[10px] text-slate-600 text-center mt-1.5">Enter to send · AI remembers this conversation</p>
      </div>
    </div>
  )

  if (inline) return <div className="h-[500px] flex flex-col">{body}</div>

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-2xl flex flex-col" style={{ height: '80vh' }}>
        <div className="flex items-center justify-between p-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{app.emoji}</span>
            <div>
              <p className="text-white font-medium">{app.name}</p>
              <p className="text-xs text-slate-400">Conversation mode</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white text-lg">✕</button>
        </div>
        <div className="flex-1 overflow-hidden">{body}</div>
      </div>
    </div>
  )
}
