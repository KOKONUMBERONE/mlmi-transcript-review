import { useCallback, useEffect, useState } from 'react'
import { DEMO_TOUR_STEPS, type TourApi } from './demoTourSteps'
import type { EventLog } from '../state/useEventLog'

// Spotlight walkthrough for the police demo trial: dims the live workspace,
// rings one element at a time (the box-shadow punches the hole), and forces a
// Next-only pass through every feature. Between steps it drives the real
// workspace state through `api`, so the interface visibly switches while the
// card explains it. Hand-rolled — no tour library.
const DIM = 'rgba(15, 23, 42, 0.55)'
const PAD = 6 // px of breathing room around the anchored element
const CARD_W = 340 // matches w-[340px] below; used for placement maths

interface Rect {
  top: number
  left: number
  width: number
  height: number
}

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

  const step = DEMO_TOUR_STEPS[index]
  const last = index === DEMO_TOUR_STEPS.length - 1

  const resolveAnchor = useCallback((): Element | null => {
    const a = DEMO_TOUR_STEPS[index].anchor
    // String anchors are data-tour names; function anchors return a full
    // CSS selector (e.g. a [data-segment-id="…"] row) or null.
    const sel = typeof a === 'function' ? a(api) : a ? `[data-tour="${a}"]` : null
    return sel ? document.querySelector(sel) : null
  }, [index, api])

  // Step entry: apply the state changes, then scroll the anchor into view
  // (retrying a few frames — panels the prepare() opened may still be mounting).
  useEffect(() => {
    step.prepare?.(api)
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

  // Continuous tracker: re-resolve + re-measure every frame while mounted, so
  // the ring follows scrolls, panel mounts and layout shifts with no one-shot
  // timing to get wrong. setRect is change-guarded to avoid render loops.
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = resolveAnchor()
      setRect((prev) => {
        if (!el) return prev === null ? prev : null
        const r = el.getBoundingClientRect()
        if (
          prev &&
          Math.abs(prev.top - r.top) < 0.5 &&
          Math.abs(prev.left - r.left) < 0.5 &&
          Math.abs(prev.width - r.width) < 0.5 &&
          Math.abs(prev.height - r.height) < 0.5
        )
          return prev
        return { top: r.top, left: r.left, width: r.width, height: r.height }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [resolveAnchor])

  const finish = () => {
    events.log('demo_tour_done', { steps_seen: index + 1 })
    onFinish()
  }
  const skip = () => {
    events.log('demo_tour_skip', { at_step: step.id, step_index: index })
    onSkip()
  }

  // ---- card placement -----------------------------------------------------
  const vw = window.innerWidth
  const vh = window.innerHeight
  let cardStyle: React.CSSProperties
  if (!rect) {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  } else {
    const below = rect.top + rect.height + PAD + 12
    const est = 210 // rough card height for the flip decision
    const top = below + est <= vh ? below : Math.max(12, rect.top - PAD - 12 - est)
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - CARD_W / 2), vw - CARD_W - 12)
    cardStyle = { top, left }
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Guided demo">
      {/* Click blocker — the walkthrough is Next-only. Also the dimmer when no
          element is spotlit (centred steps). */}
      <div
        className="absolute inset-0"
        style={{ background: rect ? 'transparent' : DIM }}
        onMouseDown={(e) => e.preventDefault()}
      />

      {/* Spotlight: the huge box-shadow dims everything around the hole. The
          pulse ring lives on a separate layer — the pulse keyframes animate
          box-shadow and would override the dim if they shared an element. */}
      {rect && (
        <>
          <div
            className="absolute rounded-lg border-2 border-brand pointer-events-none"
            style={{
              top: rect.top - PAD,
              left: rect.left - PAD,
              width: rect.width + PAD * 2,
              height: rect.height + PAD * 2,
              boxShadow: `0 0 0 9999px ${DIM}`,
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
        className="absolute w-[340px] max-w-[calc(100vw-24px)] bg-surface border border-border rounded-lg shadow-lg p-4 motion-safe:animate-card-in"
        style={cardStyle}
      >
        <p className="text-[10px] font-mono tabular-nums text-ink-faint mb-1">
          Step {index + 1} of {DEMO_TOUR_STEPS.length}
        </p>
        <h2 className="text-sm font-semibold text-ink mb-1.5">{step.title}</h2>
        <p className="text-[12.5px] leading-snug text-ink-muted">{step.body}</p>
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
            className="text-[12px] font-medium px-3.5 py-1.5 rounded bg-brand text-white hover:opacity-90 transition-opacity"
          >
            {last ? 'Start task 1' : 'Next'}
          </button>
        </div>
      </div>

      {/* Facilitator escape hatch — deliberately quiet. */}
      <button
        onClick={skip}
        className="absolute left-4 bottom-4 text-[11px] text-white/60 hover:text-white underline underline-offset-2"
      >
        Skip demo
      </button>
    </div>
  )
}
