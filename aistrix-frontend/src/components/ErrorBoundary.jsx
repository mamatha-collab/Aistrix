import { Component } from 'react'
import * as Sentry from '@sentry/react'

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
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
