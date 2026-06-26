import { useEffect, useMemo, useState } from 'react'
import type { OutlineChapter, OutlinePart, OutlineResult } from '../types'

interface Props {
  result: OutlineResult | null
  running: boolean
  error?: string | null
  /** Total recording length, shown in the header. */
  audioDuration: number
  /** Drives the "you are here" highlight + auto-expands the current Part. */
  currentTime: number
  onRegenerate: () => void
  onClose: () => void
  /** Jump to a Part / Chapter (seeks the audio). */
  onPartClick: (part: OutlinePart) => void
  onChapterClick: (chapter: OutlineChapter) => void
  /** When true, render as a left side-panel column instead of a centre modal. */
  docked: boolean
  /** Toggle between the centre modal and the docked side panel. */
  onToggleDock: () => void
}

// ---------------------------------------------------------------------------
// The Outline is a two-level table of contents for a long recording: a Summary
// at the top, then coarse Parts (each with a longer description) that expand to
// reveal finer Chapters. It renders in one of two shells:
//   • centre "sub-page" modal — for a focused read of the whole structure;
//   • docked left panel — pinned beside the transcript so you can navigate and
//     read at the same time.
// Clicking a Part/Chapter seeks the audio (and, in modal mode, closes the
// sub-page so the reviewer lands on that passage).
//
// Colour: the Outline is navigation/structure, so it uses the Echo brand navy —
// NOT the violet `focus` colour, which is reserved for case-relevance hits.
// ---------------------------------------------------------------------------

