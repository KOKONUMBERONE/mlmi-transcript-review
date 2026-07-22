import { useCallback, useEffect, useRef, useState } from 'react'
import { DEMO_TOUR_STEPS, type TourApi } from './demoTourSteps'
import type { EventLog } from '../state/useEventLog'

// Spotlight walkthrough for the police demo trial. Interactive steps punch a
// real hole in the click-blocker so ONLY the spotlit control (plus its popups)
// is usable; the step completes when the matching interaction event appears in
// the live event log. Tell-steps keep everything blocked. Hand-rolled — no
// tour library.
const DIM = 'rgba(15, 23, 42, 0.55)'
const PAD = 6 // px of breathing room around the anchored element
const CARD_W = 340

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const near = (a: Rect, b: Rect) =>
  Math.abs(a.top - b.top) < 0.5 &&
  Math.abs(a.left - b.left) < 0.5 &&
  Math.abs(a.width - b.width) < 0.5 &&
  Math.abs(a.height - b.height) < 0.5

export default function DemoTour({
  api,
  events,
  onFinish,
  onSkip,
}: {
  api: TourApi
  events: EventLog
  onFinish: () => void
  onSkip: () => void
}) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [holes, setHoles] = useState<Rect[]>([])
  const [done, setDone] = useState(false)
  const baselineRef = useRef(0)

  const step = DEMO_TOUR_STEPS[index]
  const last = index === DEMO_TOUR_STEPS.length - 1
  const interactive = step.interactive

  const resolveAnchor = useCallback((): Element | null => {
    const a = DEMO_TOUR_STEPS[index].anchor
    const sel = typeof a === 'function' ? a(api) : a ? `[data-tour="${a}"]` : null
    return sel ? document.querySelector(sel) : null
  }, [index, api])

  // Step entry: close stray popups, apply the state changes, reset the
  // done-latch + event baseline, then scroll the anchor into view (retrying a
  // few frames — panels the prepare() opened may still be mounting).
  useEffect(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    step.prepare?.(api)
    setDone(false)
    baselineRef.current = events.getEvents().length
    events.log('demo_tour_step', { step_id: step.id, step_index: index })
    let tries = 0
    let raf = 0
    const tryScroll = () => {
      const el = resolveAnchor()
      if (el) el.scrollIntoView({ block: 'center' })
      else if (++tries < 30) raf = requestAnimationFrame(tryScroll)
    }
    raf = requestAnimationFrame(tryScroll)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  // Continuous tracker: every frame re-measure the anchor + extra holes and
  // check the done-condition against events logged since the step began. All
  // setters are change-guarded so quiet frames cause no re-renders.
  useEffect(() => {
    let raf = 0
    const stepDef = DEMO_TOUR_STEPS[index]
    const tick = () => {
      const el = resolveAnchor()
      setRect((prev) => {
        if (!el) return prev === null ? prev : null
        const r = el.getBoundingClientRect()
        const next = { top: r.top, left: r.left, width: r.width, height: r.height }
        return prev && near(prev, next) ? prev : next
      })
      // Clickable holes: anchor + any live extra targets (popups, dialogs).
      const extra = stepDef.interactive?.extraHoles ?? []
      const hs: Rect[] = []
      if (stepDef.interactive && el) {
        const r = el.getBoundingClientRect()
        hs.push({ top: r.top, left: r.left, width: r.width, height: r.height })
      }
      for (const sel of extra) {
        document.querySelectorAll(sel).forEach((n) => {
          const r = (n as Element).getBoundingClientRect()
          if (r.width > 0) hs.push({ top: r.top, left: r.left, width: r.width, height: r.height })
        })
      }
      setHoles((prev) =>
        prev.length === hs.length && prev.every((p, i) => near(p, hs[i])) ? prev : hs,
      )
      if (stepDef.interactive) {
        const fresh = events.getEvents().slice(baselineRef.current)
        if (stepDef.interactive.isDone(fresh, document)) {
          setDone((d) => d || true)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, resolveAnchor])

  const finish = () => {
    events.log('demo_tour_done', { steps_seen: index + 1 })
    onFinish()
  }
  const skip = () => {
    events.log('demo_tour_skip', { at_step: step.id, step_index: index })
    onSkip()
  }

  // ---- geometry -----------------------------------------------------------
  const vw = window.innerWidth
  const vh = window.innerHeight
  // The dimmer: one evenodd path — full screen minus the visual hole (anchor)
  // and any interactive holes. Painted area swallows clicks; holes pass through.
  const visualHoles: Rect[] = []
  if (rect) visualHoles.push(rect)
  for (const h of holes) if (!rect || !near(h, rect)) visualHoles.push(h)
  const holePath = (h: Rect) =>
    `M${h.left - PAD} ${h.top - PAD}h${h.width + PAD * 2}v${h.height + PAD * 2}h${-(h.width + PAD * 2)}z`
  const pathD = `M0 0H${vw}V${vh}H0Z` + visualHoles.map(holePath).join('')

  let cardStyle: React.CSSProperties
  if (!rect) {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  } else {
    const below = rect.top + rect.height + PAD + 12
    const est = step.media ? 330 : 230 // rough card height for the flip decision
    const top = below + est <= vh ? below : Math.max(12, rect.top - PAD - 12 - est)
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 12)
    cardStyle = { top, left }
  }

  return (
    <div
      className="fixed inset-0 z-[60] pointer-events-none"
      role="dialog"
      aria-modal="true"
      aria-label="Guided demo"
    >
      {/* Dimmer + click blocker. Holes are unpainted → clicks pass through. */}
      <svg className="absolute inset-0 w-full h-full" style={{ pointerEvents: 'none' }}>
        <path
          d={pathD}
          fill={DIM}
          fillRule="evenodd"
          style={{ pointerEvents: 'auto' }}
          onMouseDown={(e) => e.preventDefault()}
        />
      </svg>
      {/* Tell-steps: the anchor stays bright but must not be clickable — cover
          the visual hole with a transparent shield. */}
      {!interactive &&
        visualHoles.map((h, i) => (
          <div
            key={i}
            className="absolute"
            style={{
              top: h.top - PAD,
              left: h.left - PAD,
              width: h.width + PAD * 2,
              height: h.height + PAD * 2,
              pointerEvents: 'auto',
            }}
            onMouseDown={(e) => e.preventDefault()}
          />
        ))}

      {/* Spotlight ring + pulse (separate layers — the pulse keyframes animate
          box-shadow and would override a shared element's styles). */}
      {rect && (
        <>
          <div
            className="absolute rounded-lg border-2 border-brand pointer-events-none"
            style={{
              top: rect.top - PAD,
              left: rect.left - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
            }}
          />
          <div
            className="absolute rounded-lg motion-safe:animate-pulse-brand pointer-events-none"
            style={{
              top: rect.top - PAD,
              left: rect.left - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
            }}
          />
        </>
      )}

      {/* Step card */}
      <div
        className="absolute w-[340px] max-w-[calc(100vw-24px)] bg-surface border border-border rounded-lg shadow-lg p-4 motion-safe:animate-card-in pointer-events-auto"
        style={cardStyle}
      >
        <p className="text-[10px] font-mono tabular-nums text-ink-faint mb-1">
          Step {index + 1} of {DEMO_TOUR_STEPS.length}
        </p>
        <h2 className="text-sm font-semibold text-ink mb-1.5">{step.title}</h2>
        <p className="text-[12.5px] leading-snug text-ink-muted">{step.body}</p>

        {step.media === 'report' && (
          <div className="mt-2.5 rounded border border-border overflow-hidden bg-white" style={{ height: 150 }}>
            <iframe
              src={`${import.meta.env.BASE_URL}demo-report.html`}
              title="Report preview"
              className="pointer-events-none origin-top-left"
              style={{ width: '285%', height: 430, transform: 'scale(0.35)', border: 0 }}
              tabIndex={-1}
            />
          </div>
        )}

        {interactive && (
          <p
            className={`mt-2.5 text-[12px] leading-snug rounded px-2.5 py-2 border ${
              done
                ? 'text-verified border-verified/40 bg-verified/10 font-medium'
                : 'text-brand border-brand/30 bg-brand-bg'
            }`}
          >
            {done ? '✓ Done — that worked. Continue when ready.' : `Try it: ${interactive.instruction}`}
          </p>
        )}

        <div className="mt-3.5 flex items-center justify-between gap-2">
          <button
            onClick={() => setIndex((i) => Math.max(0, i - 1))}
            disabled={index === 0}
            className="text-[12px] px-2.5 py-1.5 rounded border border-border text-ink-muted hover:text-ink hover:border-border-strong transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Back
          </button>
          <button
            onClick={() => (last ? finish() : setIndex((i) => i + 1))}
            disabled={!!interactive && !done}
            title={interactive && !done ? 'Try the highlighted control first' : undefined}
            className="text-[12px] font-medium px-3.5 py-1.5 rounded bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {last ? 'Start task 1' : 'Next'}
          </button>
        </div>
      </div>

      {/* Facilitator escape hatch — deliberately quiet. */}
      <button
        onClick={skip}
        className="absolute left-4 bottom-4 text-[11px] text-white/60 hover:text-white underline underline-offset-2 pointer-events-auto"
      >
        Skip demo
      </button>
    </div>
  )
}
