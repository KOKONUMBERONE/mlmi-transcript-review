import { useCallback, useEffect, useRef } from 'react'
import type { EventType, LogEvent } from '../types'

interface Context {
  reviewer: string
  model: string
  participantId: string
  condition: string
  // Trial-level context (set by the study trial runner; undefined in full).
  block?: number
  trialIndex?: number
  difficulty?: string
  stimulusId?: string
}

export interface EventLog {
  log: (type: EventType, fields?: Partial<LogEvent>) => void
  setContext: (ctx: Partial<Context>) => void
  /** Start a new trial: stamp trial context + reset the per-trial clock. */
  setTrial: (ctx: Partial<Context>) => void
  getEvents: () => LogEvent[]
  getStartTime: () => number
  clear: () => void
}

const DEFAULT_PARTICIPANT = 'demo'
const DEFAULT_CONDITION = 'demo'
const STORAGE_KEY = 'mlmi.eventlog.v2'

/**
 * Stores behavioural events in a ref-backed array so logging never causes a
 * React re-render. Context (reviewer / model / participant / condition + trial)
 * is held in refs and stamped onto every event. The buffer is also mirrored to
 * localStorage (debounced + flushed on hide/unload) so a closed tab or crash
 * can't lose a ~50-minute study session even if the researcher forgets to
 * export.
 */
export function useEventLog(): EventLog {
  const eventsRef = useRef<LogEvent[]>([])
  const startRef = useRef<number>(performance.now())
  // Per-trial clock origin. Defaults to session start until the first trial.
  const trialStartRef = useRef<number>(startRef.current)
  const contextRef = useRef<Context>({
    reviewer: '',
    model: '',
    participantId: DEFAULT_PARTICIPANT,
    condition: DEFAULT_CONDITION,
  })
  const persistTimer = useRef<number | null>(null)

  const persist = useCallback(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ saved_at: new Date().toISOString(), events: eventsRef.current }),
      )
    } catch {
      // localStorage unavailable / full — non-fatal; the export path still works.
    }
  }, [])

  const log = useCallback(
    (type: EventType, fields: Partial<LogEvent> = {}) => {
      const ctx = contextRef.current
      const now = performance.now()
      eventsRef.current.push({
        t_ms: Math.round(now - startRef.current),
        t_in_trial_ms: Math.round(now - trialStartRef.current),
        t_iso: new Date().toISOString(),
        type,
        reviewer: ctx.reviewer.trim() || 'Unknown reviewer',
        model: ctx.model,
        participant_id: ctx.participantId.trim() || DEFAULT_PARTICIPANT,
        condition: ctx.condition.trim() || DEFAULT_CONDITION,
        block: ctx.block,
        trial_index: ctx.trialIndex,
        difficulty: ctx.difficulty,
        stimulus_id: ctx.stimulusId,
        ...fields,
      })
      // Debounced backup so a crash / closed tab can't lose the session.
      if (persistTimer.current == null) {
        persistTimer.current = window.setTimeout(() => {
          persistTimer.current = null
          persist()
        }, 1000)
      }
    },
    [persist],
  )

  const setContext = useCallback((ctx: Partial<Context>) => {
    const c = contextRef.current
    if (ctx.reviewer !== undefined) c.reviewer = ctx.reviewer
    if (ctx.model !== undefined) c.model = ctx.model
    if (ctx.participantId !== undefined) c.participantId = ctx.participantId
    if (ctx.condition !== undefined) c.condition = ctx.condition
    if (ctx.block !== undefined) c.block = ctx.block
    if (ctx.trialIndex !== undefined) c.trialIndex = ctx.trialIndex
    if (ctx.difficulty !== undefined) c.difficulty = ctx.difficulty
    if (ctx.stimulusId !== undefined) c.stimulusId = ctx.stimulusId
  }, [])

  const setTrial = useCallback((ctx: Partial<Context>) => {
    const c = contextRef.current
    if (ctx.block !== undefined) c.block = ctx.block
    if (ctx.trialIndex !== undefined) c.trialIndex = ctx.trialIndex
    if (ctx.difficulty !== undefined) c.difficulty = ctx.difficulty
    if (ctx.stimulusId !== undefined) c.stimulusId = ctx.stimulusId
    if (ctx.condition !== undefined) c.condition = ctx.condition
    // Reset the per-trial clock so t_in_trial_ms starts at 0 for this trial.
    trialStartRef.current = performance.now()
  }, [])

  const getEvents = useCallback(() => [...eventsRef.current], [])
  const getStartTime = useCallback(() => startRef.current, [])

  const clear = useCallback(() => {
    eventsRef.current = []
    startRef.current = performance.now()
    trialStartRef.current = startRef.current
    persist()
  }, [persist])

  // Flush the backup when the tab is hidden or unloaded.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === 'hidden') persist()
    }
    window.addEventListener('beforeunload', persist)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', persist)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [persist])

  // Stable object identity (all methods are useCallback-stable) so consumers
  // that depend on `events` don't re-run their effects on every render.
  const apiRef = useRef<EventLog | null>(null)
  if (!apiRef.current) {
    apiRef.current = { log, setContext, setTrial, getEvents, getStartTime, clear }
  }
  return apiRef.current
}
