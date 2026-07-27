import { useState } from 'react'
import { useToast } from '../hooks/useToast'

const INTEGRATIONS = [
  {
    category: 'Communication',
    items: [
      { id: 'slack', name: 'Slack', icon: '💬', desc: 'Send app results directly to Slack channels or DMs', status: 'soon', color: '#4A154B' },
      { id: 'email', name: 'Email / SMTP', icon: '📧', desc: 'Email results to any address after a run completes', status: 'soon', color: '#EA4335' },
      { id: 'teams', name: 'Microsoft Teams', icon: '🟦', desc: 'Post AI results to Teams channels', status: 'soon', color: '#6264A7' },
    ],
  },
  {
    category: 'Productivity',
    items: [
      { id: 'notion', name: 'Notion', icon: '◻', desc: 'Save structured outputs directly to Notion databases', status: 'soon', color: '#000000' },
      { id: 'google_docs', name: 'Google Docs', icon: '📄', desc: 'Export AI results to Google Docs with one click', status: 'soon', color: '#4285F4' },
      { id: 'airtable', name: 'Airtable', icon: '⬡', desc: 'Write table output to Airtable bases automatically', status: 'soon', color: '#FCB400' },
    ],
  },
  {
    category: 'Automation',
    items: [
      { id: 'zapier', name: 'Zapier', icon: '⚡', desc: 'Trigger Zaps when an app run completes', status: 'soon', color: '#FF4A00' },
      { id: 'make', name: 'Make (Integromat)', icon: '🔄', desc: 'Connect Aistrix to 1,000+ apps via Make scenarios', status: 'soon', color: '#6D00CC' },
      { id: 'n8n', name: 'n8n', icon: '🔗', desc: 'Self-hosted workflow automation with Aistrix nodes', status: 'soon', color: '#EA4B71' },
    ],
  },
  {
    category: 'Data & CRM',
    items: [
      { id: 'salesforce', name: 'Salesforce', icon: '☁️', desc: 'Push AI-generated data to Salesforce records', status: 'soon', color: '#00A1E0' },
      { id: 'hubspot', name: 'HubSpot', icon: '🟠', desc: 'Enrich contacts and deals with AI outputs', status: 'soon', color: '#FF7A59' },
      { id: 'sheets', name: 'Google Sheets', icon: '📊', desc: 'Append table results to Google Sheets automatically', status: 'soon', color: '#0F9D58' },
    ],
  },
  {
    category: 'Developer',
    items: [
      { id: 'webhook', name: 'Webhooks', icon: '🔗', desc: 'POST run results to any URL — already available per app', status: 'live', color: '#6C5CE7' },
      { id: 'api', name: 'REST API', icon: '{ }', desc: 'Call any Aistrix app programmatically with your API key', status: 'live', color: '#6C5CE7' },
      { id: 'github', name: 'GitHub Actions', icon: '🐙', desc: 'Run Aistrix apps as part of your CI/CD pipeline', status: 'soon', color: '#24292E' },
    ],
  },
]

export default function IntegrationsPage() {
  const [search, setSearch] = useState('')
  const toast = useToast()

  const filtered = INTEGRATIONS.map(cat => ({
    ...cat,
    items: cat.items.filter(i =>
      !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.desc.toLowerCase().includes(search.toLowerCase())
    ),
  })).filter(cat => cat.items.length > 0)

  function handleConnect(integration) {
    if (integration.status === 'live') {
      toast(`${integration.name} is already available — check the Developer section`, 'info')
    } else {
      toast(`${integration.name} integration is coming soon. You'll be notified when it's ready.`, 'info', 4000)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6">
      <div>
        <h1 className="text-white text-xl font-semibold">Integrations</h1>
        <p className="text-slate-400 text-sm mt-0.5">Connect Aistrix to the tools you already use.</p>
      </div>

      <div className="flex items-center gap-2 bg-[#171B33] border border-white/10 rounded-xl px-4 py-2.5 max-w-sm">
        <span className="text-slate-500">🔍</span>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search integrations..."
          className="flex-1 bg-transparent text-sm text-white placeholder-slate-500 focus:outline-none" />
      </div>

      {filtered.map(cat => (
        <div key={cat.category}>
          <p className="text-xs text-slate-500 uppercase font-medium mb-3">{cat.category}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {cat.items.map(item => (
              <div key={item.id} className={`bg-[#171B33] border rounded-2xl p-4 flex flex-col transition-all
                ${item.status === 'live' ? 'border-[#6C5CE7]/30' : 'border-white/5'}`}>
                <div className="flex items-start gap-3 mb-3">
                  <div className="w-9 h-9 rounded-xl flex items-center justify-center text-xl shrink-0"
                    style={{ background: item.color + '22' }}>
                    {item.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-white font-medium text-sm">{item.name}</p>
                      {item.status === 'live' && (
                        <span className="text-[9px] text-green-400 bg-green-400/10 px-1.5 py-0.5 rounded-full font-medium">Live</span>
                      )}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 flex-1 leading-relaxed mb-3">{item.desc}</p>
                <button onClick={() => handleConnect(item)}
                  className={`w-full text-xs py-2 rounded-xl font-medium transition-colors
                    ${item.status === 'live'
                      ? 'bg-[#6C5CE7] hover:bg-[#7D6FF0] text-white'
                      : 'bg-[#1F2444] hover:bg-[#272C52] text-slate-400 hover:text-white'}`}>
                  {item.status === 'live' ? 'Configure →' : 'Notify me'}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      <div className="bg-[#171B33] border border-white/5 rounded-2xl p-6 text-center">
        <p className="text-white font-medium mb-1">Don't see what you need?</p>
        <p className="text-slate-400 text-sm mb-4">Use our webhook system to connect Aistrix to any service.</p>
        <p className="text-[11px] text-slate-500">
          Every app can POST results to a webhook URL — works with Zapier, n8n, Make, and any custom endpoint.
          Set it in <strong className="text-slate-400">Create App → Step 2 → Webhook URL</strong>.
        </p>
      </div>
    </div>
  )
}
