import type { Risk, RiskDimension, Word as WordType } from '../types'

interface Props {
  word: WordType
  displayText: string
  edited: boolean
  deleted: boolean
  dimension: RiskDimension
  onClick: (rect: DOMRect) => void
}

// Pick the risk value to colour by, based on the active display dimension.
// Falls back to the upstream `risk` (uncertainty) if the prediction service
// hasn't run yet — so the UI stays usable in offline / pre-fetch state.
function riskFor(word: WordType, dimension: RiskDimension): Risk {
  if (dimension === 'uncertainty') return word.risk
  if (dimension === 'importance') return word.predicted_importance ?? word.risk
  return word.combined_risk ?? word.risk
}

export default function Word({
  word,
  displayText,
  edited,
  deleted,
  dimension,
  onClick,
}: Props) {
  if (!displayText) return null

  const activeRisk = riskFor(word, dimension)

  const base =
    'relative inline-block rounded-sm px-0.5 cursor-pointer transition-colors hover:bg-surface-subtle'

  const risk =
    activeRisk === 'high'
      ? 'bg-risk-high-bg text-risk-high underline decoration-risk-high decoration-dotted underline-offset-[3px] hover:bg-risk-high/15'
      : activeRisk === 'med'
      ? 'bg-risk-med-bg text-risk-med underline decoration-risk-med decoration-dotted underline-offset-[3px] hover:bg-risk-med/15'
      : ''

  const editedCls =
    edited && !deleted
      ? 'bg-blue-50 text-ink decoration-blue-400 underline decoration-dotted underline-offset-[3px] ring-1 ring-blue-200 pr-2'
      : ''

  const deletedCls = deleted
    ? 'line-through decoration-2 text-ink-faint/70 bg-surface-muted ring-1 ring-border'
    : ''

  // Tooltip names the dimension so reviewers know *why* a word is highlighted.
  const dimLabel =
    dimension === 'uncertainty' ? 'uncertainty' : dimension === 'importance' ? 'importance' : 'combined'
  const title = deleted
    ? `Marked deleted (original: ${word.text}) — click to restore`
    : edited
    ? `Edited (original: ${word.text})`
    : activeRisk !== 'low'
    ? `${activeRisk === 'high' ? 'High' : 'Medium'} ${dimLabel} — click to inspect`
    : 'Click to inspect'

  return (
    <span
      className={`${base} ${risk} ${editedCls} ${deletedCls}`}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e.currentTarget.getBoundingClientRect())
      }}
    >
      {displayText}
      {edited && !deleted && (
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="absolute -top-1 -right-1 w-2.5 h-2.5 text-blue-500"
          fill="currentColor"
        >
          <path d="M8.5 1.5 10.5 3.5 4 10 1.5 10.5 2 8z" />
          <path d="M7.5 2.5 9.5 4.5" stroke="white" strokeWidth="0.6" />
        </svg>
      )}
      {deleted && (
        <svg
          aria-hidden="true"
          viewBox="0 0 12 12"
          className="absolute -top-1 -right-1 w-2.5 h-2.5 text-risk-high"
          fill="currentColor"
        >
          <circle cx="6" cy="6" r="5.5" />
          <path d="M3.5 3.5l5 5M8.5 3.5l-5 5" stroke="white" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  )
}
