import type { Condition, HighlightLayer } from '../types'

// C1–C4 are the same review skeleton with a different highlight layer (+ the
// AI toolkit for C4). The study build locks the highlight to the active
// condition; the full/police build ignores this and uses the free
// RiskDimension toggle.
export interface ConditionConfig {
  highlight: HighlightLayer
  focus: boolean
  /** Full LIVE AI toolkit (free-input Find + Assistant + Outline + Conflicts
   *  + Timeline, all calling the live backend). 2026-07-19 decision: the
   *  study CONNECTS to the live LLM — participants search with their own
   *  words, so outputs cannot be frozen; the reproducibility trade-off is
   *  accepted and noted in the pre-registration. */
  toolkit: boolean
  /** Short human label for the experimenter strip / tooltips. */
  label: string
}

export const CONDITION_CONFIG: Record<Condition, ConditionConfig> = {
  C1: { highlight: 'none', focus: false, toolkit: false, label: 'Plain text' },
  C2: { highlight: 'uncertainty', focus: false, toolkit: false, label: 'Uncertainty only' },
  C3: { highlight: 'combined', focus: false, toolkit: false, label: 'Combined (2×2)' },
  C4: { highlight: 'combined', focus: true, toolkit: true, label: 'Combined + AI toolkit' },
}
