import type { EditState, ModelName, RiskDimension, Segment as SegmentType } from '../types'
import { segmentRiskFor } from '../lib/segmentRisk'
import Word from './Word'

interface Props {
  segment: SegmentType
  model: ModelName
  active: boolean
  verified: boolean
  edits: Record<string, EditState>
  dimension: RiskDimension
  onSeek: (seconds: number) => void
  onWordClick: (segId: number, wordIdx: number, rect: DOMRect) => void
  onToggleVerify: (segId: number) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

const RISK_BAR: Record<'high' | 'med' | 'low', string> = {
  high: 'bg-risk-high',
  med: 'bg-risk-med',
  low: 'bg-border',
}

// Known speaker labels get themed colours; anything else (e.g. "Speaker"
// from a non-diarized Whisper pipeline) falls through to neutral ink.
const SPEAKER_COLOR: Record<string, string> = {
  Officer: 'text-speaker-officer',
  Witness: 'text-speaker-witness',
}
const SPEAKER_COLOR_DEFAULT = 'text-ink'

export default function Segment({
  segment,
  model,
  active,
  verified,
  edits,
  dimension,
  onSeek,
  onWordClick,
  onToggleVerify,
}: Props) {
  const words = segment.words[model] ?? []

  // Aggregate the segment-level risk from words under the active dimension,
  // so the left bar + "HIGH RISK" badge follow the toolbar Risk toggle.
  const effectiveRisk = segmentRiskFor(segment, model, dimension)

  const bar = verified ? 'bg-verified-bar' : RISK_BAR[effectiveRisk]

  const containerCls = verified
    ? 'bg-verified-bg ring-1 ring-verified-bar/40'
    : active
    ? 'bg-amber-50 ring-1 ring-amber-300'
    : 'hover:bg-white hover:ring-1 hover:ring-border'

  return (
    <article
      onClick={() => onSeek(segment.start)}
      className={`group flex gap-3 rounded-md cursor-pointer transition-colors px-3 py-2 -mx-3 ${containerCls}`}
    >
      <div className={`w-[3px] rounded-full shrink-0 ${bar}`} />

      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-3 mb-1.5">
          <span
            className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${
              SPEAKER_COLOR[segment.speaker] ?? SPEAKER_COLOR_DEFAULT
            }`}
          >
            {segment.speaker}
          </span>
          <span className="font-mono text-[11px] text-ink-faint tabular-nums">
            {formatTime(segment.start)}
          </span>

          {effectiveRisk === 'high' && !verified && (
            <span className="font-mono text-[10px] text-risk-high uppercase tracking-widest px-1.5 py-0.5 bg-risk-high-bg rounded-sm">
              High risk
            </span>
          )}

          {active && (
            <span className="font-mono text-[10px] text-amber-700 uppercase tracking-widest">
              ▸ playing
            </span>
          )}

          {verified && (
            <span className="font-mono text-[10px] text-verified uppercase tracking-widest">
              ✓ verified
            </span>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation()
              onToggleVerify(segment.id)
            }}
            className={[
              'ml-auto text-[11px] px-2 py-0.5 rounded border transition-colors opacity-60 group-hover:opacity-100',
              verified
                ? 'border-verified text-verified bg-white hover:bg-verified-bg opacity-100'
                : 'border-border text-ink-muted bg-white hover:border-ink-muted hover:text-ink',
            ].join(' ')}
          >
            {verified ? 'Un-verify' : 'Verify'}
          </button>
        </header>

        <p className="text-[15px] leading-[1.65] text-ink">
          {words.map((word, i) => {
            const key = `${segment.id}-${i}`
            const edit = edits[key]
            const displayText = edit ? edit.text : word.text
            return (
              <span key={i}>
                <Word
                  word={word}
                  displayText={displayText}
                  edited={edit !== undefined && !edit.deleted}
                  deleted={edit?.deleted === true}
                  dimension={dimension}
                  onClick={(rect) => onWordClick(segment.id, i, rect)}
                />
                {i < words.length - 1 ? ' ' : ''}
              </span>
            )
          })}
        </p>
      </div>
    </article>
  )
}
