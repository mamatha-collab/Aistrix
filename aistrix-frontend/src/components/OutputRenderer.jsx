import { useState, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { emailResult } from '../utils/appActions'

// ─── Thinking indicator ───────────────────────────────────────────────────────
export function ThinkingIndicator({ label = 'Thinking...' }) {
  return (
    <div className="flex items-center gap-2.5 bg-[#6C5CE7]/8 border border-[#6C5CE7]/20 rounded-xl px-4 py-3">
      <span className="text-lg animate-pulse">🧠</span>
      <span className="text-xs text-[#A29BFE] font-medium">{label}</span>
      <span className="flex gap-0.5 ml-auto">
        <span className="w-1 h-1 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1 h-1 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1 h-1 rounded-full bg-[#6C5CE7] animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
    </div>
  )
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseMarkdownTable(text) {
  const lines = text.trim().split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('|') && l.endsWith('|'))
  if (lines.length < 2) return null
  // Remove separator rows like |---|---|
  const nonSep = lines.filter(l => !l.match(/^\|[\s\-:|]+\|$/))
  if (nonSep.length < 2) return null
  const headers = nonSep[0].split('|').slice(1, -1).map(h => h.trim())
  const rows = nonSep.slice(1).map(line => {
    const parts = line.split('|').slice(1, -1).map(c => c.trim())
    const obj = {}
    headers.forEach((h, i) => { obj[h] = parts[i] ?? '' })
    return obj
  }).filter(row => Object.values(row).some(v => v !== ''))
  return rows.length > 0 ? rows : null
}

function tryParseJSON(text, outputType) {
  if (!text) return null

  const cleaned = text.replace(/^```json?\n?/i, '').replace(/\n?```$/i, '').trim()

  // 1. Try the whole text
  try { return JSON.parse(cleaned) } catch {}

  // 2. Extract embedded JSON array — AI often adds explanation before/after
  //    Try each [ position from last to first (JSON is usually at end of response)
  const arrPositions = []
  let p = cleaned.indexOf('[')
  while (p >= 0) { arrPositions.push(p); p = cleaned.indexOf('[', p + 1) }
  for (let i = arrPositions.length - 1; i >= 0; i--) {
    try { return JSON.parse(cleaned.slice(arrPositions[i])) } catch {}
  }

  // 3. Extract embedded JSON object
  const objPositions = []
  p = cleaned.indexOf('{')
  while (p >= 0) { objPositions.push(p); p = cleaned.indexOf('{', p + 1) }
  for (let i = objPositions.length - 1; i >= 0; i--) {
    try { return JSON.parse(cleaned.slice(objPositions[i])) } catch {}
  }

  // 4. Fallback: try parsing markdown table (| col | col |)
  if (outputType === 'table' || outputType === 'cards') {
    const fromTable = parseMarkdownTable(text)
    if (fromTable) return fromTable
  }

  return null
}

function CopyBtn({ text, label = '📋' }) {
  const [copied, setCopied] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 2000) }}
      className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-1.5 py-0.5 rounded">
      {copied ? '✓' : label}
    </button>
  )
}

// ─── Export / Print ───────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

