// The second row's section ribbon, same look as Dev Studio's Build /
// Operate & Grow / Manage tabs. groups: [{ id, label, tabs: [{ id, label,
// desc, Icon }] }]; cols is the md+ grid template (e.g. '4fr_3fr_5fr').
export default function FrameRibbon({ groups, active, onOpen, cols, minWidth = 860, label }) {
  return (
    <div className="pointer-events-auto bg-[#1A2038] grid grid-cols-1 md:overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <nav aria-label={label} className="hidden md:flex min-w-0 pl-0 pr-4 py-3 items-center gap-3 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="w-full grid gap-4 h-full" style={{ minWidth, gridTemplateColumns: cols.split('_').map(c => `minmax(0,${c})`).join(' ') }}>
          {groups.map(group => (
            <div key={group.id} data-group={group.id} className="developer-lifecycle-group min-w-0">
              <p className="px-0.5 pb-1.5 text-[10px] text-slate-400 uppercase font-semibold tracking-wider leading-none truncate">{group.label}</p>
              <div className="developer-lifecycle-box flex min-w-0 h-[48px] rounded-lg border border-white/10 bg-[#111827] overflow-hidden divide-x divide-white/10">
                {group.tabs.map(t => {
                  const on = active === t.id
                  return (
                    <button key={t.id} onClick={() => onOpen(t.id)} title={`${t.label}: ${t.desc}`} aria-current={on ? 'step' : undefined}
                      className={`flex-1 min-w-0 flex items-center gap-2.5 px-2 min-[1800px]:px-3 text-left transition-colors ${
                        on ? 'bg-[#6C5CE7]/25 text-white' : 'text-slate-300 hover:text-white hover:bg-white/5'}`}>
                      <t.Icon size={18} strokeWidth={1.75} aria-hidden="true"
                        className={`hidden min-[1800px]:block shrink-0 ${on ? 'text-[#A29BFE]' : 'text-slate-400'}`} />
                      <span className="min-w-0">
                        <span data-tab-label className="block text-[11px] font-semibold leading-tight whitespace-nowrap truncate">{t.short || t.label}</span>
                        <span className="block text-[10px] leading-tight mt-0.5 whitespace-nowrap truncate text-slate-500">{t.desc}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>
    </div>
  )
}
