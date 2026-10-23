import { Component } from 'react'
import * as Sentry from '@sentry/react'
import { isChunkLoadError, reloadOnceForNewVersion } from '../utils/chunkReload'

import { BRAND } from '../lib/brand'
// Catches a crash in its children so only that part of the page shows an
// error. Sizes:
//   (default)  full page — last resort around the whole site
//   compact    a section or page inside the layout; navigation keeps working
//   card       one card; the rest of the step keeps working
//   overlay    a modal/window; shows a small error window with Close (onClose)
//   quiet      a small optional widget (a header button, a notice): it disappears
//              instead of breaking the bar it sits in (the error is still reported)
// resetKey: changing it (another app, another tab) clears the error.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  componentDidUpdate(prevProps) {
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // A new version was deployed while this tab was open: its old code files
    // are gone. Reload once to pick up the new ones instead of showing an error.
    if (isChunkLoadError(error) && reloadOnceForNewVersion()) return
    console.error('App error:', error, info)
    Sentry.captureException(error, { extra: { ...info, boundary: this.props.title || this.props.variant || 'page' } })
  }

  render() {
    const { error } = this.state
    if (!error) return this.props.children
    const message = isChunkLoadError(error)
      ? `${BRAND} was updated. Reload the page to get the latest version.`
      : (error?.message || 'Unknown error')
    const variant = this.props.variant || (this.props.card ? 'card' : this.props.compact ? 'compact' : 'page')
    const retry = () => this.setState({ error: null })
    if (variant === 'quiet') return null

    if (variant === 'card') {
      return (
        <div role="alert" className="bg-[#171B33] border border-red-500/20 rounded-2xl p-4">
          <div className="flex items-start gap-2.5">
            <span className="text-base leading-none mt-0.5">⚠️</span>
            <div className="flex-1 min-w-0">
              <p className="text-white text-xs font-semibold">{this.props.title || "This part couldn't load"}</p>
              <p className="text-slate-400 text-[11px] mt-0.5">The rest of this page still works.</p>
              <p className="text-red-300/80 text-[10px] font-mono mt-2 break-all">{message}</p>
              <button onClick={retry}
                className="mt-3 text-[11px] font-semibold px-2.5 py-1 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
                Try again
              </button>
            </div>
          </div>
        </div>
      )
    }

    if (variant === 'compact' || variant === 'overlay') {
      const card = (
        <div role="alert" className="bg-[#171B33] border border-red-500/20 rounded-2xl p-6 w-full">
          <div className="flex items-start gap-3">
            <div className="text-2xl">⚠️</div>
            <div className="flex-1 min-w-0">
              <h2 className="text-white text-sm font-semibold">{this.props.title || 'This section could not load'}</h2>
              <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                The rest of {BRAND} is still available. Try again, or refresh after saving your work.
              </p>
              <p className="text-red-300/80 text-[11px] font-mono mt-3 break-all">{message}</p>
              <div className="flex gap-2 mt-4">
                <button onClick={retry}
                  className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors">
                  Try again
                </button>
                {this.props.onClose && (
                  <button onClick={() => { this.setState({ error: null }); this.props.onClose() }}
                    className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-slate-300 border border-white/10 transition-colors">
                    Close
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )
      return variant === 'overlay'
        ? <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"><div className="w-full max-w-md">{card}</div></div>
        : card
    }

    return (
      <div className="min-h-screen bg-[#0F1225] flex items-center justify-center p-6">
        <div className="bg-[#171B33] border border-white/10 rounded-2xl p-8 w-full max-w-md text-center">
          <div className="text-4xl mb-4">⚠️</div>
          <h1 className="text-white text-lg font-semibold mb-2">Something went wrong</h1>
          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            An unexpected error occurred. Refreshing the page usually fixes it.
          </p>
          <div className="bg-[#0F1225] rounded-xl p-3 mb-6 text-left">
            <p className="text-red-400 text-xs font-mono leading-relaxed break-all">{message}</p>
          </div>
          <button
            onClick={() => window.location.reload()}
            className="w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white text-sm py-2.5 rounded-xl font-medium transition-colors"
          >
            Reload page
          </button>
        </div>
      </div>
    )
  }
}
