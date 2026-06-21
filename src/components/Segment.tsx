import { useState } from 'react'
import type { EditState, FocusWordHit, HighlightLayer, ModelName, Segment as SegmentType } from '../types'
import { segmentRiskWithFocus } from '../lib/segmentRisk'
import Word from './Word'

interface Props {
  segment: SegmentType
  model: ModelName
  active: boolean
  verified: boolean
  edits: Record<string, EditState>
  dimension: HighlightLayer
  // Focus mode (2b): whether this segment holds a focus hit, and a lookup for
  // per-word focus markers. Both no-ops when focus is inactive.
  focused: boolean
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
  focused,
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

  // Aggregate the segment-level risk from words under the active dimension, so
  // the left bar + "HIGH RISK" badge follow the toolbar Risk toggle. A focus
  // hit forces the segment to HIGH (display only — 2a scores are untouched).
  const effectiveRisk = segmentRiskWithFocus(segment, model, dimension, focused)

  // No left bar — segment-level risk is shown only by the HIGH RISK badge, and
  // word-level risk by the coloured words (so red lands on the words that matter,
  // not the whole segment). active/verified keep just a faint background tint.
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
      onClick={() => onSeek(segment.start)}
      className={`group flex gap-3 rounded-md cursor-pointer transition-colors px-3 py-1.5 -mx-3 ${containerCls}`}
    >
      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-3 mb-0.5">
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
          <span className="font-mono text-[11px] text-ink-faint tabular-nums">
            {formatTime(segment.start)}
          </span>

          {effectiveRisk === 'high' && !verified && (
            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-white uppercase tracking-wide px-1.5 py-0.5 bg-risk-high rounded">
              <svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
                <path d="M6 1 11 11H1z" />
                <rect x="5.3" y="4.5" width="1.4" height="3.2" fill="#fff" />
                <rect x="5.3" y="8.4" width="1.4" height="1.4" fill="#fff" />
              </svg>
              High risk
            </span>
          )}

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
        ) : textOverride != null ? (
          showChanges ? (
            <p className="text-[14px] leading-[1.5] text-ink bg-change-ins-bg rounded px-1.5 py-0.5 -mx-1 ring-1 ring-change-ins/25">
              {textOverride}
              <span className="ml-2 align-middle font-mono text-[10px] text-change-ins uppercase tracking-widest">
                rewritten
              </span>
            </p>
          ) : (
            <p className="text-[14px] leading-[1.5] text-ink">{textOverride}</p>
          )
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
                    focusHit={focusHitFor?.(segment.id, i)}
                    showChanges={showChanges}
                    onClick={(rect) => onWordClick(segment.id, i, rect)}
                  />
                  {i < words.length - 1 ? ' ' : ''}
                </span>
              )
            })}
          </p>
        )}
      </div>
    </article>
  )
}
