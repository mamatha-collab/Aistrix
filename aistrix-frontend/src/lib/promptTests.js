// Test Suite rule checks on an output (for showing which rules passed).
// Runs themselves happen on the server — see lib/appTests.js.

// ─── Rule evaluation (pure) ──────────────────────────────────────────────────
export function evaluateRule(output, rule) {
  const out = output ?? ''
  const val = rule.value ?? ''
  try {
    switch (rule.type) {
      case 'must-contain':     return out.toLowerCase().includes(val.toLowerCase())
      case 'must-not-contain': return !out.toLowerCase().includes(val.toLowerCase())
      case 'starts-with':      return out.trimStart().toLowerCase().startsWith(val.toLowerCase())
      case 'ends-with':        return out.trimEnd().toLowerCase().endsWith(val.toLowerCase())
      case 'regex':            return new RegExp(val, 'i').test(out)
      case 'min-length':       return out.length >= parseInt(val, 10)
      case 'max-length':       return out.length <= parseInt(val, 10)
      default:                 return true
    }
  } catch { return false }
}

export function evaluateCase(output, rules) {
  const results = (rules || []).map(r => ({ ...r, passed: evaluateRule(output, r) }))
  const passed = results.every(r => r.passed)
  return { passed, results }
}
