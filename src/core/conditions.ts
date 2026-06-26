import type { Condition, HighlightLayer } from '../types'

// C1–C4 are the same review skeleton with a different highlight layer (+ case
// focus for C4). The study build locks the highlight to the active condition;
// the full/police build ignores this and uses the free RiskDimension toggle.
export interface ConditionConfig {
  highlight: HighlightLayer
  focus: boolean
  /** Short human label for the experimenter strip / tooltips. */
  label: string
}

export const CONDITION_CONFIG: Record<Condition, ConditionConfig> = {
  C1: { highlight: 'none', focus: false, label: 'Plain text' },
  C2: { highlight: 'uncertainty', focus: false, label: 'Uncertainty only' },
  C3: { highlight: 'combined', focus: false, label: 'Combined (2×2)' },
  C4: { highlight: 'combined', focus: true, label: 'Combined + case focus' },
}
