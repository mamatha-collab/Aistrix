import ErrorBoundary from './ErrorBoundary'

function Render({ fn, name }) {
  // Development only (removed from production builds): set localStorage
  // 'aistrix_crash_card' to a card's name to check it fails on its own.
  if (import.meta.env.DEV && name && (() => { try { return localStorage.getItem('aistrix_crash_card') === name } catch { return false } })()) {
    throw new Error(`Test crash in "${name}"`)
  }
  return fn()
}

// One card that can fail on its own: if it crashes, it shows a small error
// card and the rest of the step keeps working.
//
// Pass a function as the child for JSX written inline in a bigger component:
// it then renders inside the boundary, so its errors are caught too.
//   <SafeCard name="Output contract">{() => (<div>…</div>)}</SafeCard>
export default function SafeCard({ name, resetKey, children }) {
  return (
    <ErrorBoundary variant="card" title={name ? `${name} couldn't load` : undefined} resetKey={resetKey}>
      {typeof children === 'function' ? <Render fn={children} name={name} /> : children}
    </ErrorBoundary>
  )
}