export default function OutlineModal({
  result,
  running,
  error,
  audioDuration,
  currentTime,
  onRegenerate,
  onClose,
  onPartClick,
  onChapterClick,
  docked,
  onToggleDock,
}: Props) {
  const [filter, setFilter] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  const parts = result?.parts ?? []
  const hasParts = parts.length > 0

  // Which Part / Chapter currently holds the playhead (greatest start ≤ t).
  const currentPartId = useMemo(() => findCurrentId(parts, currentTime), [parts, currentTime])
  const currentChapterId = useMemo(() => {
    const all = parts.flatMap((p) => p.chapters)
    return findCurrentId(all, currentTime)
  }, [parts, currentTime])

  // Esc closes — but only in the blocking modal. A docked panel is non-blocking,
  // so Esc-to-dismiss would be surprising (and clash with the filter input).
  useEffect(() => {
    if (docked) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, docked])

  // Auto-expand the Part the playhead sits in, whenever a fresh outline arrives.
  useEffect(() => {
    if (result) setExpanded(new Set(currentPartId != null ? [currentPartId] : []))
    // Only re-seed on a NEW outline, not on every playhead move.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  const q = filter.trim().toLowerCase()
  const filtering = q !== ''

  const visibleParts = useMemo(() => {
    if (!filtering) return parts.map((p) => ({ part: p, chapters: p.chapters }))
    const out: { part: OutlinePart; chapters: OutlineChapter[] }[] = []
    for (const p of parts) {
      const partHit = match(p.title, q) || match(p.description, q)
      const chapterHits = p.chapters.filter((c) => match(c.title, q) || match(c.gist, q))
      if (partHit) out.push({ part: p, chapters: p.chapters })
      else if (chapterHits.length) out.push({ part: p, chapters: chapterHits })
    }
    return out
  }, [parts, filtering, q])

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const inner = (
    <>
      {/* Header */}
      <div className="px-5 py-3 border-b border-border flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <h2 className="text-sm font-semibold text-brand uppercase tracking-[0.18em] shrink-0">
            Outline
          </h2>
          {audioDuration > 0 && !docked && (
            <span className="text-[11px] font-mono text-ink-faint tabular-nums">
              {fmtDuration(audioDuration)} recording
            </span>
          )}
          {hasParts && (
            <span className="text-[11px] text-ink-faint shrink-0">
              {docked ? '' : '· '}
              {parts.length} {parts.length === 1 ? 'part' : 'parts'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {hasParts && (
            <button
              onClick={onRegenerate}
              disabled={running}
              className="text-[11px] px-2 py-1 rounded border border-border text-ink-muted hover:border-ink-muted hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              title="Re-run the local model over the transcript"
            >
              {running ? 'Generating…' : 'Regenerate'}
            </button>
          )}
          {/* Dock / undock: swap between the centre modal and the side panel. */}
          <button
            onClick={onToggleDock}
            aria-label={docked ? 'Expand to centre' : 'Dock to side panel'}
            title={docked ? 'Expand to centre' : 'Dock beside the transcript'}
            className="w-7 h-7 flex items-center justify-center rounded text-ink-muted hover:text-brand hover:bg-surface-muted transition-colors"
          >
            {docked ? (
              // expand / pop-out icon
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4">
                <path d="M8.5 2.5H11.5V5.5M5.5 11.5H2.5V8.5M11.5 2.5l-4 4M2.5 11.5l4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              // dock-to-left icon (panel with a highlighted left rail)
              <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
                <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" />
                <rect x="1.5" y="2.5" width="4" height="9" rx="1.5" fill="currentColor" stroke="none" opacity="0.5" />
              </svg>
            )}
          </button>
          <button
            onClick={onClose}
            aria-label="Close outline"
            className="w-7 h-7 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface-muted transition-colors"
          >
            <svg width="13" height="13" viewBox="0 0 13 13" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2.5 2.5l8 8M10.5 2.5l-8 8" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {error ? (
          <div className="rounded border border-risk-med/30 bg-risk-med-bg px-3 py-2.5">
            <p className="text-[12px] font-semibold text-risk-med">
              Outline needs the local model
            </p>
            <p className="mt-1 text-[11px] text-ink-muted leading-snug break-words">{error}</p>
            <p className="mt-1.5 text-[11px] text-ink-faint leading-snug">
              The model runs locally on port 8000 — make sure it (and Ollama) are
              running, then Regenerate.
            </p>
          </div>
        ) : running && !hasParts ? (
          <div className="py-16 flex flex-col items-center gap-3 text-ink-faint">
            <span className="inline-block w-6 h-6 rounded-full border-2 border-brand/60 border-t-transparent animate-spin" />
            <p className="text-[12px]">Reading the transcript…</p>
            <p className="text-[11px] text-ink-faint/80">
              A local model is chaptering the recording — nothing is uploaded.
            </p>
          </div>
        ) : !hasParts ? (
          <p className="py-16 text-center text-[12px] text-ink-faint italic leading-relaxed">
            No outline yet. Generate one to see the recording as a summary plus
            jump-to sections.
          </p>
        ) : (
          <>
            {/* Summary */}
            {result?.summary && (
              <div className="mb-4 border-l-2 border-brand/50 bg-brand-bg rounded-r px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-[0.18em] text-brand font-semibold mb-1">
                  Overview
                </p>
                <p className="text-[12.5px] leading-relaxed text-ink-muted">
                  {result.summary}
                </p>
              </div>
            )}

            {/* Filter */}
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter sections…"
              className="w-full mb-3 text-[12px] border border-border rounded px-2.5 py-1.5 bg-white placeholder:text-ink-faint/60 focus:outline-none focus:ring-1 focus:ring-brand/50 focus:border-brand/50"
            />

            {visibleParts.length === 0 ? (
              <p className="py-8 text-center text-[11px] text-ink-faint italic">
                No sections match “{filter}”.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {visibleParts.map(({ part, chapters }) => {
                  const isCurrent = part.id === currentPartId
                  const isOpen = filtering || expanded.has(part.id)
                  return (
                    <li
                      key={part.id}
                      className={[
                        'rounded border transition-colors',
                        isCurrent
                          ? 'border-brand/40 bg-brand-bg'
                          : 'border-border hover:border-border-strong',
                      ].join(' ')}
                    >
                      {/* Part header row */}
                      <div className="flex items-stretch">
                        <button
                          onClick={() => toggle(part.id)}
                          aria-label={isOpen ? 'Collapse section' : 'Expand section'}
                          className="px-2 flex items-center text-ink-faint hover:text-ink shrink-0"
                        >
                          <svg
                            width="11"
                            height="11"
                            viewBox="0 0 12 12"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            className={`transition-transform ${isOpen ? 'rotate-90' : ''}`}
                          >
                            <path d="M4.5 2.5 8 6l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        <button
                          onClick={() => onPartClick(part)}
                          className="flex-1 text-left py-2 pr-3 group min-w-0"
                          title="Jump to this section"
                        >
                          <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-mono text-brand/70 tabular-nums shrink-0">
                              {part.id}
                            </span>
                            <h3 className="text-[13px] font-semibold text-ink group-hover:text-brand leading-snug">
                              {part.title}
                            </h3>
                            {isCurrent && (
                              <span className="text-[9px] uppercase tracking-wide text-brand font-semibold shrink-0">
                                ▶ playing
                              </span>
                            )}
                            <span className="ml-auto text-[10px] font-mono text-ink-faint tabular-nums shrink-0 pl-2">
                              {mmss(part.segment_start)}–{mmss(part.segment_end)}
                            </span>
                          </div>
                          {part.description && (
                            <p className="mt-1 text-[12px] leading-relaxed text-ink-muted">
                              {part.description}
                            </p>
                          )}
                        </button>
                      </div>

                      {/* Nested chapters */}
                      {isOpen && chapters.length > 0 && (
                        <ol className="border-t border-border/60 divide-y divide-border/40">
                          {chapters.map((c) => (
                            <li key={c.id}>
                              <button
                                onClick={() => onChapterClick(c)}
                                className={[
                                  'w-full text-left pl-8 pr-3 py-1.5 hover:bg-brand/5 transition-colors group',
                                  c.id === currentChapterId ? 'bg-brand-bg' : '',
                                ].join(' ')}
                                title="Jump to this chapter"
                              >
                                <div className="flex items-baseline gap-2">
                                  <span className="text-[12px] text-ink group-hover:text-brand leading-snug">
                                    {c.title}
                                  </span>
                                  <span className="ml-auto text-[10px] font-mono text-ink-faint tabular-nums shrink-0 pl-2">
                                    {mmss(c.segment_start)}
                                  </span>
                                </div>
                                {c.gist && (
                                  <p className="text-[11px] leading-snug text-ink-faint group-hover:text-ink-muted line-clamp-2">
                                    {c.gist}
                                  </p>
                                )}
                              </button>
                            </li>
                          ))}
                        </ol>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 py-2 border-t border-border shrink-0">
        <p className="text-[10px] text-ink-faint">
          Generated by a local model · nothing leaves this machine · the
          transcript is never changed.
        </p>
      </div>
    </>
  )

  // Docked: a left side-panel column, pinned beside the transcript.
  if (docked) {
    return (
      <aside
        className="w-80 shrink-0 border-r border-border bg-white flex flex-col overflow-hidden"
        aria-label="Transcript outline"
      >
        {inner}
      </aside>
    )
  }

  // Centre "sub-page" modal.
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-ink/40 backdrop-blur-[2px] px-4 py-[6vh]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl max-h-[85vh] bg-white rounded-lg shadow-xl border border-border flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Transcript outline"
      >
        {inner}
      </div>
    </div>
  )
}

// Item (Part or Chapter) whose start is the greatest one ≤ t — i.e. the one the
// playhead currently sits in. Returns null if t is before everything.
function findCurrentId(
  items: { id: number; segment_start: number; segment_end: number }[],
  t: number,
): number | null {
  let best: number | null = null
  for (const it of items) {
    if (it.segment_start <= t + 0.001) best = it.id
    else break
  }
  return best
}

function match(s: string, q: string): boolean {
  return (s || '').toLowerCase().includes(q)
}

function mmss(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fmtDuration(seconds: number): string {
  const sec = Math.max(0, Math.round(seconds))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return s === 0 ? `${m}m` : `${m}m ${s}s`
  return `${s}s`
}
