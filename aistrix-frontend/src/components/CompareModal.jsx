import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { timeAgo } from '../utils'

export default function CompareModal({ runs, onClose }) {
  const [a, b] = runs

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60] p-4">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-5xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between p-5 border-b border-white/5">
          <div>
            <p className="text-white font-medium">Run Comparison</p>
            <p className="text-xs text-slate-400">{a.app_name} · side-by-side</p>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-slate-500 hover:text-white text-lg">✕</button>
        </div>

        <div className="overflow-y-auto flex-1 p-5">
          {/* Inputs */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            {[a, b].map((run, i) => (
              <div key={run.id} className="bg-[#1F2444] rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${i === 0 ? 'bg-blue-500/20 text-blue-400' : 'bg-purple-500/20 text-purple-400'}`}>
                    Run {i + 1}
                  </span>
                  <span className="text-[10px] text-slate-500">{timeAgo(run.created_at)}</span>
                </div>
                <p className="text-xs text-slate-400 uppercase mb-1">Input</p>
                <p className="text-xs text-slate-200 leading-relaxed">{run.input}</p>
              </div>
            ))}
          </div>

          {/* Results */}
          <div className="grid grid-cols-2 gap-4">
            {[a, b].map((run) => (
              <div key={run.id} className="bg-[#1F2444] rounded-xl p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] text-slate-500 uppercase">Result</p>
                  <button
                    onClick={() => navigator.clipboard.writeText(run.output || '')}
                    className="text-[10px] text-slate-500 hover:text-slate-300"
                  >📋 Copy</button>
                </div>
                <div className="text-xs text-slate-200 leading-relaxed prose-result">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{run.output || ''}</ReactMarkdown>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
