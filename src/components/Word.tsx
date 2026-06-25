import type { FocusWordHit, HighlightLayer, Risk, Word as WordType } from '../types'

interface Props {
  word: WordType
  displayText: string
  edited: boolean
  deleted: boolean
  dimension: HighlightLayer
  // Deployment regime: display-risk override for the combined dimension (from the
  // RiskPolicy display-policy). When set, it replaces word.combined_risk for
  // colouring. Undefined = study / pass-through.
  displayRisk?: Risk
  // When set (focus mode, 2b), this word was retrieved for a focus term and is
  // elevated to HIGH with a distinct violet marker layered on top.
  focusHit?: FocusWordHit
  // Track-changes view. When true (default), an edit shows the original struck
  // through + the new word inserted, and a deletion shows struck-through. When
  // false ("clean view"), edits show only the final text and deletions vanish.
  showChanges?: boolean
  onClick: (rect: DOMRect) => void
}

// Pick the risk value to colour by, based on the active display dimension.
// Falls back to the upstream `risk` (uncertainty) if the prediction service
// hasn't run yet — so the UI stays usable in offline / pre-fetch state.
function riskFor(word: WordType, dimension: HighlightLayer, displayRisk?: Risk): Risk {
  if (dimension === 'none') return 'low' // C1: plain text, no colouring
  if (dimension === 'uncertainty') return word.risk
  if (dimension === 'importance') return word.predicted_importance ?? word.risk
  // combined: the display-policy override (deployment) wins over the raw signal.
  return displayRisk ?? word.combined_risk ?? word.risk
}

export default function Word({
  word,
  displayText,
  edited,
  deleted,
  dimension,
  displayRisk,
  focusHit,
  showChanges = true,
  onClick,
}: Props) {
  if (!displayText) return null
  // Clean view: a removed word simply isn't part of the final text.
  if (deleted && !showChanges) return null

  const isEdit = edited && !deleted
  const showDiff = showChanges && (isEdit || deleted)

  const activeRisk = riskFor(word, dimension, displayRisk)

  const base =
    'relative inline-block rounded-sm px-0.5 cursor-pointer transition-colors hover:bg-surface-subtle'

  // Risk / focus colour only applies to a plain, unedited word. An edited or
  // deleted word carries its own track-change styling (or, in clean view,
  // reads as confirmed final text with no risk flag).
  const showRisk = !isEdit && !deleted
  const risk = !showRisk
    ? ''
    : focusHit
      ? 'bg-focus-bg text-focus underline decoration-focus decoration-2 underline-offset-[3px] ring-1 ring-focus/40 hover:bg-focus/15'
      : activeRisk === 'high'
        ? 'bg-risk-high-bg text-risk-high underline decoration-risk-high decoration-dotted underline-offset-[3px] hover:bg-risk-high/15'
        : activeRisk === 'med'
          ? 'bg-risk-med-bg text-risk-med underline decoration-risk-med decoration-dotted underline-offset-[3px] hover:bg-risk-med/15'
          : ''

  // Deleted (track-changes view): struck-through in the deletion colour.
  const deletedCls = deleted
    ? 'line-through decoration-2 text-change-del/70 bg-change-del-bg ring-1 ring-change-del/20'
    : ''

  const dimLabel =
    dimension === 'uncertainty' ? 'uncertainty' : dimension === 'importance' ? 'importance' : 'combined'
  const title = deleted
    ? `Marked deleted (original: ${word.text}) — click to restore`
    : isEdit
    ? `Edited from "${word.text}" → "${displayText}"`
    : focusHit
    ? `Focus: ${focusHit.focus_label} (${focusHit.match_type}${
        focusHit.match_detail && focusHit.match_detail !== 'literal'
          ? `·${focusHit.match_detail}`
          : ''
      }, ${focusHit.focus_score.toFixed(2)}) — elevated to HIGH${
        focusHit.llm_reason ? ` · ${focusHit.llm_reason}` : ''
      }`
    : activeRisk !== 'low'
    ? `${activeRisk === 'high' ? 'High' : 'Medium'} ${dimLabel} — click to inspect`
    : 'Click to inspect'

  return (
    <span
      className={`${base} ${risk} ${deleted ? deletedCls : ''}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e.currentTarget.getBoundingClientRect())
      }}
    >
      {isEdit && showChanges ? (
        // Track-changes: original struck out, correction inserted.
        <>
          <span className="line-through text-change-del/70 decoration-change-del/60 mr-1">
            {word.text}
          </span>
          <span className="text-change-ins font-medium underline decoration-change-ins decoration-2 underline-offset-[3px]">
            {displayText}
          </span>
        </>
      ) : (
        // Plain word, clean-view edit (final text only), or deleted (struck).
        displayText
      )}

      {focusHit && !showDiff && (
        <span
          aria-hidden="true"
          className="absolute -top-1 -left-1 w-1.5 h-1.5 rounded-full bg-focus ring-1 ring-white"
        />
      )}
      {deleted && showChanges && (
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="absolute -top-1 -right-1 w-2.5 h-2.5 text-change-del"
          fill="currentColor"
        >
          <circle cx="6" cy="6" r="5.5" />
          <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  )
}