function resultToHtml(result, title) {
  const lines = result.split('\n')
  const body = lines.map(line => {
    if (line.startsWith('### ')) return `<h3>${escapeHtml(line.slice(4))}</h3>`
    if (line.startsWith('## ')) return `<h2>${escapeHtml(line.slice(3))}</h2>`
    if (line.startsWith('# ')) return `<h1>${escapeHtml(line.slice(2))}</h1>`
    if (line.trim() === '') return '<br/>'
    return `<p>${escapeHtml(line)}</p>`
  }).join('\n')
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>
      body { font-family: -apple-system, Segoe UI, Arial, sans-serif; max-width: 720px; margin: 40px auto; color: #1a1a1a; line-height: 1.6; padding: 0 20px; }
      h1, h2, h3 { color: #111; }
      p { margin: 0.4em 0; }
      .meta { color: #888; font-size: 12px; margin-bottom: 24px; border-bottom: 1px solid #eee; padding-bottom: 12px; }
    </style></head>
    <body>
      <div class="meta">${escapeHtml(title)} — exported ${new Date().toLocaleString()}</div>
      ${body}
    </body></html>`
}

function printResult(result, title) {
  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(resultToHtml(result, title))
  win.document.close()
  win.focus()
  win.onload = () => win.print()
}

function downloadResult(result, title, ext) {
  if (ext === 'html') {
    const blob = new Blob([resultToHtml(result, title)], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: `${title.replace(/[^a-z0-9]+/gi, '_')}.html` }).click()
    URL.revokeObjectURL(url)
  } else {
    const blob = new Blob([result], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: `${title.replace(/[^a-z0-9]+/gi, '_')}.txt` }).click()
    URL.revokeObjectURL(url)
  }
}

export function ExportActions({ result, title = 'Aistrix Result', buttonClassName, buttonLabel = '⬇ Export', align = 'right' }) {
  const [open, setOpen] = useState(false)
  if (!result) return null
  return (
    <div className="relative inline-block">
      <button onClick={() => setOpen(v => !v)}
        className={buttonClassName || 'text-[10px] text-slate-500 hover:text-slate-300 transition-colors px-1.5 py-0.5 rounded'}>
        {buttonLabel}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className={`absolute top-full mt-1 z-20 bg-[#1F2444] border border-white/10 rounded-xl py-1 w-44 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}>
            <button onClick={() => { printResult(result, title); setOpen(false) }}
              className="w-full text-left text-xs text-slate-300 hover:bg-[#272C52] hover:text-white px-3 py-2 transition-colors">
              🖨 Print / Save as PDF
            </button>
            <button onClick={() => { downloadResult(result, title, 'html'); setOpen(false) }}
              className="w-full text-left text-xs text-slate-300 hover:bg-[#272C52] hover:text-white px-3 py-2 transition-colors">
              ⬇ Download as HTML
            </button>
            <button onClick={() => { downloadResult(result, title, 'txt'); setOpen(false) }}
              className="w-full text-left text-xs text-slate-300 hover:bg-[#272C52] hover:text-white px-3 py-2 transition-colors">
              ⬇ Download as text
            </button>
            <button onClick={() => { emailResult(title, result); setOpen(false) }}
              className="w-full text-left text-xs text-slate-300 hover:bg-[#272C52] hover:text-white px-3 py-2 transition-colors">
              📧 Export to email
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ─── Table Renderer ───────────────────────────────────────────────────────────
const EMPTY_ROWS = [] // stable reference so `rows` below doesn't change identity every render when `data` isn't an array

function TableRenderer({ data }) {
  const [sortCol, setSortCol] = useState(null)
  const [sortDir, setSortDir] = useState('asc')

  const rows = Array.isArray(data) ? data : EMPTY_ROWS
  const headers = rows.length > 0 ? Object.keys(rows[0]) : []

  const sorted = useMemo(() => {
    if (!sortCol) return rows
    return [...rows].sort((a, b) => {
      const av = a[sortCol] ?? '', bv = b[sortCol] ?? ''
      const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true })
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [rows, sortCol, sortDir])

  function toggleSort(col) {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortCol(col); setSortDir('asc') }
  }

  function exportCSV() {
    const header = headers.join(',')
    const rowLines = sorted.map(r => headers.map(h => `"${String(r[h] ?? '').replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[header, ...rowLines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    Object.assign(document.createElement('a'), { href: url, download: 'data.csv' }).click()
    URL.revokeObjectURL(url)
  }

  if (rows.length === 0) return <p className="text-slate-500 text-sm text-center py-6">No table data returned.</p>

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">{sorted.length} rows · {headers.length} columns</p>
        <button onClick={exportCSV}
          className="flex items-center gap-1.5 text-xs font-medium bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#6C5CE7] border border-[#6C5CE7]/30 px-3 py-1.5 rounded-lg transition-colors">
          ↓ Export CSV
        </button>
      </div>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[#1F2444] border-b border-white/10">
              {headers.map(h => (
                <th key={h} onClick={() => toggleSort(h)}
                  className="text-left text-xs font-semibold px-4 py-3 cursor-pointer select-none whitespace-nowrap group"
                  style={{ color: sortCol === h ? '#6C5CE7' : '#94a3b8' }}>
                  <span className="flex items-center gap-1.5">
                    {h}
                    <span className={`text-[10px] transition-opacity ${sortCol === h ? 'opacity-100 text-[#6C5CE7]' : 'opacity-0 group-hover:opacity-40'}`}>
                      {sortCol === h ? (sortDir === 'asc' ? '↑' : '↓') : '↕'}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => (
              <tr key={i} className={`border-b border-white/5 transition-colors hover:bg-white/[0.03] ${i % 2 === 0 ? '' : 'bg-white/[0.01]'}`}>
                {headers.map(h => (
                  <td key={h} className="px-4 py-2.5 text-slate-200 text-xs whitespace-nowrap max-w-xs">
                    <span className="truncate block max-w-[200px]">{String(row[h] ?? '')}</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-600 text-center">Click any column header to sort ↑↓</p>
    </div>
  )
}

// ─── Cards Renderer ───────────────────────────────────────────────────────────
const BADGE_COLORS = {
  green: 'bg-green-400/10 text-green-400', red: 'bg-red-400/10 text-red-400',
  blue: 'bg-blue-400/10 text-blue-400', orange: 'bg-orange-400/10 text-orange-400',
  purple: 'bg-[#6C5CE7]/10 text-[#6C5CE7]', yellow: 'bg-yellow-400/10 text-yellow-400',
}

function CardsRenderer({ data }) {
  const cards = Array.isArray(data) ? data : []
  if (cards.length === 0) return <p className="text-slate-500 text-sm text-center py-6">No cards returned.</p>

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {cards.map((card, i) => (
        <div key={i} className="bg-[#1F2444] border border-white/5 rounded-xl p-4">
          <div className="mb-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="text-white font-medium text-sm leading-snug">{card.title}</p>
              {card.badge && (
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium shrink-0 ${BADGE_COLORS[card.badge_color] || BADGE_COLORS.purple}`}>
                  {card.badge}
                </span>
              )}
            </div>
            {card.subtitle && <p className="text-xs text-slate-400 mt-0.5">{card.subtitle}</p>}
          </div>
          {Array.isArray(card.fields) && (
            <div className="space-y-1.5 mt-3 pt-3 border-t border-white/5">
              {card.fields.map((f, j) => (
                <div key={j} className="flex items-center justify-between text-xs">
                  <span className="text-slate-500">{f.label}</span>
                  <span className="text-slate-200 font-medium">{f.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ─── Key-Value Renderer ───────────────────────────────────────────────────────
function KeyValueRenderer({ data }) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return <p className="text-slate-500 text-sm text-center py-6">No key-value data returned.</p>
  }
  const entries = Object.entries(data)
  return (
    <div className="bg-[#1F2444] border border-white/5 rounded-xl overflow-hidden">
      {entries.map(([k, v], i) => (
        <div key={k} className={`flex items-start gap-4 px-4 py-3 ${i < entries.length - 1 ? 'border-b border-white/5' : ''}`}>
          <span className="text-slate-400 text-xs font-medium w-36 shrink-0 pt-0.5">{k}</span>
          <span className="text-white text-sm flex-1 leading-relaxed">{String(v)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── JSON Viewer ──────────────────────────────────────────────────────────────
function JsonNode({ data, depth = 0 }) {
  const [collapsed, setCollapsed] = useState(depth > 1)
  const indent = depth * 16

  if (data === null) return <span className="text-slate-500">null</span>
  if (typeof data === 'boolean') return <span className="text-blue-400">{String(data)}</span>
  if (typeof data === 'number') return <span className="text-yellow-400">{data}</span>
  if (typeof data === 'string') return <span className="text-green-400">"{data}"</span>

  const isArr = Array.isArray(data)
  const keys = isArr ? data.map((_, i) => i) : Object.keys(data)
  const open = isArr ? '[' : '{'; const close = isArr ? ']' : '}'

  if (keys.length === 0) return <span className="text-slate-400">{open}{close}</span>

  return (
    <span>
      <button onClick={() => setCollapsed(v => !v)} className="text-slate-500 hover:text-white mr-1 text-[10px]">
        {collapsed ? '▶' : '▼'}
      </button>
      <span className="text-slate-400">{open}</span>
      {collapsed ? (
        <span className="text-slate-500 cursor-pointer" onClick={() => setCollapsed(false)}>
          {' '}{keys.length} {isArr ? 'items' : 'keys'}{' '}
        </span>
      ) : (
        <div style={{ marginLeft: indent + 16 }}>
          {keys.map((k, i) => (
            <div key={k}>
              {!isArr && <span className="text-blue-300">"{k}"</span>}
              {!isArr && <span className="text-slate-400">: </span>}
              <JsonNode data={isArr ? data[k] : data[k]} depth={depth + 1} />
              {i < keys.length - 1 && <span className="text-slate-600">,</span>}
            </div>
          ))}
        </div>
      )}
      {!collapsed && <span className="text-slate-400">{close}</span>}
    </span>
  )
}

function JsonRenderer({ data }) {
  return (
    <div className="bg-[#0F1225] border border-white/5 rounded-xl p-4 font-mono text-xs leading-relaxed overflow-x-auto">
      <JsonNode data={data} />
    </div>
  )
}

// ─── Chart Renderer (SVG) ─────────────────────────────────────────────────────
function BarChart({ title, labels, datasets }) {
  const W = 560, H = 200, PAD = { t: 30, r: 20, b: 40, l: 50 }
  const chartW = W - PAD.l - PAD.r, chartH = H - PAD.t - PAD.b

  const allValues = datasets.flatMap(d => d.data)
  const max = Math.max(...allValues, 1)
  const barW = chartW / (labels.length * datasets.length + labels.length * 0.5)
  const groupW = barW * datasets.length + barW * 0.5

  const yTicks = 4
  const colors = ['#6C5CE7', '#00B894', '#E84393', '#FDCB6E', '#74B9FF']

  return (
    <div>
      {title && <p className="text-sm font-medium text-white mb-3 text-center">{title}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {/* Y grid lines */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const y = PAD.t + (chartH / yTicks) * i
          const val = Math.round(max - (max / yTicks) * i)
          return (
            <g key={i}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
              <text x={PAD.l - 6} y={y + 4} textAnchor="end" fill="#64748b" fontSize="10">{val}</text>
            </g>
          )
        })}

        {/* Bars */}
        {labels.map((label, gi) => (
          <g key={gi}>
            {datasets.map((ds, di) => {
              const x = PAD.l + gi * groupW + di * barW + barW * 0.25
              const barH = (ds.data[gi] / max) * chartH
              const y = PAD.t + chartH - barH
              const color = ds.color || colors[di % colors.length]
              return (
                <g key={di}>
                  <rect x={x} y={y} width={barW * 0.8} height={barH} fill={color} fillOpacity="0.85" rx="2" />
                  {barH > 14 && (
                    <text x={x + barW * 0.4} y={y + barH - 4} textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">
                      {ds.data[gi]}
                    </text>
                  )}
                </g>
              )
            })}
            <text x={PAD.l + gi * groupW + groupW / 2} y={H - PAD.b + 14} textAnchor="middle" fill="#94a3b8" fontSize="10">
              {label}
            </text>
          </g>
        ))}
      </svg>

      {/* Legend */}
      {datasets.length > 1 && (
        <div className="flex gap-4 justify-center mt-2 flex-wrap">
          {datasets.map((ds, i) => (
            <div key={i} className="flex items-center gap-1.5 text-xs text-slate-400">
              <div className="w-3 h-3 rounded-sm" style={{ background: ds.color || colors[i] }} />
              {ds.label}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LineChart({ title, labels, datasets }) {
  const W = 560, H = 180, PAD = { t: 24, r: 20, b: 36, l: 48 }
  const chartW = W - PAD.l - PAD.r, chartH = H - PAD.t - PAD.b
  const allValues = datasets.flatMap(d => d.data)
  const max = Math.max(...allValues, 1), min = Math.min(...allValues, 0)
  const range = max - min || 1
  const colors = ['#6C5CE7', '#00B894', '#E84393', '#FDCB6E']

  function px(i) { return PAD.l + (i / (labels.length - 1)) * chartW }
  function py(v) { return PAD.t + chartH - ((v - min) / range) * chartH }

  return (
    <div>
      {title && <p className="text-sm font-medium text-white mb-3 text-center">{title}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full">
        {[0, 0.25, 0.5, 0.75, 1].map((t, i) => {
          const y = PAD.t + t * chartH
          return <line key={i} x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        })}

        {datasets.map((ds, di) => {
          const color = ds.color || colors[di]
          const points = ds.data.map((v, i) => `${px(i)},${py(v)}`).join(' ')
          const areaPoints = `${px(0)},${PAD.t + chartH} ${points} ${px(ds.data.length - 1)},${PAD.t + chartH}`
          return (
            <g key={di}>
              <polygon points={areaPoints} fill={color} fillOpacity="0.1" />
              <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              {ds.data.map((v, i) => (
                <circle key={i} cx={px(i)} cy={py(v)} r="3" fill={color} />
              ))}
            </g>
          )
        })}

        {labels.map((label, i) => (
          <text key={i} x={px(i)} y={H - PAD.b + 14} textAnchor="middle" fill="#94a3b8" fontSize="10">{label}</text>
        ))}
      </svg>
    </div>
  )
}

function ChartRenderer({ data }) {
  if (!data || !data.type) return <p className="text-slate-500 text-sm text-center py-6">No chart data returned.</p>
  const { type, title, labels = [], datasets = [] } = data
  if (type === 'line') return <LineChart title={title} labels={labels} datasets={datasets} />
  return <BarChart title={title} labels={labels} datasets={datasets} />
}

// ─── Markdown Renderer ────────────────────────────────────────────────────────
function MarkdownRenderer({ text }) {
  return (
    <div className="prose-result text-sm text-slate-200 leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  )
}

// ─── View Switcher ────────────────────────────────────────────────────────────
const VIEW_LABELS = {
  markdown: { icon: '¶', label: 'Text' },
  table:    { icon: '⊟', label: 'Table' },
  cards:    { icon: '⊞', label: 'Cards' },
  json:     { icon: '{}', label: 'JSON' },
  key_value:{ icon: '≡',  label: 'Fields' },
  chart:    { icon: '▦',  label: 'Chart' },
}

// ─── Main OutputRenderer ──────────────────────────────────────────────────────
export default function OutputRenderer({ result, outputType = 'markdown', loading = false, title = 'Aistrix Result' }) {
  const [activeView, setActiveView] = useState(outputType)

  const parsed = useMemo(() => {
    if (!result || outputType === 'markdown') return null
    return tryParseJSON(result, outputType)
  }, [result, outputType])

  // Available views depend on whether we have parseable JSON
  const availableViews = useMemo(() => {
    const base = ['markdown']
    if (parsed !== null) {
      if (Array.isArray(parsed) && parsed.length > 0 && typeof parsed[0] === 'object') {
        base.push('table', 'cards')
      }
      if (!Array.isArray(parsed) && parsed?.type && ['bar', 'line', 'pie'].includes(parsed.type)) {
        base.push('chart')
      }
      if (!Array.isArray(parsed) && typeof parsed === 'object' && !parsed?.type) {
        base.push('key_value')
      }
      base.push('json')
    }
    // Always include the designed output type
    if (outputType !== 'markdown' && !base.includes(outputType)) base.unshift(outputType)
    return [...new Set(base)]
  }, [parsed, outputType])

  function renderContent() {
    if (loading) {
      return (
        <div className="prose-result text-sm text-slate-200 leading-relaxed">
          <MarkdownRenderer text={result} />
        </div>
      )
    }

    // If we have parsed JSON and not in markdown view, use it
    const data = parsed
    if (!data && activeView !== 'markdown') {
      return (
        <div className="space-y-2">
          <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 text-[11px] text-amber-400">
            The AI didn't return valid JSON for this view. Showing raw output below.
          </div>
          <MarkdownRenderer text={result} />
        </div>
      )
    }

    switch (activeView) {
      case 'table':     return <TableRenderer data={data} />
      case 'cards':     return <CardsRenderer data={data} />
      case 'key_value': return <KeyValueRenderer data={data} />
      case 'json':      return <JsonRenderer data={data} />
      case 'chart':     return <ChartRenderer data={data} />
      default:          return <MarkdownRenderer text={result} />
    }
  }

  if (!result) return null

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <label className="text-xs text-slate-400">
          Result {loading && <span className="text-[#6C5CE7] animate-pulse">●</span>}
        </label>
        <div className="flex items-center gap-1">
          {availableViews.length > 1 && availableViews.map(view => {
            const vl = VIEW_LABELS[view] || { icon: view, label: view }
            return (
              <button key={view} onClick={() => setActiveView(view)}
                className={`flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg transition-colors ${activeView === view ? 'bg-[#6C5CE7] text-white' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                <span className="font-mono">{vl.icon}</span>
                <span>{vl.label}</span>
              </button>
            )
          })}
          <CopyBtn text={result} label="📋 Copy" />
          {!loading && <ExportActions result={result} title={title} />}
        </div>
      </div>
      <div className="bg-[#1F2444] border border-white/10 rounded-xl p-4 min-h-[60px]">
        {renderContent()}
      </div>
    </div>
  )
}
