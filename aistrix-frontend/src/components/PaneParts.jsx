import { useEffect, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'

// Pieces of the left pane shared by Developer (Your apps, Workflows) and
// Business (the client's apps and workflows), so both look the same.

// A long app name slides sideways on hover to show the rest, without
// changing the row's height (wrapping made the list jump).
export function SlidingName({ name }) {
  const boxRef = useRef(null)
  const textRef = useRef(null)
  const [shift, setShift] = useState(0)
  useEffect(() => {
    const box = boxRef.current, text = textRef.current
    if (!box || !text) return
    const measure = () => setShift(Math.max(0, text.scrollWidth - box.clientWidth + 44))   // 44: room for the hover arrows
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(box)
    return () => ro.disconnect()
  }, [name])
  const overflow = shift > 44
  return (
    <span ref={boxRef} className="relative flex-1 min-w-0 overflow-hidden text-sm leading-tight">
      <span ref={textRef}
        className={`block whitespace-nowrap ${overflow ? 'truncate group-hover/app:w-max group-hover/app:overflow-visible group-hover/app:translate-x-(--slide) group-hover/app:duration-(--slide-time) group-hover/app:delay-300 transition-[translate] duration-200 ease-linear' : 'truncate'}`}
        style={overflow ? { '--slide': `-${shift}px`, '--slide-time': `${Math.max(600, shift * 25)}ms` } : undefined}>
        {name}
      </span>
    </span>
  )
}

// Open/closed sections of the left panel, remembered per browser.
export function useSectionOpen(key) {
  const [open, setOpen] = useState(() => { try { return localStorage.getItem(key) !== '0' } catch { return true } })
  const toggle = () => setOpen(o => { try { localStorage.setItem(key, o ? '0' : '1') } catch { /* not remembered */ } return !o })
  return [open, toggle]
}

// Section headings of the left panel: a filled bar with an icon, so Apps
// and Workflows stand apart from the stage labels inside them.
export function SectionHeader({ title, icon: Icon, count, open, onToggle, children }) {
  return (
    <div className="flex items-center justify-between gap-0.5 rounded-xl border border-[#6C5CE7]/25 bg-[#6C5CE7]/10 py-1.5 pl-1 pr-0.5">
      <button onClick={onToggle} aria-expanded={open} title={open ? `Fold ${title}` : `Open ${title}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded-lg px-1 py-0.5 text-left hover:bg-white/5">
        <ChevronRight size={13} aria-hidden="true" className={`shrink-0 text-[#C9C2FF] transition-transform ${open ? 'rotate-90' : ''}`} />
        {Icon && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-[#6C5CE7]/25 text-[#C9C2FF]"><Icon size={12} aria-hidden="true" /></span>}
        <span className="whitespace-nowrap text-[15px] font-bold tracking-tight text-white">{title}</span>
        {count > 0 && <span className="shrink-0 rounded-full bg-[#6C5CE7]/30 px-1.5 text-[10px] font-bold text-[#E0DBFF]">{count}</span>}
      </button>
      <div className="flex shrink-0 items-center">{children}</div>
    </div>
  )
}
