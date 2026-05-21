import { useEffect, useRef } from 'react'
import type { EditState, ModelName, Risk, Transcript } from '../types'
import Segment from './Segment'

interface Props {
  transcript: Transcript
  model: ModelName
  currentTime: number
  edits: Record<string, EditState>
  verified: Record<number, boolean>
  onSeek: (seconds: number) => void
  onWordClick: (segId: number, wordIdx: number, rect: DOMRect) => void
  onToggleVerify: (segId: number) => void
}

const RISK_CHIP: Record<Risk, string> = {
  high: 'bg-risk-high-bg text-risk-high border-risk-high/30',
  med: 'bg-risk-med-bg text-risk-med border-risk-med/30',
  low: 'bg-surface-muted text-ink-muted border-border',
}

export default function TranscriptView({
  transcript,
  model,
  currentTime,
  edits,
  verified,
  onSeek,
  onWordClick,
  onToggleVerify,
}: Props) {
  const findActiveSegmentId = (): number | null => {
    const seg = transcript.segments.find(
      (s) => currentTime >= s.start && currentTime < s.end,
    )
    return seg?.id ?? null
  }

  const activeId = findActiveSegmentId()
  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeId])

  const counts = transcript.segments.reduce(
    (acc, s) => {
      acc[s.paraRisk] += 1
      return acc
    },
    { high: 0, med: 0, low: 0 } as Record<Risk, number>,
  )

  return (
    <main className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-8 py-6">
        <div className="mb-6 pb-4 border-b border-border">
          <div className="flex items-baseline justify-between mb-3">
            <h1 className="text-[11px] text-ink-faint uppercase tracking-[0.2em]">
              Transcript · Case 447
            </h1>
            <p className="font-mono text-[11px] text-ink-faint">{model}</p>
          </div>

          <div className="flex items-center gap-2 text-[11px]">
            <span className="text-ink-faint uppercase tracking-widest text-[10px]">
              Risk
            </span>
            <span className={`px-2 py-0.5 rounded-sm border font-mono tabular-nums ${RISK_CHIP.high}`}>
              {counts.high} high
            </span>
            <span className={`px-2 py-0.5 rounded-sm border font-mono tabular-nums ${RISK_CHIP.med}`}>
              {counts.med} med
            </span>
            <span className={`px-2 py-0.5 rounded-sm border font-mono tabular-nums ${RISK_CHIP.low}`}>
              {counts.low} low
            </span>
          </div>
        </div>

        <div className="space-y-1">
          {transcript.segments.map((segment) => (
            <div key={segment.id} ref={segment.id === activeId ? activeRef : null}>
              <Segment
                segment={segment}
                model={model}
                active={segment.id === activeId}
                verified={!!verified[segment.id]}
                edits={edits}
                onSeek={onSeek}
                onWordClick={onWordClick}
                onToggleVerify={onToggleVerify}
              />
            </div>
          ))}
        </div>

        <p className="mt-8 pt-4 border-t border-border text-[11px] text-ink-faint italic">
          End of transcript. All changes are recorded in the audit trail.
        </p>
      </div>
    </main>
  )
}
