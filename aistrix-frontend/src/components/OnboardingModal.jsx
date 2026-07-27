import { useState } from 'react'

const WORK_APPS = [
  { id: 'resume',   emoji: '📄', name: 'Resume Builder',            desc: 'Create polished resumes tailored to any job posting.' },
  { id: 'email',    emoji: '✉️',  name: 'Email Writer',              desc: 'Draft professional emails in seconds with the right tone.' },
  { id: 'meeting',  emoji: '🗒️', name: 'Meeting Notes Summarizer',  desc: 'Turn messy meeting notes into clean action items.' },
  { id: 'data',     emoji: '📊', name: 'Data Analyst',              desc: 'Analyze datasets and surface insights instantly.' },
  { id: 'project',  emoji: '🗂️', name: 'Project Planner',           desc: 'Break any goal into a structured, actionable project plan.' },
  { id: 'proposal', emoji: '📝', name: 'Proposal Writer',           desc: 'Write compelling business proposals and pitches.' },
]

const PERSONAL_APPS = [
  { id: 'study',    emoji: '📚', name: 'Study Guide Creator',       desc: 'Turn any topic into a comprehensive study guide.' },
  { id: 'tutor',    emoji: '🌍', name: 'Language Tutor',            desc: 'Practice any language with an adaptive AI tutor.' },
  { id: 'recipe',   emoji: '🍳', name: 'Recipe Suggester',          desc: 'Get personalized recipe ideas based on what you have.' },
  { id: 'fitness',  emoji: '💪', name: 'Fitness Planner',           desc: 'Build a workout plan that fits your goals and schedule.' },
  { id: 'books',    emoji: '📖', name: 'Book Recommender',          desc: 'Discover your next favorite book based on your taste.' },
  { id: 'journal',  emoji: '✍️',  name: 'Daily Journal',             desc: 'Guided prompts and reflections for a meaningful journaling habit.' },
]

export default function OnboardingModal({ onComplete }) {
  const [step, setStep] = useState(1)
  const [useCase, setUseCase] = useState(null)      // 'work' | 'personal'
  const [selected, setSelected] = useState(new Set())

  const appList = useCase === 'work' ? WORK_APPS : PERSONAL_APPS

  function toggleApp(id) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) { next.delete(id) } else if (next.size < 3) { next.add(id) }
      return next
    })
  }

  function handleComplete() {
    const picks = appList.filter(a => selected.has(a.id))
    onComplete?.(picks)
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden">

        {/* Progress dots */}
        <div className="flex items-center gap-2 px-8 pt-6">
          {[1, 2, 3].map(n => (
            <div key={n} className={`h-1 flex-1 rounded-full transition-all ${n <= step ? 'bg-[#6C5CE7]' : 'bg-white/10'}`} />
          ))}
        </div>

        {/* ── Step 1: Welcome ── */}
        {step === 1 && (
          <div className="px-8 py-6">
            <div className="text-5xl mb-4 text-center">✦</div>
            <h1 className="text-white font-bold text-2xl text-center mb-2">Welcome to Aistrix</h1>
            <p className="text-slate-400 text-sm text-center mb-8">Your personal AI app builder. Let's get you set up in 60 seconds.</p>

            <p className="text-slate-300 text-sm font-medium mb-3">What will you mainly use Aistrix for?</p>
            <div className="grid grid-cols-2 gap-3 mb-8">
              {[
                { id: 'work',     emoji: '🏢', label: 'Work & Business' },
                { id: 'personal', emoji: '🎓', label: 'Learning & Personal' },
              ].map(opt => (
                <button key={opt.id} onClick={() => setUseCase(opt.id)}
                  className={`flex flex-col items-center gap-3 p-5 rounded-xl border-2 transition-all cursor-pointer
                    ${useCase === opt.id
                      ? 'border-[#6C5CE7] bg-[#6C5CE7]/10'
                      : 'border-white/10 bg-[#1F2444] hover:border-white/20'}`}>
                  <span className="text-3xl">{opt.emoji}</span>
                  <span className="text-white font-medium text-sm">{opt.label}</span>
                </button>
              ))}
            </div>

            <button onClick={() => setStep(2)} disabled={!useCase}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40"
              style={{ background: 'linear-gradient(135deg, #6C5CE7, #E84393)' }}>
              Continue →
            </button>
          </div>
        )}

        {/* ── Step 2: Pick apps ── */}
        {step === 2 && (
          <div className="px-8 py-6">
            <h1 className="text-white font-bold text-xl mb-1">Choose your first AI app</h1>
            <p className="text-slate-400 text-sm mb-5">Pick up to 3 to get started. You can always build more later.</p>

            <div className="grid grid-cols-2 gap-2.5 mb-6 max-h-72 overflow-y-auto pr-1">
              {appList.map(app => (
                <button key={app.id} onClick={() => toggleApp(app.id)}
                  className={`flex flex-col items-start gap-1.5 p-3 rounded-xl border text-left transition-all
                    ${selected.has(app.id)
                      ? 'border-[#6C5CE7] bg-[#6C5CE7]/10'
                      : 'border-white/8 bg-[#1F2444] hover:border-white/18'}`}>
                  <span className="text-xl">{app.emoji}</span>
                  <span className="text-white text-xs font-semibold leading-snug">{app.name}</span>
                  <span className="text-slate-500 text-[10px] leading-snug line-clamp-2">{app.desc}</span>
                </button>
              ))}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)}
                className="flex-none px-4 py-2.5 rounded-xl border border-white/10 text-slate-400 hover:text-white text-sm transition-colors">
                Back
              </button>
              <button onClick={() => setStep(3)} disabled={selected.size === 0}
                className="flex-1 py-2.5 rounded-xl font-semibold text-sm text-white transition-all disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #6C5CE7, #E84393)' }}>
                Continue ({selected.size} selected) →
              </button>
            </div>
          </div>
        )}

        {/* ── Step 3: Ready ── */}
        {step === 3 && (
          <div className="px-8 py-6">
            <div className="text-5xl mb-4 text-center">🎉</div>
            <h1 className="text-white font-bold text-2xl text-center mb-2">You're all set!</h1>
            <p className="text-slate-400 text-sm text-center mb-6">Here are the apps we've queued up for you:</p>

            <div className="space-y-2 mb-8">
              {appList.filter(a => selected.has(a.id)).map(app => (
                <div key={app.id} className="flex items-center gap-3 bg-[#1F2444] border border-white/8 rounded-xl px-4 py-3">
                  <span className="text-xl">{app.emoji}</span>
                  <div>
                    <p className="text-white text-sm font-medium">{app.name}</p>
                    <p className="text-slate-500 text-[10px]">{app.desc}</p>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={handleComplete}
              className="w-full py-3 rounded-xl font-semibold text-sm text-white transition-all"
              style={{ background: 'linear-gradient(135deg, #6C5CE7, #E84393)' }}>
              Open Aistrix ✦
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
