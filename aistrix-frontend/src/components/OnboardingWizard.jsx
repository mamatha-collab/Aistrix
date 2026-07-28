import { useState } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'

const GOALS = [
  { id: 'career',    emoji: '💼', label: 'Career Growth',       desc: 'Find jobs, write resumes, prep for interviews', packName: 'Career Success Pack',    domain: 'career' },
  { id: 'marketing', emoji: '📈', label: 'Marketing & Content', desc: 'Create content, campaigns, SEO, social media',  packName: 'Marketing Power Pack',   domain: 'marketing' },
  { id: 'business',  emoji: '🏢', label: 'Run a Business',      desc: 'Proposals, invoices, contracts, operations',    packName: 'Small Business Pack',    domain: 'business' },
  { id: 'research',  emoji: '🔬', label: 'Research & Analysis', desc: 'Analyze data, summarize papers, create reports', packName: 'Research & Analytics Pack', domain: 'research' },
  { id: 'developer', emoji: '👨‍💻', label: 'Build Software',      desc: 'Code review, testing, docs, architecture',      packName: 'Developer Toolkit Pack', domain: 'developer' },
  { id: 'content',   emoji: '✍️', label: 'Create Content',       desc: 'Blog posts, scripts, captions, calendar',       packName: 'Content Creator Pack',   domain: 'content' },
  { id: 'explore',   emoji: '🚀', label: 'Just Exploring',       desc: 'Browse all apps and see what is possible',       packName: null, domain: null },
]

