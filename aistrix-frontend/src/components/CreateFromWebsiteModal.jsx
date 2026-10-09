import { useState, useRef, useEffect } from 'react'
import { useFocusTrap } from '../hooks/useFocusTrap'
import { generateJSON, normaliseUrl, readUrl } from '../lib/runStream'

export default function CreateFromWebsiteModal({ onClose, onGenerated }) {
  const [url, setUrl] = useState('')
  const [scraping, setScraping] = useState(false)
  const [scraped, setScraped] = useState(null)   // { text, url }
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const panelRef = useRef(null)
  const inputRef = useRef(null)
  useFocusTrap(panelRef, { onEscape: onClose })

  useEffect(() => { inputRef.current?.focus() }, [])

  async function loadSite() {
    const full = normaliseUrl(url)
    if (!full) return
    setUrl(full)
    setScraping(true)
    setScraped(null)
    setError('')
    try {
      const data = await readUrl(full, { maxChars: 20000 })
      setScraped({ text: data.text || '', url: data.url || full })
    } catch (e) {
      setError(e.message || "Could not fetch that URL. Check it's correct and publicly accessible.")
    } finally {
      setScraping(false)
    }
  }

  async function generate() {
    if (!scraped) return
    setGenerating(true)
    setError('')
    try {
      const parsed = await generateJSON(`You are an AI app generator. You have been given real scraped text from a business or service website.

Based on this content, generate a complete AI assistant app that would help users of this business.

Return ONLY valid JSON:
{
  "name": "short app name e.g. 'Acme Support Bot'",
  "emoji": "one relevant emoji",
  "description": "one sentence: what this app helps users do",
  "system_prompt": "detailed system prompt (300+ chars) for an AI assistant representing this business — include business name, what they offer, tone, common questions, and what to say when uncertain",
  "tags": "3-5 comma-separated tags",
  "input_placeholder": "example question a user might ask"
}`, `Here is the actual text content read from ${scraped.url}:\n\n${scraped.text.slice(0, 12000)}`)
      if (!parsed?.name || !parsed?.system_prompt) throw new Error('The AI response was missing the app name or instructions. Try again.')
      onGenerated({ ...parsed, source_url: scraped.url, source_text: scraped.text })
    } catch (e) {
      setError(`Could not generate the app: ${e.message}`)
    } finally {
      setGenerating(false)
    }
  }

  const wordCount = scraped ? scraped.text.split(/\s+/).filter(Boolean).length : 0
  const thinContent = scraped && wordCount < 80

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Create app from website"
        className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-xl flex flex-col overflow-hidden"
        style={{ maxHeight: '92vh' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-6 pb-5 shrink-0 border-b border-white/5">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xl shrink-0" style={{ background: '#00B89422', color: '#00B894' }}>🌐</div>
              <div>
                <p className="text-white font-bold text-xl leading-snug">From Website</p>
                <p className="text-slate-400 text-sm mt-0.5">Enter a URL — we'll read the site and generate the app.</p>
              </div>
            </div>
            <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white transition-colors p-1 shrink-0 ml-4">✕</button>
          </div>
        </div>

        {/* URL bar */}
        <div className="px-5 py-4 border-b border-white/5 shrink-0">
          <label className="text-xs text-slate-400 block mb-2">Website URL</label>
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-[#0F1225] border border-white/8 rounded-xl px-3 py-2.5">
              <span className="text-slate-600 text-sm shrink-0">🔗</span>
              <input
                ref={inputRef}
                type="url"
                value={url}
                onChange={e => { setUrl(e.target.value); setScraped(null); setError('') }}
                onKeyDown={e => e.key === 'Enter' && !scraping && url.trim() && loadSite()}
                placeholder="https://yourbusiness.com"
                className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none min-w-0"
              />
              {url && <button onClick={() => { setUrl(''); setScraped(null); setError('') }} className="text-slate-600 hover:text-slate-400 text-xs">✕</button>}
            </div>
            <button
              onClick={loadSite}
              disabled={!url.trim() || scraping}
              className="bg-[#1F2444] hover:bg-[#272C52] disabled:opacity-40 text-slate-300 hover:text-white text-sm px-4 py-2.5 rounded-xl transition-colors font-medium shrink-0"
            >
              {scraping ? '⟳ Reading…' : 'Read site →'}
            </button>
          </div>
          <p className="text-[11px] text-slate-600 mt-1.5">Best results with <span className="text-slate-500">/about</span>, <span className="text-slate-500">/services</span>, menu, pricing, or docs pages. Avoid homepages of JS-heavy apps (Google, Twitter, etc.).</p>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ minHeight: 0 }}>

          {/* Loading state */}
          {scraping && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="text-3xl mb-3 animate-pulse">🌐</div>
              <p className="text-slate-400 text-sm font-medium">Fetching page content…</p>
              <p className="text-slate-600 text-xs mt-1">Reading the real text from the site</p>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">
              <p className="font-medium mb-1">{error.startsWith('Could not generate') ? 'Could not generate the app' : 'Could not read that URL'}</p>
              <p className="text-red-400/70 text-xs">{error.replace(/^Could not generate the app: /, '')}</p>
            </div>
          )}

          {/* Empty state */}
          {!scraping && !scraped && !error && (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="w-16 h-16 rounded-2xl bg-[#00B894]/10 flex items-center justify-center text-3xl mb-4">🌐</div>
              <p className="text-white font-semibold mb-1">Enter a URL to get started</p>
              <p className="text-slate-500 text-sm max-w-sm leading-relaxed">
                We'll read the actual text from the page — menu items, services, pricing, about copy — and use that to generate a precise AI assistant.
              </p>
              <div className="mt-5 flex flex-col gap-1.5 text-left w-full max-w-xs">
                {[
                  'https://example-restaurant.com',
                  'https://example-lawfirm.com',
                  'https://docs.example.com',
                ].map(ex => (
                  <button key={ex} onClick={() => setUrl(ex)}
                    className="text-[11px] text-slate-600 hover:text-[#00B894] text-left transition-colors">
                    Try: {ex}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Scraped content preview */}
          {scraped && !scraping && (
            <div className="space-y-4">
              {/* Status row */}
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-white font-medium text-sm">Content extracted</p>
                  <p className="text-slate-500 text-xs mt-0.5">
                    ~{wordCount} words from <span className="text-slate-400 truncate">{scraped.url}</span>
                  </p>
                </div>
                {thinContent
                  ? <span className="text-[10px] bg-amber-500/15 text-amber-400 px-2 py-1 rounded-full font-medium shrink-0">⚠ Low content</span>
                  : <span className="text-[10px] bg-[#00B894]/15 text-[#00B894] px-2 py-1 rounded-full font-medium shrink-0">✓ Ready</span>
                }
              </div>

              {/* Thin content warning */}
              {thinContent && (
                <div className="bg-amber-500/8 border border-amber-500/20 rounded-xl p-4 space-y-2">
                  <p className="text-amber-400 text-sm font-medium">Not enough content to generate a useful app</p>
                  <p className="text-amber-400/70 text-xs leading-relaxed">
                    This page returned very little text — it's likely JavaScript-rendered (like Google, Twitter, or React apps) or a redirect page. Static scrapers can only read HTML that's in the page source.
                  </p>
                  <p className="text-amber-400/70 text-xs font-medium mt-1">Try instead:</p>
                  <ul className="text-amber-400/60 text-xs space-y-0.5 list-disc list-inside">
                    <li>An <strong className="text-amber-400/80">About</strong> or <strong className="text-amber-400/80">Services</strong> page (e.g. /about, /services)</li>
                    <li>A <strong className="text-amber-400/80">menu, pricing, or contact</strong> page</li>
                    <li>A <strong className="text-amber-400/80">blog post</strong> or <strong className="text-amber-400/80">docs page</strong> with real body text</li>
                    <li>Avoid homepages of large platforms (Google, Amazon, etc.)</li>
                  </ul>
                </div>
              )}

              {/* Content preview */}
              {!thinContent && (
                <div className="bg-[#0F1225] border border-white/5 rounded-xl p-4 max-h-52 overflow-y-auto">
                  <p className="text-[10px] text-slate-600 uppercase font-semibold tracking-wide mb-2">What Claude will read</p>
                  <p className="text-slate-400 text-xs leading-relaxed whitespace-pre-wrap">
                    {scraped.text.slice(0, 1200)}{scraped.text.length > 1200 ? `\n\n… +${wordCount - scraped.text.slice(0, 1200).split(/\s+/).length} more words` : ''}
                  </p>
                </div>
              )}

              {!thinContent && (
                <div className="bg-[#1F2444] border border-white/5 rounded-xl p-3 space-y-1.5">
                  {['App name & emoji', 'System prompt from real page text', 'Tags', 'Example question'].map(item => (
                    <div key={item} className="flex items-center gap-2 text-xs text-slate-500">
                      <span className="text-[#00B894]">✓</span>{item}
                    </div>
                  ))}
                </div>
              )}

              {generating && (
                <div className="bg-[#0F1225] border border-white/5 rounded-xl p-4 text-center space-y-1">
                  <div className="text-xl animate-pulse">✦</div>
                  <p className="text-slate-400 text-sm">Building your app with Claude…</p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-white/5 flex items-center justify-between shrink-0">
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 text-sm transition-colors">
            Cancel
          </button>
          <button
            onClick={generate}
            disabled={!scraped || generating || thinContent}
            className="flex items-center gap-2 text-white text-sm px-5 py-2.5 rounded-xl font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: scraped && !generating && !thinContent ? 'linear-gradient(135deg, #00B894, #00C9A7)' : '#1F2444' }}
          >
            {generating ? '⟳ Generating…' : '✦ Generate App from this content'}
          </button>
        </div>
      </div>
    </div>
  )
}
