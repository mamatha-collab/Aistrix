import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Editor, { loader } from '@monaco-editor/react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

// ─── Model cost table (USD per 1M tokens) ────────────────────────────────────
const MODEL_COSTS = {
  'gpt-4o':                    { input: 2.50,  output: 10.00 },
  'gpt-4o-mini':               { input: 0.15,  output: 0.60  },
  'claude-haiku-4-5':          { input: 0.80,  output: 4.00  },
  'claude-3-5-haiku-20241022': { input: 0.80,  output: 4.00  },
  'claude-sonnet-4-5':         { input: 3.00,  output: 15.00 },
  'claude-sonnet-4-5-20251001':{ input: 3.00,  output: 15.00 },
  'claude-sonnet-5':           { input: 3.00,  output: 15.00 },
  'claude-opus-4-5':           { input: 15.00, output: 75.00 },
  'claude-opus-5':             { input: 15.00, output: 75.00 },
}

function getModelCost(model) {
  if (!model) return MODEL_COSTS['claude-sonnet-4-5']
  const exact = MODEL_COSTS[model]
  if (exact) return exact
  const key = Object.keys(MODEL_COSTS).find(k => model.includes(k) || k.includes(model))
  return key ? MODEL_COSTS[key] : null
}

// ─── Aistrix context variable catalogue ──────────────────────────────────────
const CONTEXT_GROUPS = [
  {
    id: 'career',
    label: '💼 Career Profile',
    desc: 'Injected when required_context includes "career_profile"',
    vars: [
      { name: '{{career.full_name}}',          desc: 'Full name' },
      { name: '{{career.job_title}}',           desc: 'Current or target job title' },
      { name: '{{career.skills}}',              desc: 'Comma-separated skills list' },
      { name: '{{career.experience_summary}}',  desc: 'Work history summary' },
      { name: '{{career.education}}',           desc: 'Degrees and institutions' },
      { name: '{{career.bio}}',                 desc: 'Personal bio paragraph' },
    ],
  },
  {
    id: 'business',
    label: '🏢 Business Profile',
    desc: 'Injected when required_context includes "business_profile"',
    vars: [
      { name: '{{business.company_name}}',    desc: 'Company or brand name' },
      { name: '{{business.industry}}',        desc: 'Industry / sector' },
      { name: '{{business.brand_voice}}',     desc: 'Brand tone and style guidelines' },
      { name: '{{business.target_audience}}', desc: 'Target customer description' },
      { name: '{{business.mission}}',         desc: 'Mission statement' },
      { name: '{{business.products}}',        desc: 'Products or services offered' },
    ],
  },
  {
    id: 'memory',
    label: '🧠 User Memory',
    desc: 'Injected when required_context includes "memory"',
    vars: [
      { name: '{{memory.facts}}',         desc: 'All saved memory facts as a block' },
      { name: '{{memory.preferred_tone}}', desc: 'User\'s preferred response tone' },
      { name: '{{memory.language}}',       desc: 'User\'s preferred language' },
    ],
  },
  {
    id: 'runtime',
    label: '⚡ Runtime',
    desc: 'Available in every run',
    vars: [
      { name: '{{input}}',       desc: 'The user\'s input for this run' },
      { name: '{{user.name}}',   desc: 'End user\'s display name' },
      { name: '{{user.email}}',  desc: 'End user\'s email' },
      { name: '{{today}}',       desc: 'Current date (YYYY-MM-DD)' },
    ],
  },
  {
    id: 'knowledge',
    label: '📚 Knowledge Vault',
    desc: 'Company/workspace knowledge base',
    vars: [
      { name: '{{knowledge_vault}}', desc: 'All active knowledge vault entries as context' },
    ],
  },
]

