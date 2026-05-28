import { useEffect, useMemo, useRef, useState } from 'react'
import type { EditState, ModelName, Risk, RiskDimension, Segment as SegmentType, Transcript } from '../types'
import { segmentRiskFor } from '../lib/segmentRisk'
import Segment from './Segment'

interface Props {
  transcript: Transcript
  model: ModelName
  currentTime: number
  edits: Record<string, EditState>
  verified: Record<number, boolean>
  dimension: RiskDimension
  onSeek: (seconds: number) => void
  onWordClick: (segId: number, wordIdx: number, rect: DOMRect) => void
  onToggleVerify: (segId: number) => void
  onFilterChange?: (filter: string) => void
  onSortChange?: (sort: string) => void
}

const RISK_CHIP: Record<Risk, string> = {
  high: 'bg-risk-high-bg text-risk-high border-risk-high/30',
  med: 'bg-risk-med-bg text-risk-med border-risk-med/30',
  low: 'bg-surface-muted text-ink-muted border-border',
}

type RiskFilter = 'all' | 'high+med' | 'high'
type SortMode = 'chrono' | 'risk'

const RISK_RANK: Record<Risk, number> = { high: 0, med: 1, low: 2 }

function applyFilter(
  segments: SegmentType[],
  filter: RiskFilter,
  riskOf: (s: SegmentType) => Risk,
): SegmentType[] {
  if (filter === 'all') return segments
  if (filter === 'high') return segments.filter((s) => riskOf(s) === 'high')
  return segments.filter((s) => riskOf(s) !== 'low')
}

function applySort(
  segments: SegmentType[],
  mode: SortMode,
  riskOf: (s: SegmentType) => Risk,
): SegmentType[] {
  if (mode === 'chrono') return segments
  return [...segments].sort((a, b) => {
    const r = RISK_RANK[riskOf(a)] - RISK_RANK[riskOf(b)]
    return r !== 0 ? r : a.start - b.start
  })
}

export default function TranscriptView({
  transcript,
  model,
  currentTime,
  edits,
  verified,
  dimension,
  onSeek,
  onWordClick,
  onToggleVerify,
  onFilterChange,
  onSortChange,
}: Props) {
  const [filter, setFilter] = useState<RiskFilter>('all')
  const [sort, setSort] = useState<SortMode>('chrono')

  const setFilterAndLog = (next: RiskFilter) => {
    setFilter(next)
    onFilterChange?.(next)
  }
  const setSortAndLog = (next: SortMode) => {
    setSort(next)
    onSortChange?.(next)
  }

  // Active segment is always computed from the FULL transcript, so the
  // "currently playing" highlight tracks audio regardless of filter/sort.
  const activeId = useMemo(() => {
    const seg = transcript.segments.find(
      (s) => currentTime >= s.start && currentTime < s.end,
    )
    return seg?.id ?? null
  }, [transcript, currentTime])

  // Capture the active dimension's risk lookup so filter, sort and counts
  // all agree with the segment-level bar shown on the left.
  const riskOf = useMemo(
    () => (s: SegmentType) => segmentRiskFor(s, model, dimension),
    [model, dimension],
  )

  const displaySegments = useMemo(
    () => applySort(applyFilter(transcript.segments, filter, riskOf), sort, riskOf),
    [transcript, filter, sort, riskOf],
  )

  const activeRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeId])

  const counts = useMemo(
    () =>
      transcript.segments.reduce(
        (acc, s) => {
          acc[riskOf(s)] += 1
          return acc
        },
        { high: 0, med: 0, low: 0 } as Record<Risk, number>,
      ),
    [transcript, riskOf],
  )

  const isDefaultView = filter === 'all' && sort === 'chrono'

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

          {/* Risk chips + view controls. */}
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
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

            <span className="ml-auto flex items-center gap-2">
              <label className="flex items-center gap-1">
                <span className="text-ink-faint uppercase tracking-widest text-[10px]">Show</span>
                <select
                  value={filter}
                  onChange={(e) => setFilterAndLog(e.target.value as RiskFilter)}
                  className="text-[11px] border border-border rounded px-1.5 py-0.5 bg-white hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong"
                >
                  <option value="all">All segments</option>
                  <option value="high+med">High + medium</option>
                  <option value="high">High risk only</option>
                </select>
              </label>
              <label className="flex items-center gap-1">
                <span className="text-ink-faint uppercase tracking-widest text-[10px]">Order</span>
                <select
                  value={sort}
                  onChange={(e) => setSortAndLog(e.target.value as SortMode)}
                  className="text-[11px] border border-border rounded px-1.5 py-0.5 bg-white hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong"
                >
                  <option value="chrono">Chronological</option>
                  <option value="risk">By risk</option>
                </select>
              </label>
            </span>
          </div>

          {/* View-state indicator. */}
          {!isDefaultView && (
            <div className="mt-3 flex items-center gap-2">
              <span className="inline-flex items-center gap-2 text-[11px] text-risk-med bg-risk-med-bg border border-risk-med/30 rounded-sm px-2 py-0.5">
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 2h8M2 5h6M3 8h4" strokeLinecap="round" />
                </svg>
                <span className="font-mono tabular-nums">
                  {displaySegments.length} of {transcript.segments.length}
                </span>
                <span>
                  {filter !== 'all' && (filter === 'high' ? 'high-risk only' : 'high + medium')}
                  {filter !== 'all' && sort !== 'chrono' && ' · '}
                  {sort === 'risk' && 'sorted by risk'}
                </span>
              </span>
              <button
                onClick={() => {
                  setFilterAndLog('all')
                  setSortAndLog('chrono')
                }}
                className="text-[11px] text-ink-muted hover:text-ink underline decoration-dotted underline-offset-2"
              >
                Reset view
              </button>
            </div>
          )}
        </div>

        <div className="space-y-1">
          {displaySegments.length === 0 ? (
            <p className="py-12 text-center text-xs text-ink-faint italic">
              No segments match the current filter.
            </p>
          ) : (
            displaySegments.map((segment) => (
              <div key={segment.id} ref={segment.id === activeId ? activeRef : null}>
                <Segment
                  segment={segment}
                  model={model}
                  active={segment.id === activeId}
                  verified={!!verified[segment.id]}
                  edits={edits}
                  dimension={dimension}
                  onSeek={onSeek}
                  onWordClick={onWordClick}
                  onToggleVerify={onToggleVerify}
                />
              </div>
            ))
          )}
        </div>

        <p className="mt-8 pt-4 border-t border-border text-[11px] text-ink-faint italic">
          End of transcript. All changes are recorded in the audit trail.
        </p>
      </div>
    </main>
  )
}
