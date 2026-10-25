import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { useToast } from '../hooks/useToast'
import { buildCareerContext, buildBusinessContext } from '../utils/profileContext'

const inputCls = 'w-full bg-[#1F2444] border border-white/10 rounded-xl px-3 py-2.5 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-[#6C5CE7] transition-colors'
const textareaCls = `${inputCls} resize-none leading-relaxed`
const labelCls = 'text-xs text-slate-400 block mb-1.5'

function Field({ label, children }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  )
}

function ContextPreview({ text }) {
  if (!text) return null
  return (
    <div className="mt-4 bg-[#0F1225] border border-[#6C5CE7]/20 rounded-xl p-4">
      <p className="text-[10px] text-[#6C5CE7] uppercase font-medium mb-2">Context injected into runs</p>
      <pre className="text-[11px] text-slate-400 whitespace-pre-wrap leading-relaxed">{text}</pre>
    </div>
  )
}

function CareerTab({ user }) {
  const toast = useToast()
  const [form, setForm] = useState({
    full_name: '', job_title: '', experience_years: '', skills: '',
    education: '', location: '', preferred_locations: '', salary_range: '',
    linkedin_url: '', bio: '', resume_text: '',
  })
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase.from('user_career_profiles').select('*').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setForm(f => ({ ...f, ...data })); setLoaded(true) })
  }, [user.id])

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('user_career_profiles').upsert(
      { ...form, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Career profile saved', 'success')
  }

  const preview = buildCareerContext(form)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full name">
          <input className={inputCls} placeholder="Jane Smith" value={form.full_name} onChange={e => set('full_name', e.target.value)} />
        </Field>
        <Field label="Current role">
          <input className={inputCls} placeholder="Senior Product Manager" value={form.job_title} onChange={e => set('job_title', e.target.value)} />
        </Field>
        <Field label="Years of experience">
          <input className={inputCls} placeholder="8 years" value={form.experience_years} onChange={e => set('experience_years', e.target.value)} />
        </Field>
        <Field label="Location">
          <input className={inputCls} placeholder="New York, NY" value={form.location} onChange={e => set('location', e.target.value)} />
        </Field>
        <Field label="Preferred locations">
          <input className={inputCls} placeholder="Remote, Austin TX, NYC" value={form.preferred_locations} onChange={e => set('preferred_locations', e.target.value)} />
        </Field>
        <Field label="Salary range">
          <input className={inputCls} placeholder="$120k–$160k" value={form.salary_range} onChange={e => set('salary_range', e.target.value)} />
        </Field>
        <Field label="LinkedIn URL">
          <input className={inputCls} placeholder="https://linkedin.com/in/..." value={form.linkedin_url} onChange={e => set('linkedin_url', e.target.value)} />
        </Field>
      </div>

      <Field label="Skills">
        <input className={inputCls} placeholder="React, Python, Product Strategy, SQL, Leadership" value={form.skills} onChange={e => set('skills', e.target.value)} />
      </Field>

      <Field label="Education">
        <input className={inputCls} placeholder="BS Computer Science, Stanford University, 2015" value={form.education} onChange={e => set('education', e.target.value)} />
      </Field>

      <Field label="Professional bio">
        <textarea className={textareaCls} rows={3} placeholder="A brief summary of who you are professionally..." value={form.bio} onChange={e => set('bio', e.target.value)} />
      </Field>

      <Field label="Resume / Work history">
        <textarea className={textareaCls} rows={8} placeholder="Paste your resume text here. Apps like Resume Builder, Cover Letter Writer and Interview Coach will use this automatically..." value={form.resume_text} onChange={e => set('resume_text', e.target.value)} />
      </Field>

      <button onClick={save} disabled={saving || !loaded}
        className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-6 py-2.5 rounded-xl font-medium transition-colors">
        {saving ? 'Saving...' : 'Save Career Profile'}
      </button>

      <ContextPreview text={preview} />
    </div>
  )
}

