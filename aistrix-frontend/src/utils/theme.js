const DARK = {
  '--t-bg':        '#09101F',
  '--t-shell':     '#0E1424',
  '--t-surface':   '#121829',
  '--t-raised':    '#1A2038',
  '--t-hover':     '#222840',
  '--t-text':      '#F4F7FF',
  '--t-muted':     '#A8B6D7',
  '--t-faint':     '#6F7C9D',
  '--t-border':    'rgba(255,255,255,0.08)',
  '--t-border2':   'rgba(255,255,255,0.18)',
  '--t-overlay':   'rgba(0,0,0,0.6)',
  '--t-accent':    '#7C6BFF',
  '--t-accent-2':  '#E84393',
  '--t-accent-3':  '#16D9B2',
  '--t-warn':      '#F59E0B',
  '--t-shadow':    'rgba(3,8,20,0.42)',
}

const LIGHT = {
  '--t-bg':        '#F4F7FB',
  '--t-shell':     '#FFFFFF',
  '--t-surface':   '#FBFCFF',
  '--t-raised':    '#FFFFFF',
  '--t-hover':     '#EEF4FF',
  '--t-text':      '#111827',
  '--t-muted':     '#4B5874',
  '--t-faint':     '#7A869E',
  '--t-border':    'rgba(17,24,39,0.09)',
  '--t-border2':   'rgba(17,24,39,0.14)',
  '--t-overlay':   'rgba(24,32,51,0.42)',
  '--t-accent':    '#4F46E5',
  '--t-accent-2':  '#DB2777',
  '--t-accent-3':  '#0D9488',
  '--t-warn':      '#B7791F',
  '--t-shadow':    'rgba(28,39,64,0.12)',
}

const varsCss = vars => `:root{${Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';')}}`

function injectStyle(id, css) {
  let el = document.getElementById(id)
  if (!el) {
    el = document.createElement('style')
    el.id = id
    document.head.appendChild(el)
  }
  el.textContent = css
}

