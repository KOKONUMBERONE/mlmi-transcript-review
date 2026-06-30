import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { EditState, FocusWordHit, HighlightLayer, ModelName, Risk, Segment as SegmentType, Transcript } from '../types'
import { segmentRiskWithFocus } from '../lib/segmentRisk'
import { combinedSegmentRisk } from '../lib/displayRisk'
import Segment from './Segment'

interface Props {
  transcript: Transcript
  model: ModelName
  currentTime: number
  edits: Record<string, EditState>
  verified: Record<number, boolean>
  dimension: HighlightLayer
  // Deployment regime: per-word display-risk override for the combined dimension
  // (`${segId}-${wordIdx}` → Risk). null = study / pass-through (raw combined_risk).
  displayRiskMap?: Map<string, Risk> | null
  // Progressive disclosure: which segment (if any) is expanded to word level.
  expandedSegmentId: number | null
  onToggleExpand: (segId: number) => void
  // Single-click a segment → seek there + play it (and pin it open).
  onPlaySegment: (segId: number) => void
  collapsedHighUnderline: boolean
  // C1 hides the risk chips + Show/Order controls (plain text, no risk shown).
  showViewControls?: boolean
  // Focus mode (2b): which segments hold a hit + a per-word marker lookup.
  focusActive: boolean
  focusSegmentIds: Set<number>
  focusHitFor?: (segId: number, wordIdx: number) => FocusWordHit | undefined
  onSeek: (seconds: number) => void
  onWordClick: (segId: number, wordIdx: number, rect: DOMRect) => void
  onToggleVerify: (segId: number, opts?: { range?: boolean }) => void
  onBulkVerify?: (segIds: number[], value: boolean) => void
  // #1 whole-sentence edit + #2 structural edits, threaded to each Segment.
  segmentTextEdits?: Record<number, { text: string; reason?: string }>
  onEditSentence?: (segId: number, text: string) => void
  onMergeNext?: (segId: number) => void
  onChangeSpeaker?: (segId: number, speaker: string) => void
  onFilterChange?: (filter: string) => void
  onSortChange?: (sort: string) => void
  // Fires when a segment scrolls ≥60% into view (complements segment_focus,
  // which only fires from audio playback). Must be a *stable* callback.
  onSegmentView?: (segId: number, start: number, risk: Risk) => void
  // Fires when the pointer DWELLS on a segment (≥ HOVER_DWELL_MS) — debounced so
  // quick sweeps don't flood the log. Stable callback.
  onSegmentHover?: (segId: number, start: number, risk: Risk) => void
  // Track-changes view + per-segment "<reviewer> · <hh:mm>" of the last edit.
  showChanges?: boolean
  editInfo?: Record<number, { reviewer: string; time: string }>
}

const RISK_CHIP: Record<Risk, string> = {
  high: 'bg-risk-high-bg text-risk-high border-risk-high/30',
  med: 'bg-risk-med-bg text-risk-med border-risk-med/30',
  low: 'bg-surface-muted text-ink-muted border-border',
}

type RiskFilter = 'all' | 'high+med' | 'high'
type SortMode = 'chrono' | 'risk'

const RISK_RANK: Record<Risk, number> = { high: 0, med: 1, low: 2 }

