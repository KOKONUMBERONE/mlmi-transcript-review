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
}: Props) {
  const words = segment.words[model] ?? []

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

  const bar = verified ? 'bg-verified-bar' : RISK_BAR[effectiveRisk]

  const containerCls = verified
    ? 'bg-verified-bg ring-1 ring-verified-bar/40'
    : active
    ? 'bg-amber-50 ring-1 ring-amber-300'
    : 'hover:bg-white hover:ring-1 hover:ring-border'

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
      className={`group flex gap-3 rounded-md cursor-pointer transition-colors px-3 py-2 -mx-3 ${containerCls}`}
    >
      <div className={`w-[3px] rounded-full shrink-0 ${bar}`} />

      <div className="flex-1 min-w-0">
        <header className="flex items-center gap-3 mb-1.5">
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

          <span className="ml-auto flex items-center gap-1">
            {onEditSentence && !editing && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  startEdit()
                }}
                title="Edit the whole sentence"
                className="text-[11px] px-1.5 py-0.5 rounded border border-border text-ink-muted bg-white hover:border-ink-muted hover:text-ink transition-colors opacity-60 group-hover:opacity-100"
              >
                <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
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
                className="text-[11px] px-1.5 py-0.5 rounded border border-border text-ink-muted bg-white hover:border-ink-muted hover:text-ink transition-colors opacity-60 group-hover:opacity-100"
              >
                Merge ↓
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onToggleVerify(segment.id, { range: e.shiftKey })
              }}
              title="Shift-click to verify a range"
              className={[
                'text-[11px] px-2 py-0.5 rounded border transition-colors opacity-60 group-hover:opacity-100',
                verified
                  ? 'border-verified text-verified bg-white hover:bg-verified-bg opacity-100'
                  : 'border-border text-ink-muted bg-white hover:border-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {verified ? 'Un-verify' : 'Verify'}
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
              className="w-full text-[15px] leading-snug border border-border rounded px-2 py-1.5 resize-y focus:outline-none focus:ring-1 focus:ring-border-strong"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <button
                onClick={commitEdit}
                disabled={!draft.trim()}
                className="text-xs px-2.5 py-1 rounded bg-ink text-white disabled:opacity-40"
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
          <p className="text-[15px] leading-[1.65] text-ink bg-blue-50 rounded px-1.5 py-0.5 -mx-1 ring-1 ring-blue-200">
            {textOverride}
            <span className="ml-2 align-middle font-mono text-[10px] text-blue-500 uppercase tracking-widest">
              edited
            </span>
          </p>
        ) : (
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
                    focusHit={focusHitFor?.(segment.id, i)}
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