// Light mode maps the app's hardcoded Tailwind hex classes onto the theme vars.
const LIGHT_OVERRIDES = `
    /* Backgrounds */
    [data-theme="light"] [class*="bg-"][class*="09101F"],
    [data-theme="light"] [class*="bg-"][class*="09101f"],
    [data-theme="light"] [class*="bg-"][class*="0D0F1C"],
    [data-theme="light"] [class*="bg-"][class*="0d0f1c"],
    [data-theme="light"] [class*="bg-"][class*="0F1225"],
    [data-theme="light"] [class*="bg-"][class*="0f1225"] { background-color: var(--t-bg) !important; }

    [data-theme="light"] [class*="bg-"][class*="0E1424"],
    [data-theme="light"] [class*="bg-"][class*="0e1424"] { background-color: var(--t-shell) !important; }

    [data-theme="light"] [class*="bg-"][class*="121829"],
    [data-theme="light"] [class*="bg-"][class*="171B33"],
    [data-theme="light"] [class*="bg-"][class*="171b33"],
    [data-theme="light"] [class*="bg-"][class*="131629"] { background-color: var(--t-surface) !important; }

    [data-theme="light"] [class*="bg-"][class*="1F2444"],
    [data-theme="light"] [class*="bg-"][class*="1f2444"],
    [data-theme="light"] [class*="bg-"][class*="1A2038"],
    [data-theme="light"] [class*="bg-"][class*="1a2038"],
    [data-theme="light"] [class*="bg-"][class*="1A1E35"],
    [data-theme="light"] [class*="bg-"][class*="1a1e35"] { background-color: var(--t-raised) !important; }

    [data-theme="light"] [class*="bg-"][class*="222840"],
    [data-theme="light"] [class*="bg-"][class*="272C52"],
    [data-theme="light"] [class*="bg-"][class*="272c52"],
    [data-theme="light"] [class*="bg-"][class*="222740"] { background-color: var(--t-hover) !important; }

    /* Hover backgrounds */
    [data-theme="light"] [class*="hover:bg-"][class*="1A2038"]:hover,
    [data-theme="light"] [class*="hover:bg-"][class*="1a2038"]:hover,
    [data-theme="light"] [class*="hover:bg-"][class*="1F2444"]:hover,
    [data-theme="light"] [class*="hover:bg-"][class*="1f2444"]:hover,
    [data-theme="light"] [class*="hover:bg-"][class*="1A1E35"]:hover,
    [data-theme="light"] [class*="hover:bg-"][class*="1a1e35"]:hover { background-color: var(--t-raised) !important; }

    [data-theme="light"] [class*="hover:bg-"][class*="222840"]:hover,
    [data-theme="light"] [class*="hover:bg-"][class*="272C52"]:hover,
    [data-theme="light"] [class*="hover:bg-"][class*="272c52"]:hover,
    [data-theme="light"] [class*="hover:bg-"][class*="222740"]:hover { background-color: var(--t-hover) !important; }

    /* Text */
    [data-theme="light"] .text-white  { color: var(--t-text) !important; }
    [data-theme="light"] .text-slate-200 { color: #26304A !important; }
    [data-theme="light"] .text-slate-300 { color: #39445F !important; }
    [data-theme="light"] .text-slate-400 { color: var(--t-muted) !important; }
    [data-theme="light"] .text-slate-500 { color: var(--t-faint) !important; }
    [data-theme="light"] .text-slate-600 { color: #A2ABC0 !important; }
    [data-theme="light"] .header-title-icon,
    [data-theme="light"] .header-title-icon *,
    [data-theme="light"] .brand-mark,
    [data-theme="light"] .brand-mark * { color: #FFFFFF !important; }
    [data-theme="light"] .header-build-button,
    [data-theme="light"] .header-build-button *,
    [data-theme="light"] .section-tab-active,
    [data-theme="light"] .section-tab-active * { color: var(--t-text) !important; }

    /* Purple text — slightly deepen for ivory bg readability */
    [data-theme="light"] .text-\\[\\#6C5CE7\\] { color: #5A4AD4 !important; }
    [data-theme="light"] .text-\\[\\#a89af7\\] { color: #5A4AD4 !important; }

    /* Borders — warm neutral tones, not purple */
    [data-theme="light"] .border-white\\/5  { border-color: rgba(0,0,0,0.07) !important; }
    [data-theme="light"] .border-white\\/8  { border-color: rgba(0,0,0,0.08) !important; }
    [data-theme="light"] .border-white\\/10 { border-color: rgba(0,0,0,0.10) !important; }
    [data-theme="light"] .border-white\\/18 { border-color: rgba(0,0,0,0.14) !important; }
    [data-theme="light"] .border-white\\/20 { border-color: rgba(0,0,0,0.14) !important; }
    [data-theme="light"] .border-white\\/30 { border-color: rgba(0,0,0,0.18) !important; }

    /* Overlays */
    [data-theme="light"] .bg-black\\/60 { background-color: rgba(20,18,14,0.50) !important; }
    [data-theme="light"] .bg-black\\/70 { background-color: rgba(20,18,14,0.56) !important; }
    [data-theme="light"] .bg-black\\/50 { background-color: rgba(20,18,14,0.40) !important; }

    /* Inputs */
    [data-theme="light"] ::placeholder { color: var(--t-faint) !important; opacity: 1; }
    [data-theme="light"] select option { background: #fff; color: #1C1A3A; }

    /* Body */
    [data-theme="light"] body { background-color: var(--t-bg); color: var(--t-text); }
  `

export function applyTheme(theme) {
  const isDark = theme === 'dark'
  document.documentElement.setAttribute('data-theme', theme)
  document.documentElement.style.colorScheme = isDark ? 'dark' : 'light'
  injectStyle('aistrix-theme-vars', varsCss(isDark ? DARK : LIGHT))
  injectStyle('aistrix-theme-overrides', isDark ? '' : LIGHT_OVERRIDES)
  try { document.cookie = `${THEME_COOKIE}=${isDark ? 'dark' : 'light'}; path=/; max-age=31536000; samesite=lax` } catch { /* Cookies may be disabled. */ }
}

// The server renders the saved theme (app/layout.jsx reads this cookie), so a
// light theme never flashes dark on load. localStorage stays the client copy.
export const THEME_COOKIE = 'aistrix_theme'

export function themeHead(theme) {
  const isDark = theme !== 'light'
  return { vars: varsCss(isDark ? DARK : LIGHT), overrides: isDark ? '' : LIGHT_OVERRIDES }
}

export function initTheme() {
  const saved = localStorage.getItem('aistrix_theme') || 'dark'
  applyTheme(saved)
  return saved
}
