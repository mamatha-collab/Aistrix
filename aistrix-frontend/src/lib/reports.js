// PDF reports for the Build steps (Design, Test, Deploy). jsPDF is loaded
// only when a report is downloaded, so it doesn't slow down Dev Studio.
//
// Built-in PDF fonts can't draw emoji or most symbols: text is reduced to
// what they can (✓/✗ become "Pass"/"Fail" in the builders below).

const BRAND = [108, 92, 231]        // #6C5CE7
const PASS = [0, 150, 110]
const FAIL = [214, 48, 49]
const WARN = [200, 140, 0]
const MUTED = [110, 116, 140]
const WINANSI_EXTRA = '‘’“”–—…•€™'

export function pdfText(value) {
  return String(value ?? '')
    .replace(/[✓✔]/g, 'yes').replace(/[✗✘✕×]/g, 'no').replace(/→/g, '->').replace(/←/g, '<-')
    .replace(/\r/g, '')
    .split('').filter(ch => ch.charCodeAt(0) <= 0xff || WINANSI_EXTRA.includes(ch)).join('')
    .replace(/[ \t]+\n/g, '\n').trim()
}

const slug = s => String(s || 'app').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'app'
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` }
const when = iso => iso ? new Date(iso).toLocaleString() : '—'

// sections: [{ heading, note?, keyValues?: [[label, value]], table?: { head, body, statusCol? }, paragraphs?: [text] }]
export async function downloadReport({ kind, app, title, subtitle, sections }) {
  const [{ jsPDF }, autoTableMod] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = autoTableMod.autoTable || autoTableMod.default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const M = 40
  let y = 0

  // Header band
  doc.setFillColor(...BRAND).rect(0, 0, W, 64, 'F')
  doc.setTextColor(255, 255, 255).setFont('helvetica', 'bold').setFontSize(16)
  doc.text(pdfText(title), M, 30)
  doc.setFont('helvetica', 'normal').setFontSize(8.5)
  doc.text(pdfText(`Generated ${new Date().toLocaleString()} · Aistrix`), W - M, 28, { align: 'right' })
  doc.setFontSize(10)
  doc.text(doc.splitTextToSize(pdfText(`${app?.name || 'App'}${subtitle ? ' · ' + subtitle : ''}`), W - 2 * M)[0], M, 48)
  y = 88

  const ensure = h => { if (y + h > doc.internal.pageSize.getHeight() - 50) { doc.addPage(); y = 50 } }

  for (const s of sections) {
    ensure(40)
    doc.setTextColor(30, 30, 50).setFont('helvetica', 'bold').setFontSize(12)
    doc.text(pdfText(s.heading), M, y)
    y += 6
    doc.setDrawColor(...BRAND).setLineWidth(1).line(M, y, M + 40, y)
    y += 14
    if (s.note) {
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...MUTED)
      const lines = doc.splitTextToSize(pdfText(s.note), W - 2 * M)
      ensure(lines.length * 12)
      doc.text(lines, M, y)
      y += lines.length * 12 + 4
    }
    if (s.keyValues?.length) {
      autoTable(doc, {
        startY: y, margin: { left: M, right: M }, theme: 'plain',
        styles: { fontSize: 9.5, cellPadding: 3, textColor: [40, 40, 60] },
        columnStyles: { 0: { cellWidth: 150, textColor: MUTED, fontStyle: 'bold' } },
        body: s.keyValues.map(([k, v]) => [pdfText(k), pdfText(v)]),
      })
      y = doc.lastAutoTable.finalY + 14
    }
    if (s.table?.body?.length) {
      const statusCol = s.table.statusCol
      autoTable(doc, {
        startY: y, margin: { left: M, right: M }, theme: 'grid',
        styles: { fontSize: 8.5, cellPadding: 4, valign: 'top', textColor: [40, 40, 60], lineColor: [225, 225, 235] },
        headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold' },
        columnStyles: s.table.columnStyles || {},
        head: [s.table.head.map(pdfText)],
        body: s.table.body.map(row => row.map(pdfText)),
        didParseCell: data => {
          if (data.section !== 'body' || data.column.index !== statusCol) return
          const v = String(data.cell.raw || '').toLowerCase()
          data.cell.styles.fontStyle = 'bold'
          data.cell.styles.textColor = /^(pass|yes|live|ok|ready)/.test(v) ? PASS : /^(fail|no|blocked|missing)/.test(v) ? FAIL : WARN
        },
      })
      y = doc.lastAutoTable.finalY + 16
    } else if (s.table) {
      doc.setFont('helvetica', 'italic').setFontSize(9).setTextColor(...MUTED)
      ensure(14); doc.text(pdfText(s.table.empty || 'Nothing to show yet.'), M, y); y += 18
    }
    for (const para of s.paragraphs || []) {
      doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(40, 40, 60)
      const lines = doc.splitTextToSize(pdfText(para), W - 2 * M)
      for (const line of lines) { ensure(12); doc.text(line, M, y); y += 12 }
      y += 6
    }
  }

  // Footer: page numbers
  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTED)
    doc.text(`Page ${i} of ${pages}`, W - M, doc.internal.pageSize.getHeight() - 24, { align: 'right' })
    doc.text(pdfText(`${app?.name || ''} · ${kind} report`), M, doc.internal.pageSize.getHeight() - 24)
  }
  doc.save(`${slug(app?.name)}-${kind.toLowerCase()}-report-${today()}.pdf`)
}

// ── Test step: what passed and what failed ──────────────────────────────────
export function testReport(app, status) {
  const cases = status?.cases || []
  const reqs = status?.requirements || []
  const failed = cases.filter(c => !c.passed)
  const p = status?.profile || {}
  const gate = status?.setup_required ? 'Test storage not set up'
    : status?.all_passed ? `Passed (${status.required_passed}/${status.required_total})`
      : `Not passed (${status?.required_passed ?? 0}/${status?.required_total ?? 0})`
  return {
    kind: 'Test', app, title: 'Test report', subtitle: `draft ${String(status?.draft_hash || '').slice(0, 8)}`,
    sections: [
      { heading: 'Summary', keyValues: [
        ['App', app.name], ['Model', p.model || app.ai_model || '—'],
        ['Quality gate', gate], ['Tests', `${status?.passed ?? 0} passed, ${failed.length} failed (of ${cases.length})`],
        ['Speed (p50 / p95)', p.latency_p50_ms != null ? `${(p.latency_p50_ms / 1000).toFixed(1)}s / ${(p.latency_p95_ms / 1000).toFixed(1)}s` : '—'],
        ['Average cost per run', p.avg_cost_usd != null ? `$${Number(p.avg_cost_usd).toFixed(4)}` : '—'],
      ] },
      { heading: 'Quality gate requirements', note: 'Publishing needs every required item to pass for this exact draft.',
        table: { head: ['Requirement', 'Required', 'Result', 'Tests', 'What to do'], statusCol: 2,
          columnStyles: { 0: { cellWidth: 130 }, 1: { cellWidth: 52 }, 2: { cellWidth: 52 }, 3: { cellWidth: 40 } },
          body: reqs.map(r => [r.label, r.required ? 'Yes' : 'Optional', r.passed ? 'Pass' : r.status === 'missing' ? 'Missing' : r.status === 'weak' ? 'Weak' : 'Fail', String(r.total ?? 0), r.passed ? '' : r.fix]) } },
      { heading: 'All tests', table: { head: ['#', 'Test', 'Category', 'Result', 'Problems'], statusCol: 3, empty: 'No tests have been run on this draft yet.',
          columnStyles: { 0: { cellWidth: 22 }, 1: { cellWidth: 150 }, 2: { cellWidth: 70 }, 3: { cellWidth: 40 } },
          body: cases.map((c, i) => [String(i + 1), c.label + (c.persona ? ` (${c.persona})` : ''), c.category || c.source, c.passed ? 'Pass' : 'Fail', (c.errors || []).join('; ')]) } },
      ...(failed.length ? [{ heading: 'Failed tests in detail',
        paragraphs: failed.flatMap((c, i) => [
          `${i + 1}. ${c.label}${c.persona ? ` (${c.persona})` : ''}`,
          `Problems: ${(c.errors || []).join('; ') || '—'}`,
          `Input: ${c.input || '—'}`,
          `Output: ${c.output || '—'}`,
        ]) }] : []),
    ],
  }
}

// ── Deploy step: readiness, live version, history, usage, access ───────────
export function deployReport(app, { release, checklist = [], versions = [], stats, links = {}, access = [] }) {
  const live = app.is_published
  return {
    kind: 'Deploy', app, title: 'Deploy report', subtitle: live ? `live${app.live_version ? ` v${app.live_version}` : ''}` : 'not live',
    sections: [
      { heading: 'Launch status', keyValues: [
        ['Live version', live ? (app.live_version ? `v${app.live_version}` : 'Live') : release?.has_live_version ? 'Offline (unpublished)' : 'Not published yet'],
        ['Draft', !release ? '—' : release.has_changes ? 'Has changes not yet live' : 'Same as the live version'],
        ['Test gate', !release ? '—' : release.test_problems?.length ? `Not passed — ${release.test_problems.join('; ')}` : 'Passed'],
        ['Publish checks', !release ? '—' : release.checks?.length ? `${release.checks.length} to fix` : 'All pass'],
        ['Ready to publish', release?.ready ? 'Yes' : 'No'],
      ] },
      { heading: 'Pre-publish checklist', table: { head: ['Item', 'Result'], statusCol: 1, columnStyles: { 1: { cellWidth: 70 } },
          body: checklist.map(c => [c.label, c.ok ? 'Pass' : c.warn ? 'Warning' : 'Fail']) } },
      { heading: 'Published versions', table: { head: ['Version', 'Published', 'What changed', 'Tests', 'Status'], statusCol: 4, empty: 'No published versions yet.',
          columnStyles: { 0: { cellWidth: 50 }, 1: { cellWidth: 110 }, 3: { cellWidth: 50 }, 4: { cellWidth: 50 } },
          body: versions.map(v => [`v${v.version_num}`, when(v.created_at), v.changelog || 'Published', v.tests?.total ? `${v.tests.passed}/${v.tests.total}` : '—', v.is_live ? 'Live' : ''])} },
      { heading: 'Usage after launch', note: 'Signed-in users, website visitors and API calls. The developer\'s own draft and test runs aren\'t counted.',
        keyValues: stats ? [
          ['Total runs', String(stats.total ?? 0)], ['Signed-in people', String(stats.users ?? 0)],
          ['Runs by website visitors', String(stats.visitorRuns ?? 0)], ['Runs via API / trigger', String(stats.apiRuns ?? 0)],
          ['Satisfaction', stats.satisfaction != null ? `${stats.satisfaction}% (${stats.rated} rated)` : 'No ratings yet'],
          ['Last run', stats.lastRun ? stats.lastRun.toLocaleString() : '—'],
        ] : [['Runs', 'No run data yet']] },
      { heading: 'Access & limits', keyValues: access },
      { heading: 'Links', keyValues: Object.entries(links) },
    ],
  }
}

// ── Design step: readiness and the blueprint ────────────────────────────────
export function designReport(app, bp, { checks = [], score, serverProblems, unsaved = false }) {
  const oc = bp?.output_contract || {}
  const rules = oc.format_rules && typeof oc.format_rules === 'object'
    ? Object.entries(oc.format_rules).map(([k, v]) => `${k.replace(/_/g, ' ')}: ${Array.isArray(v) ? v.join(', ') : typeof v === 'object' ? JSON.stringify(v) : v}`)
    : []
  const ai = bp?.ai_behavior || {}
  return {
    kind: 'Design', app, title: 'Design report', subtitle: `readiness ${score}/100${unsaved ? ' · includes unsaved changes' : ''}`,
    sections: [
      { heading: 'Readiness', keyValues: [
        ['Score', `${score}/100`],
        ['Publish check (saved version)', serverProblems == null ? 'Not checked' : serverProblems.length ? `${serverProblems.length} to fix — ${serverProblems.join('; ')}` : 'All design checks pass'],
      ], table: { head: ['Check', 'Result'], statusCol: 1, columnStyles: { 1: { cellWidth: 70 } }, body: checks.map(c => [c.label, c.ok ? 'Pass' : 'Fail']) } },
      { heading: 'App', keyValues: [
        ['Name', app.name], ['Description', app.description || '—'], ['Type', app.app_type || '—'],
        ['AI provider / model', `${app.ai_provider || 'claude'} / ${app.ai_model || '—'}`],
        ['Business problem', bp?.business_problem || '—'], ['Audience', bp?.audience || '—'],
      ] },
      { heading: 'Inputs', table: { head: ['Field', 'Label', 'Type', 'Required'], empty: 'No input fields defined.',
          body: (bp?.inputs || []).map(f => [f.key || '', f.label || '', f.type || '', f.required ? 'Yes' : 'No']) } },
      { heading: 'Output contract', keyValues: [['Format', oc.format || '—'], ...rules.map(r => ['Rule', r])],
        ...(oc.format === 'json' ? { table: { head: ['Field', 'Type', 'Required', 'Description'], empty: 'No output fields.',
          body: (bp?.output_schema?.fields || oc.fields || []).map(f => [f.field || f.name || '', f.type || '', f.required ? 'Yes' : 'No', f.description || ''])} } : {}) },
      { heading: 'AI behavior', keyValues: [
        ['Tone', ai.tone_preset || app.tone || '—'], ['When input is missing or unclear', ai.fallback_behavior || '—'],
        ['Refuse when', ai.refusal_rules || '—'],
      ] },
      { heading: 'System prompt', paragraphs: [app.system_prompt || '—'] },
    ],
  }
}
