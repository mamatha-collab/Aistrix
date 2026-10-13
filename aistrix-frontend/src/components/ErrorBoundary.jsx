import { Component } from 'react'
import * as Sentry from '@sentry/react'

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
    console.error('App error:', error, info)
    Sentry.captureException(error, { extra: info })
  }

  render() {
    if (this.state.error) {
      if (this.props.compact) {
        return (
          <div className="bg-[#171B33] border border-red-500/20 rounded-2xl p-6">
            <div className="flex items-start gap-3">
              <div className="text-2xl">⚠️</div>
              <div className="flex-1 min-w-0">
                <h2 className="text-white text-sm font-semibold">{this.props.title || 'This section could not load'}</h2>
                <p className="text-slate-400 text-xs mt-1 leading-relaxed">
                  The rest of Aistrix is still available. Try reopening this section or refresh after saving your work.
                </p>
                <p className="text-red-300/80 text-[11px] font-mono mt-3 break-all">
                  {this.state.error?.message || 'Unknown error'}
                </p>
                <button
                  onClick={() => this.setState({ error: null })}
                  className="mt-4 text-xs font-semibold px-3 py-1.5 rounded-lg bg-[#6C5CE7]/15 hover:bg-[#6C5CE7]/25 text-[#A29BFE] border border-[#6C5CE7]/25 transition-colors"
                >
                  Try again
                </button>
              </div>
            </div>
          </div>
        )
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
              <p className="text-red-400 text-xs font-mono leading-relaxed break-all">
                {this.state.error?.message || 'Unknown error'}
              </p>
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
    return this.props.children
  }
}
