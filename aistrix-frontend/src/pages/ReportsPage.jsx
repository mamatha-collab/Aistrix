import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { parseSSELine } from '../lib/sse'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const PRESETS = [
  { id: 'this_week',  label: 'This week',   days: 7  },
  { id: 'this_month', label: 'This month',  days: 30 },
  { id: 'last_month', label: 'Last 30 days',days: 30 },
  { id: 'quarter',    label: 'This quarter',days: 90 },
]

const REPORT_TYPES = [
  {
    id: 'productivity',
    emoji: '📊',
    label: 'Productivity Summary',
    desc: 'Overview of usage patterns, top apps, and output volume.',
    prompt: `You are an AI productivity analyst. Generate a professional productivity report based on the user's AI app usage data below. Include:
1. Executive Summary (2-3 sentences)
2. Key Metrics
3. Top Performing Apps
4. Usage Patterns & Insights
5. Recommendations for improving workflow

Be specific, data-driven, and actionable. Format with clear headings.`,
  },
  {
    id: 'quality',
    emoji: '⭐',
    label: 'Quality Analysis',
    desc: 'Deep dive into result ratings, satisfaction trends, and which apps deliver best.',
    prompt: `You are an AI quality analyst. Analyze the user's AI app usage ratings and satisfaction data below. Include:
1. Overall Satisfaction Score
2. Best Performing Apps (by rating)
3. Areas Needing Improvement
4. Rating Trend Analysis
5. Specific Recommendations

Be honest and constructive. Format with clear headings.`,
  },
  {
    id: 'goals',
    emoji: '🎯',
    label: 'Goal Progress Report',
    desc: 'How you\'re tracking against your usage goals and consistency.',
    prompt: `You are a productivity coach. Analyze the user's AI usage consistency data below. Include:
1. Consistency Score
2. Streaks & Patterns
3. Goal Achievement Assessment
4. Days with Highest & Lowest Activity
5. Habit-Building Recommendations

Be encouraging but honest. Format with clear headings.`,
  },
]

function buildReportData(runs, period) {
  if (!runs.length) return 'No activity in this period.'

  const appCounts = {}
  const dayMap = {}
  const hourMap = new Array(24).fill(0)
  let thumbsUp = 0, thumbsDown = 0, rated = 0

  runs.forEach(r => {
    // App counts
    appCounts[r.app_name] = (appCounts[r.app_name] || 0) + 1
    // Day counts
    const day = r.created_at.slice(0, 10)
    dayMap[day] = (dayMap[day] || 0) + 1
    // Hour counts
    hourMap[new Date(r.created_at).getHours()]++
    // Ratings
    if (r.rating_value === 1) { thumbsUp++; rated++ }
    if (r.rating_value === -1) { thumbsDown++; rated++ }
  })

  const topApps = Object.entries(appCounts).sort(([,a],[,b]) => b - a).slice(0, 5)
  const activeDays = Object.keys(dayMap).length
  const avgPerDay = (runs.length / period).toFixed(1)
  const peakHour = hourMap.indexOf(Math.max(...hourMap))
  const busiest = Object.entries(dayMap).sort(([,a],[,b]) => b - a)[0]

  const lines = [
    `PERIOD: Last ${period} days`,
    `TOTAL RUNS: ${runs.length}`,
    `ACTIVE DAYS: ${activeDays} of ${period} days`,
    `AVERAGE RUNS PER DAY: ${avgPerDay}`,
    `PEAK HOUR: ${peakHour}:00`,
    `BUSIEST DAY: ${busiest?.[0]} (${busiest?.[1]} runs)`,
    '',
    'TOP APPS USED:',
    ...topApps.map(([name, count], i) => `  ${i+1}. ${name}: ${count} runs`),
    '',
    `RATINGS: ${thumbsUp} 👍 positive, ${thumbsDown} 👎 needs improvement (${rated} total rated)`,
    rated > 0 ? `SATISFACTION RATE: ${Math.round((thumbsUp/rated)*100)}%` : 'SATISFACTION RATE: No ratings yet',
    '',
    'DAILY BREAKDOWN (last 14 days):',
    ...Object.entries(dayMap).slice(-14).map(([date, count]) => `  ${date}: ${count} runs`),
  ]

  return lines.join('\n')
}

