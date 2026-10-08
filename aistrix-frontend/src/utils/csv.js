// RFC 4180-ish CSV parsing: quoted fields, escaped quotes ("") and newlines
// inside quotes. Returns an array of rows (arrays of strings).
export function parseCSV(text) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++ }
        else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(v => v.trim() !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(v => v.trim() !== '')) rows.push(row)
  return rows
}

export function csvEscape(value) {
  return `"${String(value ?? '').replace(/"/g, '""')}"`
}

// Batch rows from user text. In CSV mode the first row is the header and each
// following row becomes "column: value" lines, so prompts can reference
// columns by name. Otherwise every non-empty line is one input.
export function buildBatchRows(text, csvMode) {
  if (!csvMode) {
    return text.split('\n').map(l => l.trim()).filter(Boolean).map(input => ({ input, cols: null }))
  }
  const [header, ...body] = parseCSV(text)
  if (!header) return []
  const names = header.map((h, i) => h.trim() || `column_${i + 1}`)
  return body.map(values => {
    const cols = Object.fromEntries(names.map((n, i) => [n, (values[i] ?? '').trim()]))
    return { input: names.map(n => `${n}: ${cols[n]}`).join('\n'), cols }
  })
}

export function looksLikeCSV(text) {
  const lines = text.split('\n').filter(l => l.trim())
  return lines.length >= 2 && lines[0].includes(',') && lines[1].includes(',')
}