// Dwell before a hover counts as a logged segment_hover (ms). Long enough that a
// quick sweep across segments logs nothing; short enough to catch real reading.
const HOVER_DWELL_MS = 500

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
  displayRiskMap,
  expandedSegmentId,
  onToggleExpand,
  onPlaySegment,
  collapsedHighUnderline,
  showViewControls = true,
  focusActive,
  focusSegmentIds,
  focusHitFor,
  onSeek,
  onWordClick,
  onToggleVerify,
  onBulkVerify,
  segmentTextEdits,
  onEditSentence,
  onMergeNext,
  onChangeSpeaker,
  onFilterChange,
  onSortChange,
  onSegmentView,
  onSegmentHover,
  showChanges = true,
  editInfo,
}: Props) {
  const [filter, setFilter] = useState<RiskFilter>('all')
  const [sort, setSort] = useState<SortMode>('chrono')
  // Transient hover-reveal (local + unlogged): hovering a segment shows its
  // word-level risk; moving away collapses it (unless pinned/playing).
  const [hoveredId, setHoveredId] = useState<number | null>(null)
  const handleHover = useCallback((id: number | null) => setHoveredId(id), [])

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

  // Karaoke: index of the word currently being spoken, scanned in the ACTIVE
  // segment only (cheap — ~tens of words, not the whole transcript). null when
  // no segment is active or the words carry no timestamps (graceful no-op).
  const activeWordIndex = useMemo(() => {
    if (activeId == null) return null
    const seg = transcript.segments.find((s) => s.id === activeId)
    const ws = seg?.words[model] ?? []
    for (let i = 0; i < ws.length; i++) {
      const w = ws[i]
      if (w.start != null && w.end != null && currentTime >= w.start && currentTime < w.end) return i
    }
    return null
  }, [transcript, model, activeId, currentTime])

  // Capture the active dimension's risk lookup so filter, sort and counts
  // all agree with the segment-level bar shown on the left. In focus mode a
  // segment with a hit reads HIGH, so it surfaces under "High risk only" /
  // "By risk" too.
  const riskOf = useMemo(
    () => (s: SegmentType) => {
      const focused = focusActive && focusSegmentIds.has(s.id)
      return displayRiskMap
        ? combinedSegmentRisk(s, model, displayRiskMap, focused)
        : segmentRiskWithFocus(s, model, dimension, focused)
    },
    [model, dimension, focusActive, focusSegmentIds, displayRiskMap],
  )

  const displaySegments = useMemo(
    () => applySort(applyFilter(transcript.segments, filter, riskOf), sort, riskOf),
    [transcript, filter, sort, riskOf],
  )

  // Debounced segment_hover: log only when the pointer DWELLS on a segment
  // (≥ HOVER_DWELL_MS), so a quick sweep across segments doesn't flood the log.
  // The effect cleanup cancels the pending timer when the hover moves away.
  useEffect(() => {
    if (hoveredId == null || !onSegmentHover) return
    const seg = transcript.segments.find((s) => s.id === hoveredId)
    if (!seg) return
    const t = setTimeout(() => onSegmentHover(seg.id, seg.start, riskOf(seg)), HOVER_DWELL_MS)
    return () => clearTimeout(t)
  }, [hoveredId, transcript, onSegmentHover, riskOf])

  const activeRef = useRef<HTMLDivElement>(null)
  const scrollRootRef = useRef<HTMLElement>(null)

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [activeId])

  // Emit segment_view when a segment scrolls ≥60% into view, capturing reading
  // attention even when the reviewer never plays that part of the audio.
  useEffect(() => {
    if (!onSegmentView) return
    const root = scrollRootRef.current
    const obs = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (!e.isIntersecting) continue
          const el = e.target as HTMLElement
          onSegmentView(
            Number(el.dataset.segmentId),
            Number(el.dataset.segmentStart),
            (el.dataset.segmentRisk ?? 'low') as Risk,
          )
        }
      },
      { root, threshold: 0.6 },
    )
    const nodes = (root ?? document).querySelectorAll('[data-segment-id]')
    nodes.forEach((n) => obs.observe(n))
    return () => obs.disconnect()
  }, [onSegmentView, displaySegments])

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
    <main ref={scrollRootRef} className="flex-1 overflow-y-auto">
      <div className="max-w-5xl mx-auto px-8 py-5">
        <div className="mb-6 pb-4 border-b border-border">
          <div className="flex items-baseline justify-between mb-3">
            <h1 className="text-[11px] text-ink-faint uppercase tracking-[0.2em]">
              Transcript · Case 447
            </h1>
            <p className="font-mono text-[11px] text-ink-faint">{model}</p>
          </div>

          {/* Risk chips + view controls (hidden in C1 — plain text). */}
          {showViewControls && (
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
          )}

          {/* View-state indicator. */}
          {showViewControls && !isDefaultView && (
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

          {onBulkVerify && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-ink-faint uppercase tracking-widest text-[10px]">Verify</span>
              <button
                onClick={() => onBulkVerify(displaySegments.map((s) => s.id), true)}
                className="px-2 py-0.5 rounded border border-verified/50 text-verified bg-white hover:bg-verified-bg transition-colors"
                title="Verify every currently-shown segment"
              >
                ✓ All shown{filter !== 'all' ? ` (${displaySegments.length})` : ''}
              </button>
              <button
                onClick={() => onBulkVerify(displaySegments.map((s) => s.id), false)}
                className="px-2 py-0.5 rounded border border-border text-ink-muted bg-white hover:border-ink-muted hover:text-ink transition-colors"
                title="Un-verify every currently-shown segment"
              >
                Un-verify all shown
              </button>
              <span className="text-ink-faint hidden md:inline">· or Shift-click a segment's Verify to select a range</span>
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
              <div
                key={segment.id}
                ref={segment.id === activeId ? activeRef : null}
                data-segment-id={segment.id}
                data-segment-start={segment.start}
                data-segment-risk={riskOf(segment)}
              >
                <Segment
                  segment={segment}
                  model={model}
                  active={segment.id === activeId}
                  verified={!!verified[segment.id]}
                  edits={edits}
                  dimension={dimension}
                  expanded={segment.id === expandedSegmentId || segment.id === hoveredId}
                  onToggleExpand={onToggleExpand}
                  onPlaySegment={onPlaySegment}
                  onHover={handleHover}
                  segmentRisk={riskOf(segment)}
                  collapsedHighUnderline={collapsedHighUnderline}
                  activeWordIndex={segment.id === activeId ? activeWordIndex : null}
                  activeTime={segment.id === activeId ? currentTime : undefined}
                  displayRiskMap={displayRiskMap}
                  focusHitFor={focusHitFor}
                  onSeek={onSeek}
                  onWordClick={onWordClick}
                  onToggleVerify={onToggleVerify}
                  textOverride={segmentTextEdits?.[segment.id]?.text}
                  onEditSentence={onEditSentence}
                  onMergeNext={onMergeNext}
                  canMergeNext={
                    transcript.segments[transcript.segments.length - 1]?.id !== segment.id
                  }
                  onChangeSpeaker={onChangeSpeaker}
                  showChanges={showChanges}
                  editLabel={
                    editInfo?.[segment.id]
                      ? `${editInfo[segment.id].reviewer} · ${editInfo[segment.id].time}`
                      : undefined
                  }
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
