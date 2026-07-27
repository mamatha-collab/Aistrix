import { useState, useMemo } from 'react'

const SIZES = [
  { id: 'compact',  label: 'Compact',   height: 400 },
  { id: 'medium',   label: 'Medium',    height: 600 },
  { id: 'large',    label: 'Large',     height: 800 },
  { id: 'fullpage', label: 'Full page', height: null },
]

const THEMES = [
  { id: 'dark',  label: '🌙 Dark',        bg: '#0F1225', surface: '#171B33' },
  { id: 'light', label: '☀️ Light (Ivory)', bg: '#FDFCF8', surface: '#FFFFFF' },
]

const ACCENTS = [
  '#6C5CE7', '#E84393', '#00B894', '#0984E3', '#FDCB6E', '#E17055', '#74B9FF',
]

function CopyBtn({ text }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className={`text-xs px-3 py-1.5 rounded-lg transition-colors font-medium ${copied ? 'bg-green-500/20 text-green-400' : 'bg-[#6C5CE7]/15 text-[#6C5CE7] hover:bg-[#6C5CE7]/25'}`}>
      {copied ? '✓ Copied!' : '📋 Copy'}
    </button>
  )
}

export default function EmbedCodeModal({ app, onClose }) {
  const [size, setSize] = useState('medium')
  const [theme, setTheme] = useState('dark')
  const [accent, setAccent] = useState('#6C5CE7')
  const [hideBranding, setHideBranding] = useState(false)
  const [hideHeader, setHideHeader] = useState(false)
  const [tab, setTab] = useState('iframe') // 'iframe' | 'js' | 'link'
  const [previewKey, setPreviewKey] = useState(0)

  const selectedSize = SIZES.find(s => s.id === size)
  const origin = window.location.origin

  const params = useMemo(() => {
    const p = new URLSearchParams()
    p.set('theme', theme)
    if (hideBranding) p.set('hide_branding', '1')
    if (hideHeader) p.set('hide_header', '1')
    if (accent !== '#6C5CE7') p.set('accent', accent)
    return p.toString()
  }, [theme, hideBranding, hideHeader, accent])

  const embedUrl = `${origin}/embed/${app.id}${params ? '?' + params : ''}`

  const iframeCode = selectedSize.height
    ? `<iframe\n  src="${embedUrl}"\n  width="100%"\n  height="${selectedSize.height}"\n  frameborder="0"\n  allow="clipboard-write"\n  style="border-radius:12px;overflow:hidden;"\n></iframe>`
    : `<div style="position:relative;width:100%;height:100vh;">\n  <iframe\n    src="${embedUrl}"\n    width="100%"\n    height="100%"\n    frameborder="0"\n    allow="clipboard-write"\n    style="position:absolute;top:0;left:0;"\n  ></iframe>\n</div>`

  const jsCode = `<!-- Add to your HTML -->
<div id="aistrix-${app.id.slice(0, 8)}"></div>

<script>
  (function() {
    var el = document.getElementById('aistrix-${app.id.slice(0, 8)}');
    var iframe = document.createElement('iframe');
    iframe.src = '${embedUrl}';
    iframe.width = '100%';
    iframe.height = '${selectedSize.height || 600}';
    iframe.frameBorder = '0';
    iframe.allow = 'clipboard-write';
    iframe.style.borderRadius = '12px';
    el.appendChild(iframe);

    // Auto-resize
    window.addEventListener('message', function(e) {
      if (e.data.type === 'aistrix:resize') iframe.height = e.data.height;
    });
  })();
</script>`

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70] p-4">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-3xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{app.emoji}</span>
            <div>
              <p className="text-white font-semibold">Embed — {app.name}</p>
              <p className="text-xs text-slate-400 mt-0.5">Drop this app into any website</p>
            </div>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white text-lg">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 flex flex-col lg:flex-row gap-0">
          {/* Options panel */}
          <div className="lg:w-64 shrink-0 p-5 space-y-5 border-b lg:border-b-0 lg:border-r border-white/5">
            {/* Size */}
            <div>
              <label className="text-xs text-slate-400 uppercase block mb-2">Size</label>
              <div className="grid grid-cols-2 gap-1.5">
                {SIZES.map(s => (
                  <button key={s.id} onClick={() => setSize(s.id)}
                    className={`text-xs py-2 px-3 rounded-xl border transition-all ${size === s.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10 text-white' : 'border-white/5 bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                    {s.label}
                    {s.height && <span className="text-slate-600 block text-[10px]">{s.height}px</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Theme */}
            <div>
              <label className="text-xs text-slate-400 uppercase block mb-2">Theme</label>
              <div className="space-y-1.5">
                {THEMES.map(t => (
                  <button key={t.id} onClick={() => setTheme(t.id)}
                    className={`w-full flex items-center gap-2 text-xs py-2 px-3 rounded-xl border transition-all ${theme === t.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10 text-white' : 'border-white/5 bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                    <div className="w-4 h-4 rounded border border-white/10 shrink-0" style={{ background: t.bg }} />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Accent color */}
            <div>
              <label className="text-xs text-slate-400 uppercase block mb-2">Accent color</label>
              <div className="flex flex-wrap gap-2">
                {ACCENTS.map(c => (
                  <button key={c} onClick={() => setAccent(c)}
                    className={`w-7 h-7 rounded-full transition-all ${accent === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#171B33] scale-110' : 'hover:scale-105'}`}
                    style={{ background: c }} />
                ))}
              </div>
            </div>

            {/* Options */}
            <div>
              <label className="text-xs text-slate-400 uppercase block mb-2">Options</label>
              <div className="space-y-2">
                {[
                  { key: 'hideHeader', label: 'Hide header', value: hideHeader, set: setHideHeader },
                  { key: 'hideBranding', label: 'Hide "Powered by Aistrix"', value: hideBranding, set: setHideBranding },
                ].map(opt => (
                  <label key={opt.key} className="flex items-center gap-2 cursor-pointer">
                    <button onClick={() => opt.set(v => !v)}
                      className={`relative w-8 h-4 rounded-full transition-colors ${opt.value ? 'bg-[#6C5CE7]' : 'bg-[#0F1225]'}`}>
                      <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-transform ${opt.value ? 'translate-x-4' : 'translate-x-0.5'}`} />
                    </button>
                    <span className="text-xs text-slate-400">{opt.label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Preview button */}
            <button onClick={() => setPreviewKey(k => k + 1)}
              className="w-full text-xs bg-[#1F2444] hover:bg-[#272C52] text-slate-300 py-2 rounded-xl transition-colors">
              ↻ Refresh preview
            </button>
          </div>

          {/* Right: preview + code */}
          <div className="flex-1 p-5 space-y-4 min-w-0">
            {/* Live preview */}
            <div>
              <label className="text-xs text-slate-400 uppercase block mb-2">Live preview</label>
              <div className="bg-[#0F1225] border border-white/5 rounded-xl overflow-hidden" style={{ height: Math.min(selectedSize.height || 400, 300) }}>
                <iframe key={previewKey} src={embedUrl} width="100%" height="100%"
                  frameBorder="0" allow="clipboard-write" title="App preview"
                  className="block" />
              </div>
            </div>

            {/* Code tabs */}
            <div>
              <div className="flex gap-1 mb-3">
                {[
                  { id: 'iframe', label: '⬡ iFrame' },
                  { id: 'js',     label: '{ } JavaScript' },
                  { id: 'link',   label: '🔗 Direct link' },
                ].map(t => (
                  <button key={t.id} onClick={() => setTab(t.id)}
                    className={`text-xs px-3 py-1.5 rounded-lg transition-colors ${tab === t.id ? 'bg-[#6C5CE7] text-white' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                    {t.label}
                  </button>
                ))}
              </div>

              <div className="relative">
                <pre className="bg-[#0F1225] border border-white/5 rounded-xl p-4 text-[11px] text-slate-300 overflow-x-auto leading-relaxed font-mono whitespace-pre-wrap break-all">
                  {tab === 'iframe' && iframeCode}
                  {tab === 'js' && jsCode}
                  {tab === 'link' && embedUrl}
                </pre>
                <div className="absolute top-3 right-3">
                  <CopyBtn text={tab === 'iframe' ? iframeCode : tab === 'js' ? jsCode : embedUrl} />
                </div>
              </div>

              {tab === 'link' && (
                <p className="text-[10px] text-slate-500 mt-2">
                  Use this URL directly in browser, or as the <code className="text-slate-400">src</code> of an iframe. Supports URL params for customization.
                </p>
              )}
              {tab === 'js' && (
                <p className="text-[10px] text-slate-500 mt-2">
                  The JS snippet auto-resizes the iframe to fit the content height, preventing scrollbars inside the embed.
                </p>
              )}
            </div>

            {/* URL params reference */}
            <details className="group">
              <summary className="text-[10px] text-slate-500 cursor-pointer hover:text-slate-300 transition-colors list-none flex items-center gap-1">
                <span className="group-open:rotate-90 transition-transform inline-block">▶</span> URL parameter reference
              </summary>
              <div className="mt-2 bg-[#0F1225] border border-white/5 rounded-xl p-3 space-y-1.5">
                {[
                  ['theme', 'dark | light', 'Color theme of the embed'],
                  ['accent', '#hex', 'Button and highlight color'],
                  ['hide_branding', '1', 'Remove "Powered by Aistrix"'],
                  ['hide_header', '1', 'Remove the app name header'],
                ].map(([param, val, desc]) => (
                  <div key={param} className="flex items-start gap-3 text-[10px]">
                    <code className="text-[#6C5CE7] shrink-0 w-28">{param}={val}</code>
                    <span className="text-slate-500">{desc}</span>
                  </div>
                ))}
              </div>
            </details>
          </div>
        </div>
      </div>
    </div>
  )
}