export default function OnboardingWizard({ user, onDismiss, onNavChange }) {
  const [step, setStep] = useState(1)
  const [selected, setSelected] = useState(null)
  const [installing, setInstalling] = useState(false)
  const [goalCreated, setGoalCreated] = useState(false)
  const [profileSaved, setProfileSaved] = useState(false)
  const [profileForm, setProfileForm] = useState({ display_name: user?.user_metadata?.display_name || '', job_title: '', company: '' })
  const toast = useToast()

  const goal = GOALS.find(g => g.id === selected)

  async function installWorkspace() {
    if (!goal?.packName || !user) return
    setInstalling(true)
    try {
      const { data: flow } = await supabase.from('flows')
        .select('*').eq('name', goal.packName).eq('is_published', true).maybeSingle()
      if (flow) {
        const { error } = await supabase.from('flows').insert({
          user_id: user.id, name: flow.name, emoji: flow.emoji,
          description: flow.description, steps: flow.steps,
        })
        if (error) toast(`Couldn't install ${goal.packName}: ${error.message}`, 'error')
        else toast(`${goal.packName} installed to your AI Workflows!`, 'success')
      }
    } catch (e) { toast(e.message, 'error') }
    setInstalling(false)
    setStep(3)
  }

  async function saveProfile() {
    if (profileForm.display_name.trim()) {
      const { error } = await supabase.auth.updateUser({ data: { display_name: profileForm.display_name.trim() } })
      if (error) toast(`Couldn't save display name: ${error.message}`, 'error')
    }
    if (profileForm.job_title.trim() || profileForm.company.trim()) {
      const { error } = await supabase.from('career_profiles').upsert({
        user_id: user.id,
        job_title: profileForm.job_title.trim() || null,
        company: profileForm.company.trim() || null,
      }, { onConflict: 'user_id' })
      if (error) toast(`Couldn't save profile: ${error.message}`, 'error')
    }
    setProfileSaved(true)
    setTimeout(() => setStep(4), 600)
  }

  async function createGoal() {
    const { error } = await supabase.from('user_goals').insert({
      user_id: user.id,
      name: `Weekly ${goal?.label || 'AI'} sessions`,
      target_runs: 10,
      period: 'week',
      is_active: true,
    })
    if (error) toast(`Couldn't create goal: ${error.message}`, 'error')
    setGoalCreated(true)
    setTimeout(() => setStep(5), 800)
  }

  function finish() {
    localStorage.setItem('aistrix_welcomed', '1')
    localStorage.setItem('aistrix_onboarding_done', '1')
    if (goal?.domain && onNavChange) {
      onNavChange('apps')
    }
    onDismiss()
    toast('Welcome to Aistrix! 🎉', 'success', 4000)
  }

  const STEPS = goal?.packName ? 5 : 2

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-[#171B33] border border-white/10 rounded-2xl w-full max-w-lg overflow-hidden">

        {/* Progress bar */}
        <div className="h-1 bg-[#1F2444]">
          <div className="h-full bg-gradient-to-r from-[#6C5CE7] to-[#E84393] transition-all duration-500"
            style={{ width: `${(step / STEPS) * 100}%` }} />
        </div>

        <div className="p-6">

          {/* Step 1 — What do you want to accomplish? */}
          {step === 1 && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="w-14 h-14 rounded-2xl bg-[#6C5CE7] flex items-center justify-center text-white font-bold text-2xl mx-auto mb-4">A</div>
                <h2 className="text-white text-xl font-bold mb-1">Welcome to Aistrix</h2>
                <p className="text-slate-400 text-sm">What do you want to accomplish? We'll set everything up for you.</p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {GOALS.map(g => (
                  <button key={g.id} onClick={() => setSelected(g.id)}
                    className={`text-left p-3.5 rounded-xl border transition-all ${selected === g.id ? 'border-[#6C5CE7] bg-[#6C5CE7]/10' : 'border-white/5 bg-[#1F2444] hover:border-white/20'}`}>
                    <div className="text-2xl mb-2">{g.emoji}</div>
                    <p className={`text-sm font-semibold mb-0.5 ${selected === g.id ? 'text-white' : 'text-slate-300'}`}>{g.label}</p>
                    <p className="text-[10px] text-slate-500 leading-tight">{g.desc}</p>
                  </button>
                ))}
              </div>

              <button onClick={() => selected === 'explore' ? finish() : setStep(2)}
                disabled={!selected}
                className="w-full bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white py-3 rounded-xl font-semibold transition-colors">
                {selected === 'explore' ? 'Start exploring →' : 'Continue →'}
              </button>
            </div>
          )}

          {/* Step 2 — Install starter pack */}
          {step === 2 && goal && (
            <div className="space-y-5 text-center">
              <div className="text-5xl mb-1">{goal.emoji}</div>
              <div>
                <h2 className="text-white text-xl font-bold mb-1">Perfect match found</h2>
                <p className="text-slate-400 text-sm">We built a complete <strong className="text-white">{goal.packName}</strong> for you with 5 linked AI apps.</p>
              </div>

              <div className="bg-[#1F2444] border border-white/5 rounded-xl p-4 text-left space-y-2">
                <p className="text-[10px] text-slate-500 uppercase font-medium">What's included</p>
                {goal.id === 'career'    && ['📄 Resume Builder', '✍️ Cover Letter Writer', '🔵 LinkedIn Optimizer', '🎤 Interview Coach', '💰 Salary Research Agent'].map(a => <p key={a} className="text-xs text-slate-300">{a}</p>)}
                {goal.id === 'marketing' && ['📱 Social Caption Writer', '📝 Blog Post Generator', '📧 Email Campaign Writer', '🔍 SEO Analyzer', '🎯 Ad Copy Generator'].map(a => <p key={a} className="text-xs text-slate-300">{a}</p>)}
                {goal.id === 'business'  && ['🧾 Invoice Generator', '📋 Proposal Writer', '💬 Customer Support Agent', '📜 Contract Generator', '📊 Business Analyzer'].map(a => <p key={a} className="text-xs text-slate-300">{a}</p>)}
                {goal.id === 'research'  && ['📈 Data Analyzer', '📚 Research Summarizer', '🔭 Competitive Intel Agent', '📋 Survey Analyzer', '📄 Report Builder'].map(a => <p key={a} className="text-xs text-slate-300">{a}</p>)}
                {goal.id === 'developer' && ['🔍 Code Reviewer', '📖 API Docs Generator', '🐛 Bug Analyzer', '✅ Test Generator', '🗃️ Schema Designer'].map(a => <p key={a} className="text-xs text-slate-300">{a}</p>)}
                {goal.id === 'content'   && ['📝 Blog Post Writer', '🎬 YouTube Script Writer', '📲 Social Repurposer', '📅 Content Calendar', '⚡ Viral Hook Generator'].map(a => <p key={a} className="text-xs text-slate-300">{a}</p>)}
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="flex-1 bg-[#1F2444] hover:bg-[#272C52] text-slate-300 py-2.5 rounded-xl text-sm transition-colors">← Back</button>
                <button onClick={installWorkspace} disabled={installing}
                  className="flex-1 bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-50 text-white py-2.5 rounded-xl font-semibold text-sm transition-colors">
                  {installing ? 'Installing...' : '↓ Install workflow'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Quick profile setup */}
          {step === 3 && (
            <div className="space-y-5">
              <div className="text-center">
                <div className="text-5xl mb-3">👤</div>
                <h2 className="text-white text-xl font-bold mb-1">Tell us about yourself</h2>
                <p className="text-slate-400 text-sm">Apps use this to personalize results automatically — enter once, used everywhere.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1 uppercase">Your name</label>
                  <input
                    className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                    placeholder="e.g. Alex Johnson"
                    value={profileForm.display_name}
                    onChange={e => setProfileForm(f => ({ ...f, display_name: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1 uppercase">Job title</label>
                  <input
                    className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                    placeholder="e.g. Marketing Manager"
                    value={profileForm.job_title}
                    onChange={e => setProfileForm(f => ({ ...f, job_title: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] text-slate-400 block mb-1 uppercase">Company</label>
                  <input
                    className="w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors"
                    placeholder="e.g. Acme Corp"
                    value={profileForm.company}
                    onChange={e => setProfileForm(f => ({ ...f, company: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(4)} className="flex-1 bg-[#1F2444] hover:bg-[#272C52] text-slate-400 py-2.5 rounded-xl text-sm transition-colors">Skip for now</button>
                <button onClick={saveProfile}
                  className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${profileSaved ? 'bg-green-500 text-white' : 'bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white'}`}>
                  {profileSaved ? '✓ Saved!' : 'Save & continue →'}
                </button>
              </div>
            </div>
          )}

          {/* Step 4 — Set a goal */}
          {step === 4 && (
            <div className="space-y-5 text-center">
              <div className="text-5xl">🎯</div>
              <div>
                <h2 className="text-white text-xl font-bold mb-1">Set your first goal</h2>
                <p className="text-slate-400 text-sm">Goals help you build a habit. We'll track your progress automatically.</p>
              </div>

              <div className="bg-[#1F2444] border border-[#6C5CE7]/30 rounded-xl p-4 text-left">
                <p className="text-white font-medium text-sm mb-1">Weekly {goal?.label || 'AI'} sessions</p>
                <p className="text-slate-400 text-xs">Run at least 10 AI apps this week to build momentum</p>
                <div className="mt-3 h-1.5 bg-[#0F1225] rounded-full">
                  <div className="h-full w-0 bg-[#6C5CE7] rounded-full" />
                </div>
                <p className="text-[10px] text-slate-600 mt-1 text-right">0 / 10 this week</p>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setStep(5)} className="flex-1 bg-[#1F2444] hover:bg-[#272C52] text-slate-400 py-2.5 rounded-xl text-sm transition-colors">Skip</button>
                <button onClick={createGoal}
                  className={`flex-1 py-2.5 rounded-xl font-semibold text-sm transition-all ${goalCreated ? 'bg-green-500 text-white' : 'bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white'}`}>
                  {goalCreated ? '✓ Goal created!' : 'Create goal'}
                </button>
              </div>
            </div>
          )}

          {/* Step 5 — You're ready */}
          {step === 5 && (
            <div className="space-y-5 text-center">
              <div className="text-6xl">🎉</div>
              <div>
                <h2 className="text-white text-2xl font-bold mb-2">You're all set!</h2>
                <p className="text-slate-400 text-sm leading-relaxed">
                  Your workflow is installed, your goal is set. Time to run your first app.
                </p>
              </div>

              <div className="bg-[#1F2444] border border-white/5 rounded-xl p-4 text-left space-y-2">
                <p className="text-[10px] text-slate-500 uppercase font-medium">Quick tips</p>
                <p className="text-xs text-slate-300">💼 Fill in your <strong>Profile</strong> — apps use it automatically for personalized results</p>
                <p className="text-xs text-slate-300">⚡ Open <strong>Workflows</strong> in the sidebar to run your full workflow</p>
                <p className="text-xs text-slate-300">🔑 Add your API key in <strong>Settings</strong> for unlimited free runs</p>
              </div>

              <button onClick={finish}
                className="w-full bg-gradient-to-r from-[#6C5CE7] to-[#E84393] text-white py-3.5 rounded-xl font-bold text-base transition-opacity hover:opacity-90">
                Start using Aistrix →
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