// Register the custom Aistrix-prompt language once
let langRegistered = false
function registerAistrixLang(monaco) {
  if (langRegistered) return
  langRegistered = true

  monaco.languages.register({ id: 'aistrix-prompt' })
  monaco.languages.setMonarchTokensProvider('aistrix-prompt', {
    tokenizer: {
      root: [
        [/\{\{[^}]+\}\}/, 'aistrix-variable'],
        [/#.*$/, 'comment'],
        [/[^\{#]+/, 'text'],
        [/\{/, 'text'],
      ],
    },
  })
  monaco.editor.defineTheme('aistrix-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'aistrix-variable', foreground: 'A29BFE', fontStyle: 'bold' },
      { token: 'comment',          foreground: '636E72', fontStyle: 'italic' },
      { token: 'text',             foreground: 'DFE6E9' },
    ],
    colors: {
      'editor.background':          '#0E1424',
      'editor.foreground':          '#DFE6E9',
      'editor.lineHighlightBackground': '#1A2038',
      'editorLineNumber.foreground': '#4A5568',
      'editorLineNumber.activeForeground': '#A29BFE',
      'editor.selectionBackground': '#6C5CE740',
      'editorCursor.foreground':    '#6C5CE7',
      'editorIndentGuide.background1': '#1A2038',
      'editor.inactiveSelectionBackground': '#6C5CE720',
    },
  })

  // Autocomplete for Aistrix variables
  monaco.languages.registerCompletionItemProvider('aistrix-prompt', {
    triggerCharacters: ['{'],
    provideCompletionItems(model, position) {
      const word = model.getWordUntilPosition(position)
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn,
      }
      const suggestions = CONTEXT_GROUPS.flatMap(g =>
        g.vars.map(v => ({
          label: v.name,
          kind: monaco.languages.CompletionItemKind.Variable,
          insertText: v.name,
          documentation: `${g.label}: ${v.desc}`,
          detail: g.label,
          range,
        }))
      )
      return { suggestions }
    },
  })
}

// ─── Token / cost estimate ────────────────────────────────────────────────────
function estimateTokens(text) {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

function formatCost(n) {
  if (n < 0.001) return `$${(n * 1000).toFixed(3)}m`
  return `$${n.toFixed(4)}`
}

// ─── SSE helpers ─────────────────────────────────────────────────────────────
function parseSSELine(line) {
  if (!line.startsWith('data: ')) return null
  try { return JSON.parse(line.slice(6)) } catch { return null }
}

// ─── Main component ───────────────────────────────────────────────────────────
export default function PromptStudio({ app: initialApp, user, onClose, onSaved }) {
  const [prompt, setPrompt]       = useState(initialApp.system_prompt || '')
  const [saving, setSaving]       = useState(false)
  const [dirty, setDirty]         = useState(false)

  // Live preview
  const [sampleInput, setSampleInput] = useState('')
  const [previewOutput, setPreviewOutput] = useState('')
  const [previewing, setPreviewing]   = useState(false)
  const [previewError, setPreviewError] = useState(null)
  const abortRef = useRef(null)

  // Context var picker
  const [pickerOpen, setPickerOpen] = useState(null) // group id

  const toast = useToast()
  const editorRef = useRef(null)

  // Token + cost estimates
  const promptTokens = estimateTokens(prompt)
  const avgOutputTokens = 300 // conservative estimate
  const costs = getModelCost(initialApp.ai_model)
  const costPerRun = costs
    ? (promptTokens / 1_000_000) * costs.input + (avgOutputTokens / 1_000_000) * costs.output
    : null

  function handleEditorMount(editor, monaco) {
    editorRef.current = editor
    registerAistrixLang(monaco)
    monaco.editor.setTheme('aistrix-dark')
    // Re-set model language after theme is ready
    monaco.editor.setModelLanguage(editor.getModel(), 'aistrix-prompt')
  }

  function insertVariable(varName) {
    const editor = editorRef.current
    if (!editor) {
      setPrompt(p => p + varName)
      return
    }
    const selection = editor.getSelection()
    editor.executeEdits('insert-variable', [{
      range: selection,
      text: varName,
      forceMoveMarkers: true,
    }])
    editor.focus()
  }

  async function runPreview() {
    if (!sampleInput.trim() && !prompt.trim()) return
    abortRef.current?.abort()
    const ctrl = new AbortController()
    abortRef.current = ctrl

    setPreviewing(true)
    setPreviewOutput('')
    setPreviewError(null)

    try {
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({
          input: sampleInput || '(no input)',
          system_prompt: prompt,
          ai_provider: initialApp.ai_provider || 'claude',
          ai_model: initialApp.ai_model || null,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Backend error' }))
        throw new Error(err.detail || err.error || 'Backend error')
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = '', out = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n'); buf = lines.pop()
        for (const line of lines) {
          const d = parseSSELine(line)
          if (!d) continue
          if (d.token) { out += d.token; setPreviewOutput(out) }
          if (d.error) throw new Error(d.error)
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') setPreviewError(e.message)
    } finally {
      setPreviewing(false)
    }
  }

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('apps')
      .update({ system_prompt: prompt })
      .eq('id', initialApp.id)
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    setDirty(false)
    toast('Prompt saved', 'success', 2000)
    onSaved?.({ ...initialApp, system_prompt: prompt })
  }

  // Warn on close if unsaved
  function handleClose() {
    if (dirty && !window.confirm('You have unsaved changes. Close anyway?')) return
    abortRef.current?.abort()
    onClose()
  }

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); save() }
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  const modelLabel = initialApp.ai_model
    ? initialApp.ai_model.includes('gpt') ? '🟢 ' + initialApp.ai_model
    : '🟣 ' + initialApp.ai_model
    : '🟣 default model'

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-[#09101F]">

      {/* Header */}
      <div className="flex items-center gap-3 px-5 py-3 border-b border-white/8 bg-[#0E1424] shrink-0">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center text-lg shrink-0"
          style={{ background: (initialApp.color || '#6C5CE7') + '33' }}>
          {initialApp.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-white font-semibold text-sm truncate">{initialApp.name}</p>
          <p className="text-[10px] text-slate-500">Prompt Studio · {modelLabel}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && <span className="text-[10px] text-amber-400 bg-amber-400/10 px-2 py-0.5 rounded-full">Unsaved</span>}
          <button onClick={save} disabled={saving || !dirty}
            className="text-xs font-semibold px-4 py-1.5 rounded-lg bg-[#6C5CE7] hover:bg-[#7C6CFF] disabled:opacity-40 text-white transition-colors">
            {saving ? 'Saving…' : 'Save  ⌘S'}
          </button>
          <button onClick={handleClose}
            className="text-slate-400 hover:text-white transition-colors text-lg leading-none px-1">×</button>
        </div>
      </div>

      {/* Body */}
      <div className="flex flex-1 overflow-hidden">

        {/* ── Left: Monaco editor ─────────────────────────────── */}
        <div className="flex-1 flex flex-col min-w-0 border-r border-white/5">
          <div className="px-4 py-2 border-b border-white/5 bg-[#0E1424] flex items-center justify-between">
            <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">System Prompt</p>
            <p className="text-[10px] text-slate-600">Type <span className="text-[#A29BFE]">{'{{'}…{'}}'}</span> to insert a variable · autocomplete triggers on <span className="text-[#A29BFE]">{'{'}</span></p>
          </div>
          <div className="flex-1">
            <Editor
              defaultLanguage="aistrix-prompt"
              value={prompt}
              onChange={val => { setPrompt(val ?? ''); setDirty(true) }}
              onMount={handleEditorMount}
              loading={<div className="flex items-center justify-center h-full text-slate-500 text-sm">Loading editor…</div>}
              options={{
                fontSize: 13,
                lineHeight: 22,
                wordWrap: 'on',
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                padding: { top: 16, bottom: 16 },
                renderLineHighlight: 'line',
                fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", Menlo, monospace',
                fontLigatures: true,
                smoothScrolling: true,
                cursorBlinking: 'smooth',
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { verticalScrollbarSize: 4 },
                suggestOnTriggerCharacters: true,
                quickSuggestions: { other: true, comments: false, strings: false },
              }}
            />
          </div>
        </div>

        {/* ── Right: Variable picker + Preview ────────────────── */}
        <div className="w-80 flex flex-col shrink-0 overflow-hidden">

          {/* Context variable picker */}
          <div className="border-b border-white/5 flex-shrink-0">
            <div className="px-4 py-2 bg-[#0E1424] border-b border-white/5">
              <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">Context Variables</p>
              <p className="text-[10px] text-slate-600 mt-0.5">Click any variable to insert at cursor</p>
            </div>
            <div className="overflow-y-auto" style={{ maxHeight: '40vh' }}>
              {CONTEXT_GROUPS.map(group => (
                <div key={group.id}>
                  <button
                    onClick={() => setPickerOpen(p => p === group.id ? null : group.id)}
                    className="w-full flex items-center justify-between px-4 py-2 hover:bg-white/3 transition-colors text-left"
                  >
                    <span className="text-xs font-medium text-slate-300">{group.label}</span>
                    <span className="text-slate-600 text-[10px]">{pickerOpen === group.id ? '▲' : '▼'}</span>
                  </button>
                  {pickerOpen === group.id && (
                    <div className="px-3 pb-2 space-y-1">
                      <p className="text-[10px] text-slate-600 italic px-1 mb-1">{group.desc}</p>
                      {group.vars.map(v => (
                        <button
                          key={v.name}
                          onClick={() => insertVariable(v.name)}
                          className="w-full text-left group flex items-start gap-2 px-2 py-1.5 rounded-lg hover:bg-[#1A2038] transition-colors"
                        >
                          <code className="text-[11px] text-[#A29BFE] font-mono shrink-0 mt-0.5">{v.name}</code>
                          <span className="text-[10px] text-slate-500 group-hover:text-slate-400 leading-tight">{v.desc}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Live preview */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-4 py-2 bg-[#0E1424] border-b border-white/5 shrink-0">
              <p className="text-[10px] text-slate-500 uppercase font-semibold tracking-wide">Live Preview</p>
            </div>
            <div className="flex-1 flex flex-col gap-2 p-3 overflow-y-auto">
              <textarea
                value={sampleInput}
                onChange={e => setSampleInput(e.target.value)}
                placeholder="Enter a sample user input…"
                rows={3}
                className="w-full bg-[#0E1424] border border-white/8 rounded-lg px-3 py-2 text-xs text-white placeholder-slate-600 resize-none focus:outline-none focus:border-[#6C5CE7] transition-colors"
              />
              <button
                onClick={previewing ? () => abortRef.current?.abort() : runPreview}
                disabled={!prompt.trim()}
                className={`text-xs font-semibold py-2 rounded-lg transition-colors disabled:opacity-40 ${
                  previewing
                    ? 'bg-red-500/15 text-red-400 hover:bg-red-500/25 border border-red-500/20'
                    : 'bg-[#6C5CE7]/15 text-[#A29BFE] hover:bg-[#6C5CE7]/25 border border-[#6C5CE7]/25'
                }`}
              >
                {previewing ? '⏹ Stop' : '▶ Run preview'}
              </button>

              {previewError && (
                <div className="bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 text-xs text-red-400">
                  {previewError}
                </div>
              )}

              {(previewOutput || previewing) && (
                <div className="flex-1 bg-[#0E1424] border border-white/5 rounded-lg p-3 overflow-y-auto">
                  <p className="text-[9px] text-slate-600 uppercase font-semibold mb-2">Output</p>
                  <pre className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed font-sans">
                    {previewOutput}
                    {previewing && <span className="inline-block w-1.5 h-3 bg-[#6C5CE7] animate-pulse ml-0.5 align-middle" />}
                  </pre>
                </div>
              )}

              {!previewOutput && !previewing && !previewError && (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-[11px] text-slate-600 text-center leading-relaxed">
                    Enter a sample input and click<br />Run preview to test your prompt
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Footer: token count + cost estimate */}
      <div className="border-t border-white/5 bg-[#0E1424] px-5 py-2 flex items-center gap-5 text-[11px] text-slate-500 shrink-0">
        <span>
          <span className="text-slate-400 font-medium">~{promptTokens.toLocaleString()}</span> prompt tokens
        </span>
        <span>+</span>
        <span>~{avgOutputTokens} avg output tokens</span>
        <span>·</span>
        {costPerRun != null ? (
          <span>
            Est. <span className="text-green-400 font-medium">{formatCost(costPerRun)}</span> per run
          </span>
        ) : (
          <span>Cost unknown for this model</span>
        )}
        <span className="ml-auto flex items-center gap-1">
          {modelLabel}
          {costs && (
            <span className="text-slate-600">
              · ${costs.input}/M in · ${costs.output}/M out
            </span>
          )}
        </span>
      </div>
    </div>,
    document.body
  )
}
