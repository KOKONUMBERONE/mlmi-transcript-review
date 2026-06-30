import { useEffect, useRef, useState } from 'react'
import type { EditState, FocusWordHit, HighlightLayer, ModelName, Risk, Segment as SegmentType } from '../types'
import Word from './Word'
import { matchOverrideTokens } from '../lib/retainRisk'

interface Props {
  segment: SegmentType
  model: ModelName
  active: boolean
  verified: boolean
  edits: Record<string, EditState>
  dimension: HighlightLayer
  // Progressive disclosure: when collapsed, the sentence shows only a head risk
  // dot (+ a quiet HIGH underline); clicking it expands to full word-level risk.
  expanded: boolean
  onToggleExpand: (segId: number) => void
  // Single-click the sentence body → seek there + play it (and pin it open).
  onPlaySegment?: (segId: number) => void
  // Hover-reveal: transiently show this segment's word-level risk while hovered.
  onHover?: (segId: number | null) => void
  // Policy-aware segment risk, computed once in TranscriptView (riskOf). Drives
  // the sentence-head dot — reused here, never recomputed.
  segmentRisk: Risk
  // Soft vs pure collapsed look — threaded straight to Word.
  collapsedHighUnderline: boolean
  // Karaoke: index of the word currently being spoken in THIS segment, or null.
  // Only the active (playing) segment ever receives a non-null value.
  activeWordIndex?: number | null
  // Deployment regime: per-word display-risk override for the combined dimension.
  // null = study / pass-through (Word falls back to combined_risk).
  displayRiskMap?: Map<string, Risk> | null
  // Focus mode (2b): per-word focus marker lookup. No-op when focus is inactive.
  focusHitFor?: (segId: number, wordIdx: number) => FocusWordHit | undefined
  onSeek: (seconds: number) => void
  onWordClick: (segId: number, wordIdx: number, rect: DOMRect) => void
  // Single toggle; shift-click verifies the range from the last-clicked segment.
  onToggleVerify: (segId: number, opts?: { range?: boolean }) => void
  // #1 whole-sentence edit. When textOverride is set, the segment is rendered as
  // one rewritten block (per-word highlighting is dropped).
  textOverride?: string
  onEditSentence?: (segId: number, text: string) => void
  // #2 structural edits.
  onMergeNext?: (segId: number) => void
  canMergeNext?: boolean
  onChangeSpeaker?: (segId: number, speaker: string) => void
  // Track-changes view (threaded to each Word). Default on.
  showChanges?: boolean
  // "<reviewer> · <hh:mm>" of the latest change in this segment, if any.
  editLabel?: string
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
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
  expanded,
  onToggleExpand,
  onPlaySegment,
  onHover,
  segmentRisk,
  collapsedHighUnderline,
  activeWordIndex,
  displayRiskMap,
  focusHitFor,
  onSeek,
  onWordClick,
  onToggleVerify,
  textOverride,
  onEditSentence,
  onMergeNext,
  canMergeNext = false,
  onChangeSpeaker,
  showChanges = true,
  editLabel,
}: Props) {
  const words = segment.words[model] ?? []

  // Has the reviewer changed anything in this segment? Drives the change-bar
  // + "edited" tag so a touched segment is obvious at a glance.
  const hasEdits =
    textOverride != null || words.some((_, i) => edits[`${segment.id}-${i}`] !== undefined)

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [editingSpeaker, setEditingSpeaker] = useState(false)
  const [speakerDraft, setSpeakerDraft] = useState('')

  // Single-click = play this segment; double-click = edit it. Defer the
  // single-click so a double-click can cancel it (no stray play + edit).
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (clickTimer.current) clearTimeout(clickTimer.current) }, [])

  // Current rendered sentence (edits applied, deletions dropped) — prefill for
  // the whole-sentence editor.
  const fullText =
    textOverride ??
    words
      .map((w, i) => {
        const e = edits[`${segment.id}-${i}`]
        if (e?.deleted) return ''
        return e ? e.text : w.text
      })
      .filter(Boolean)
      .join(' ')

  // No left bar, no segment-level "HIGH RISK" badge — segment risk is conveyed
  // purely by the coloured words (so red lands on the words that matter, not the
  // whole segment). active/verified keep just a faint background tint.
  const containerCls = verified
    ? 'bg-verified-bg/50 ring-1 ring-verified-bar/30'
    : active
    ? 'bg-brand-active/50 ring-1 ring-brand/25'
    : 'hover:bg-surface-muted hover:ring-1 hover:ring-border'

  const startEdit = () => {
    setDraft(fullText)
    setEditing(true)
  }
  const commitEdit = () => {
    const v = draft.trim()
    if (v) onEditSentence?.(segment.id, v)
    setEditing(false)
  }
  const commitSpeaker = () => {
    const v = speakerDraft.trim()
    if (v && v !== segment.speaker) onChangeSpeaker?.(segment.id, v)
    setEditingSpeaker(false)
  }

  return (
    <article
      onMouseEnter={() => onHover?.(segment.id)}
      onMouseLeave={() => onHover?.(null)}
      className={`group flex gap-3 rounded-md transition-colors px-3 py-1.5 -mx-3 ${containerCls}`}
    >
      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-3 mb-0.5">
          {/* Expand affordance + sentence-head risk dot (the sentence-level
              signal that replaces always-on word colour). */}
          <span className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleExpand(segment.id)
              }}
              title={expanded ? 'Collapse — hide word-level risk' : 'Show word-level risk'}
              aria-expanded={expanded}
              className="text-ink-faint hover:text-ink p-0.5 -ml-1 rounded hover:bg-surface-muted transition-colors"
            >
              <svg
                className={`w-3 h-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
                viewBox="0 0 12 12"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                aria-hidden="true"
              >
                <path d="M4.5 3l3 3-3 3" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {/* Only HIGH risk gets a head dot; medium shows nothing (just the
                chevron). Keeps the overview quiet — red means "look here". */}
            {segmentRisk === 'high' && (
              <span
                aria-hidden="true"
                title="High risk"
                className="w-2 h-2 rounded-full bg-risk-high"
              />
            )}
          </span>
          {editingSpeaker ? (
            <input
              autoFocus
              value={speakerDraft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setSpeakerDraft(e.target.value)}
              onBlur={commitSpeaker}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitSpeaker()
                if (e.key === 'Escape') setEditingSpeaker(false)
              }}
              placeholder="Speaker…"
              className="text-[11px] uppercase tracking-wide border border-border rounded px-1.5 py-0.5 w-28 focus:outline-none focus:ring-1 focus:ring-border-strong"
            />
          ) : (
            <span
              onClick={
                onChangeSpeaker
                  ? (e) => {
                      e.stopPropagation()
                      setSpeakerDraft(segment.speaker)
                      setEditingSpeaker(true)
                    }
                  : undefined
              }
              title={onChangeSpeaker ? 'Click to change speaker' : undefined}
              className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${
                SPEAKER_COLOR[segment.speaker] ?? SPEAKER_COLOR_DEFAULT
              } ${onChangeSpeaker ? 'cursor-pointer hover:underline decoration-dotted underline-offset-2' : ''}`}
            >
              {segment.speaker}
            </span>
          )}
          {/* Seek lives on the timestamp now (the sentence body click expands
              instead of seeking). */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onSeek(segment.start)
            }}
            title="Play from here"
            className="font-mono text-[11px] text-ink-faint tabular-nums hover:text-brand transition-colors"
          >
            {formatTime(segment.start)}
          </button>

          {active && (
            <span className="font-mono text-[10px] text-brand uppercase tracking-widest">
              ▸ playing
            </span>
          )}

          {verified && (
            <span className="font-mono text-[10px] text-verified uppercase tracking-widest">
              ✓ verified
            </span>
          )}

          {hasEdits && (
            <span
              className="inline-flex items-center gap-1 text-[10px] text-change-ins bg-change-ins-bg border border-change-ins/40 rounded-full px-1.5 py-0.5 leading-none"
              title="Reviewer-edited segment"
            >
              <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M8.5 1.5 10.5 3.5 4 10 1.5 10.5 2 8z" strokeLinejoin="round" />
              </svg>
              edited{editLabel ? ` · ${editLabel}` : ''}
            </span>
          )}

          <span className="ml-auto flex items-center gap-1">
            {/* Edit a whole sentence — high-frequency, so it's always visible
                (but quiet). Merge is rarer, so it only appears on hover. */}
            {onEditSentence && !editing && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  startEdit()
                }}
                title="Edit the whole sentence"
                className="text-ink-muted hover:text-ink p-1 rounded hover:bg-surface-muted transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M8.5 1.5 10.5 3.5 4 10 1.5 10.5 2 8z" strokeLinejoin="round" />
                </svg>
              </button>
            )}
            {onMergeNext && canMergeNext && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onMergeNext(segment.id)
                }}
                title="Merge with the next segment"
                className="text-ink-faint hover:text-ink p-1 rounded hover:bg-surface-muted opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M6 1.5V7M3.5 4.5 6 7l2.5-2.5" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M2 10h8" strokeLinecap="round" />
                </svg>
              </button>
            )}
            {/* Verify — kept quiet by default (a column of solid buttons drowns
                the transcript); it goes solid navy only on the segment you're
                on or hovering. Verified is a calm green. */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleVerify(segment.id, { range: e.shiftKey })
              }}
              title="Mark this segment checked. Shift-click to verify a range."
              className={[
                'text-[11px] font-medium px-2.5 py-1 rounded transition-colors',
                verified
                  ? 'border border-verified/40 text-verified bg-verified-bg/60'
                  : active
                  ? 'bg-brand text-white hover:bg-brand-dark shadow-sm'
                  : 'border border-border text-ink-muted bg-white group-hover:border-brand group-hover:text-brand',
              ].join(' ')}
            >
              {verified ? '✓ Verified' : 'Verify'}
            </button>
          </span>
        </header>

        {editing ? (
          <div onClick={(e) => e.stopPropagation()}>
            <textarea
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={3}
              className="w-full text-[14px] leading-snug border border-border rounded px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-border-strong"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={commitEdit}
                disabled={!draft.trim()}
                className="text-xs px-2.5 py-1 rounded bg-brand text-white hover:bg-brand-dark disabled:opacity-40"
              >
                Save
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-xs px-2.5 py-1 rounded border border-border text-ink-muted hover:text-ink"
              >
                Cancel
              </button>
              <span className="text-[10px] text-ink-faint italic">
                Rewriting the sentence drops per-word risk highlighting for this segment.
              </span>
            </div>
          </div>
        ) : (
          // Single-click the sentence body → seek there + play it (deferred so a
          // double-click can cancel it). Double-click → edit the whole sentence.
          // Hover already reveals word-level risk; the chevron is the
          // expand-without-play control. Word/button clicks stopPropagation.
          <div
            onClick={() => {
              if (clickTimer.current) clearTimeout(clickTimer.current)
              clickTimer.current = setTimeout(() => {
                clickTimer.current = null
                onPlaySegment?.(segment.id)
              }, 250)
            }}
            onDoubleClick={(e) => {
              e.preventDefault()
              if (clickTimer.current) {
                clearTimeout(clickTimer.current)
                clickTimer.current = null
              }
              startEdit()
            }}
            role="button"
            aria-expanded={expanded}
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                onPlaySegment?.(segment.id)
              }
            }}
            title="Click to play this segment · double-click to edit"
            className="cursor-pointer"
          >
            {textOverride != null ? (
              // Rewritten sentence: keep risk on words that survived the rewrite
              // (diff-retain). Matched tokens render via <Word> (inherit risk +
              // honour expand/collapse); new/changed tokens render plain.
              <p
                className={
                  showChanges
                    ? 'text-[14px] leading-[1.5] text-ink bg-change-ins-bg rounded px-1.5 py-0.5 -mx-1 ring-1 ring-change-ins/25'
                    : 'text-[14px] leading-[1.5] text-ink'
                }
              >
                {matchOverrideTokens(textOverride, words).map((tok, i, arr) => (
                  <span key={i}>
                    {tok.word ? (
                      <Word
                        word={tok.word}
                        displayText={tok.text}
                        edited={false}
                        deleted={false}
                        dimension={dimension}
                        expanded={expanded}
                        collapsedHighUnderline={collapsedHighUnderline}
                        isActiveWord={false}
                        displayRisk={
                          dimension === 'combined'
                            ? displayRiskMap?.get(`${segment.id}-${tok.index}`)
                            : undefined
                        }
                        showChanges={false}
                        segId={segment.id}
                        wordIdx={tok.index ?? 0}
                        onWordClick={onWordClick}
                      />
                    ) : (
                      tok.text
                    )}
                    {i < arr.length - 1 ? ' ' : ''}
                  </span>
                ))}
                {showChanges && (
                  <span className="ml-2 align-middle font-mono text-[10px] text-change-ins uppercase tracking-widest">
                    rewritten
                  </span>
                )}
              </p>
            ) : (
              <p className="text-[14px] leading-[1.5] text-ink">
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
                        expanded={expanded}
                        collapsedHighUnderline={collapsedHighUnderline}
                        isActiveWord={expanded && i === activeWordIndex}
                        displayRisk={
                          dimension === 'combined'
                            ? displayRiskMap?.get(`${segment.id}-${i}`)
                            : undefined
                        }
                        focusHit={focusHitFor?.(segment.id, i)}
                        showChanges={showChanges}
                        segId={segment.id}
                        wordIdx={i}
                        onWordClick={onWordClick}
                      />
                      {i < words.length - 1 ? ' ' : ''}
                    </span>
                  )
                })}
              </p>
            )}
          </div>
        )}
      </div>
    </article>
  )
}
