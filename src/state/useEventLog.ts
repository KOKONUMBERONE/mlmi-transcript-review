import { useCallback, useRef } from 'react'
import type { EventType, LogEvent } from '../types'

interface Context {
  reviewer: string
  model: string
  participantId: string
  condition: string
}

export interface EventLog {
  log: (type: EventType, fields?: Partial<LogEvent>) => void
  setContext: (ctx: Partial<Context>) => void
  getEvents: () => LogEvent[]
  getStartTime: () => number
  clear: () => void
}

const DEFAULT_PARTICIPANT = 'demo'
const DEFAULT_CONDITION = 'demo'

/**
 * Stores behavioural events in a ref-backed array so logging never causes
 * a React re-render. Context (reviewer / model / participant / condition)
 * is also held in refs and updated by callers when those change; every
 * event is stamped with the latest values at log time.
 */
export function useEventLog(): EventLog {
  const eventsRef = useRef<LogEvent[]>([])
  const startRef = useRef<number>(performance.now())
  const contextRef = useRef<Context>({
    reviewer: '',
    model: '',
    participantId: DEFAULT_PARTICIPANT,
    condition: DEFAULT_CONDITION,
  })

  const log = useCallback(
    (type: EventType, fields: Partial<LogEvent> = {}) => {
      const ctx = contextRef.current
      eventsRef.current.push({
        t_ms: Math.round(performance.now() - startRef.current),
        t_iso: new Date().toISOString(),
        type,
        reviewer: ctx.reviewer.trim() || 'Unknown reviewer',
        model: ctx.model,
        participant_id: ctx.participantId.trim() || DEFAULT_PARTICIPANT,
        condition: ctx.condition.trim() || DEFAULT_CONDITION,
        ...fields,
      })
    },
    [],
  )

  const setContext = useCallback((ctx: Partial<Context>) => {
    if (ctx.reviewer !== undefined) contextRef.current.reviewer = ctx.reviewer
    if (ctx.model !== undefined) contextRef.current.model = ctx.model
    if (ctx.participantId !== undefined) contextRef.current.participantId = ctx.participantId
    if (ctx.condition !== undefined) contextRef.current.condition = ctx.condition
  }, [])

  const getEvents = useCallback(() => [...eventsRef.current], [])

  const getStartTime = useCallback(() => startRef.current, [])

  const clear = useCallback(() => {
    eventsRef.current = []
    startRef.current = performance.now()
  }, [])

  return { log, setContext, getEvents, getStartTime, clear }
}
