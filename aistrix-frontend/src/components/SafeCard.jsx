import ErrorBoundary from './ErrorBoundary'

// Development only (removed from production builds): set localStorage
// 'aistrix_crash_card' to a card's name to check it fails on its own.
function crashForTest(name) {
  if ((process.env.NODE_ENV !== 'production') && name && (() => { try { return localStorage.getItem('aistrix_crash_card') === name } catch { return false } })()) {
    throw new Error(`Test crash in "${name}"`)
  }
}

function Render({ fn, name }) {
  crashForTest(name)
  return fn()
}

function Probe({ name, children }) {
  crashForTest(name)
  return children
}

// One card that can fail on its own: if it crashes, it shows a small error
// card and the rest of the step keeps working.
//
// Pass a function as the child for JSX written inline in a bigger component:
// it then renders inside the boundary, so its errors are caught too.
//   <SafeCard name="Output contract">{() => (<div>…</div>)}</SafeCard>
// quiet: a small optional widget that simply disappears if it breaks.
export default function SafeCard({ name, resetKey, quiet = false, children }) {
  return (
    <ErrorBoundary variant={quiet ? 'quiet' : 'card'} title={name ? `${name} couldn't load` : undefined} resetKey={resetKey}>
      {typeof children === 'function' ? <Render fn={children} name={name} /> : <Probe name={name}>{children}</Probe>}
    </ErrorBoundary>
  )
}
