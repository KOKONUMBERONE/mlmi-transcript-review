import { useCallback, useEffect, useRef, useState } from 'react'
import type { TrialSpec } from './trials'

// setup → intro → (trial → break)* → done
export type Phase = 'setup' | 'intro' | 'trial' | 'break' | 'done'

export interface TrialRunner {
  phase: Phase
  trials: TrialSpec[]
  index: number
  current: TrialSpec | null
  next: TrialSpec | null
  timeRemainingMs: number
  locked: boolean // fixed-time budget elapsed — the review window is closed
  startSession: (trials: TrialSpec[]) => void
  beginTrials: () => void // intro → first trial
  endTrial: () => void // trial → break (questionnaire)
  continueNext: () => void // break → next trial, or done
  reset: () => void
}

export function useTrialRunner(): TrialRunner {
  const [phase, setPhase] = useState<Phase>('setup')
  const [trials, setTrials] = useState<TrialSpec[]>([])
  const [index, setIndex] = useState(0)
  const [timeRemainingMs, setTimeRemainingMs] = useState(0)
  const [locked, setLocked] = useState(false)
  const timerRef = useRef<number | null>(null)

  const clearTimer = () => {
    if (timerRef.current != null) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  const startSession = useCallback((t: TrialSpec[]) => {
    setTrials(t)
    setIndex(0)
    setLocked(false)
    setPhase('intro')
  }, [])

  const beginTrials = useCallback(() => {
    setLocked(false)
    setPhase('trial')
  }, [])

  const endTrial = useCallback(() => {
    clearTimer()
    setPhase('break')
  }, [])

  const continueNext = useCallback(() => {
    setIndex((i) => {
      const nextIdx = i + 1
      if (nextIdx >= trials.length) {
        setPhase('done')
        return i
      }
      setLocked(false)
      setPhase('trial')
      return nextIdx
    })
  }, [trials.length])

  const reset = useCallback(() => {
    clearTimer()
    setPhase('setup')
    setTrials([])
    setIndex(0)
    setLocked(false)
    setTimeRemainingMs(0)
  }, [])

  // Fixed-time countdown: runs only while a trial is active.
  useEffect(() => {
    if (phase !== 'trial') {
      clearTimer()
      return
    }
    const spec = trials[index]
    if (!spec) return
    const budget = spec.timeBudgetSec * 1000
    const startedAt = performance.now()
    setTimeRemainingMs(budget)
    setLocked(false)
    timerRef.current = window.setInterval(() => {
      const remaining = budget - (performance.now() - startedAt)
      if (remaining <= 0) {
        setTimeRemainingMs(0)
        setLocked(true)
        clearTimer()
      } else {
        setTimeRemainingMs(remaining)
      }
    }, 250)
    return clearTimer
  }, [phase, index, trials])

  useEffect(() => () => clearTimer(), [])

  const active = phase === 'trial' || phase === 'break'
  return {
    phase,
    trials,
    index,
    current: active ? trials[index] ?? null : null,
    next: trials[index + 1] ?? null,
    timeRemainingMs,
    locked,
    startSession,
    beginTrials,
    endTrial,
    continueNext,
    reset,
  }
}