function BusinessTab({ user }) {
  const toast = useToast()
  const [form, setForm] = useState({
    company_name: '', website: '', industry: '', products: '',
    company_description: '', brand_voice: '', target_audience: '',
    brand_colors: '', contact_info: '',
  })
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    supabase.from('user_business_profiles').select('*').eq('user_id', user.id).maybeSingle()
      .then(({ data }) => { if (data) setForm(f => ({ ...f, ...data })); setLoaded(true) })
  }, [user.id])

  function set(k, v) { setForm(prev => ({ ...prev, [k]: v })) }

  async function save() {
    setSaving(true)
    const { error } = await supabase.from('user_business_profiles').upsert(
      { ...form, user_id: user.id, updated_at: new Date().toISOString() },
      { onConflict: 'user_id' }
    )
    setSaving(false)
    if (error) { toast(error.message, 'error'); return }
    toast('Business profile saved', 'success')
  }

  const preview = buildBusinessContext(form)

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Company name">
          <input className={inputCls} placeholder="Acme Inc." value={form.company_name} onChange={e => set('company_name', e.target.value)} />
        </Field>
        <Field label="Website">
          <input className={inputCls} placeholder="https://acme.com" value={form.website} onChange={e => set('website', e.target.value)} />
        </Field>
        <Field label="Industry">
          <input className={inputCls} placeholder="SaaS / B2B Software" value={form.industry} onChange={e => set('industry', e.target.value)} />
        </Field>
        <Field label="Contact info">
          <input className={inputCls} placeholder="hello@acme.com" value={form.contact_info} onChange={e => set('contact_info', e.target.value)} />
        </Field>
      </div>

      <Field label="Products / Services">
        <input className={inputCls} placeholder="Project management software for remote teams" value={form.products} onChange={e => set('products', e.target.value)} />
      </Field>

      <Field label="Brand voice">
        <input className={inputCls} placeholder="Professional yet approachable, clear, jargon-free" value={form.brand_voice} onChange={e => set('brand_voice', e.target.value)} />
      </Field>

      <Field label="Target audience">
        <input className={inputCls} placeholder="Startup founders and team leads at 10–100 person companies" value={form.target_audience} onChange={e => set('target_audience', e.target.value)} />
      </Field>

      <Field label="Brand colors">
        <input className={inputCls} placeholder="#6C5CE7, #FFFFFF, #0F1225" value={form.brand_colors} onChange={e => set('brand_colors', e.target.value)} />
      </Field>

      <Field label="Company description">
        <textarea className={textareaCls} rows={5} placeholder="A full description of your company — what you do, who you serve, and your unique value proposition. All business apps will use this automatically..." value={form.company_description} onChange={e => set('company_description', e.target.value)} />
      </Field>

      <button onClick={save} disabled={saving || !loaded}
        className="bg-[#6C5CE7] hover:bg-[#7D6FF0] disabled:opacity-40 text-white text-sm px-6 py-2.5 rounded-xl font-medium transition-colors">
        {saving ? 'Saving...' : 'Save Business Profile'}
      </button>

      <ContextPreview text={preview} />
    </div>
  )
}

export default function ProfilesPage({ user }) {
  const [tab, setTab] = useState('career')

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-white text-xl font-semibold">Shared Profiles</h1>
        <p className="text-slate-400 text-sm mt-0.5">
          Fill in your profiles once — every app uses them automatically. No more repeating your background with every run.
        </p>
      </div>

      <div className="flex gap-1 mb-6 bg-[#1F2444] p-1 rounded-xl w-fit">
        {[
          { id: 'career', icon: '💼', label: 'Career Profile' },
          { id: 'business', icon: '🏢', label: 'Business Profile' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.id ? 'bg-[#6C5CE7] text-white' : 'text-slate-400 hover:text-white'}`}>
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-6">
        {tab === 'career'   && <CareerTab   user={user} />}
        {tab === 'business' && <BusinessTab user={user} />}
      </div>
    </div>
  )
}