export default function ReportsPage({ user }) {
  const [preset, setPreset] = useState('this_month')
  const [reportType, setReportType] = useState('productivity')
  const [report, setReport] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [resultRef] = useState({ current: '' })
  const toast = useToast()

  const days = PRESETS.find(p => p.id === preset)?.days ?? 30
  const selectedType = REPORT_TYPES.find(t => t.id === reportType)

  async function generateReport() {
    setLoading(true); setReport(''); setError('')
    resultRef.current = ''

    try {
      const start = new Date(); start.setDate(start.getDate() - days)
      const { data: runs } = await supabase.from('run_history')
        .select('app_id, app_name, created_at, rating_value')
        .eq('user_id', user.id)
        .gte('created_at', start.toISOString())
        .order('created_at')

      if (!runs?.length) {
        setError('No activity found for this period. Run some apps first!')
        setLoading(false)
        return
      }

      const reportData = buildReportData(runs, days)
      const input = `USAGE DATA:\n\n${reportData}`

      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch(`${API_URL}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({
          input,
          system_prompt: selectedType.prompt,
          ai_provider: 'claude',
          ai_model: 'claude-sonnet-5-5',
        }),
      })

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop()
        for (const line of lines) {
          const data = parseSSELine(line)
          if (!data) continue
          if (data.token) { resultRef.current += data.token; setReport(resultRef.current) }
          if (data.error) throw new Error(data.error)
        }
      }
    } catch (e) {
      setError(e.message)
      toast(e.message, 'error')
    } finally {
      setLoading(false)
    }
  }

  function exportReport() {
    const blob = new Blob([report], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const date = new Date().toISOString().slice(0, 10)
    Object.assign(document.createElement('a'), { href: url, download: `aistrix-report-${date}.md` }).click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 max-w-3xl">
      <div>
        <h1 className="text-white text-xl font-semibold">Reports</h1>
        <p className="text-slate-400 text-sm mt-0.5">AI-generated summaries of your usage patterns and productivity.</p>
      </div>

      {/* Config */}
      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-5 space-y-5">
        <div>
          <p className="text-xs text-slate-400 uppercase mb-3">Report type</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {REPORT_TYPES.map(t => (
              <button key={t.id} onClick={() => setReportType(t.id)}
                className={`p-4 rounded-xl border text-left transition-all ${reportType === t.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10' : 'border-white/5 bg-[#1F2444] hover:border-white/20'}`}>
                <div className="text-2xl mb-2">{t.emoji}</div>
                <p className={`text-sm font-medium mb-1 ${reportType === t.id ? 'text-white' : 'text-slate-300'}`}>{t.label}</p>
                <p className="text-[11px] text-slate-500 leading-relaxed">{t.desc}</p>
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs text-slate-400 uppercase mb-3">Time period</p>
          <div className="flex gap-2 flex-wrap">
            {PRESETS.map(p => (
              <button key={p.id} onClick={() => setPreset(p.id)}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${preset === p.id ? 'bg-[#6C5CE7] text-white' : 'bg-[#1F2444] text-slate-400 hover:text-white'}`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>

        <button onClick={generateReport} disabled={loading}
          className="w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white py-3 rounded-xl font-medium transition-colors flex items-center justify-center gap-2">
          {loading
            ? <><span className="animate-spin">⟳</span> Generating report...</>
            : `✦ Generate ${selectedType?.label}`}
        </button>
      </div>

      {error && (
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 text-red-400 text-sm">{error}</div>
      )}

      {report && (
        <div className="bg-[#171B33] border border-white/5 rounded-2xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-white/5">
            <div className="flex items-center gap-2">
              <span className="text-lg">{selectedType?.emoji}</span>
              <p className="text-white font-medium text-sm">{selectedType?.label}</p>
              {loading && <span className="text-[#6C5CE7] animate-pulse text-xs">● generating</span>}
            </div>
            {!loading && (
              <div className="flex gap-2">
                <button onClick={() => { navigator.clipboard.writeText(report); toast('Copied', 'success', 2000) }}
                  className="text-xs text-slate-500 hover:text-white bg-[#1F2444] px-3 py-1.5 rounded-lg transition-colors">
                  📋 Copy
                </button>
                <button onClick={exportReport}
                  className="text-xs text-slate-500 hover:text-white bg-[#1F2444] px-3 py-1.5 rounded-lg transition-colors">
                  ↓ Export .md
                </button>
              </div>
            )}
          </div>
          <div className="p-6 prose-result text-sm text-slate-200 leading-relaxed">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{report}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  )
}
