import { useEffect, useMemo, useRef, useState } from 'react'
import type { ModelName, Segment } from '../types'

export interface PopupAnchor {
  segId: number
  wordIdx: number
  rect: DOMRect
}

interface Props {
  anchor: PopupAnchor
  segment: Segment
  availableModels: ModelName[]
  activeModel: ModelName
  currentText: string
  isDeleted: boolean
  onApply: (newText: string, reason?: string) => void
  onDelete: (reason?: string) => void
  onClose: () => void
}

export default function CandidatePopup({
  anchor,
  segment,
  availableModels,
  activeModel,
  currentText,
  isDeleted,
  onApply,
  onDelete,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [manual, setManual] = useState('')
  const [reason, setReason] = useState('')

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  const candidates = useMemo(() => {
    const out: { text: string; models: ModelName[] }[] = []
    for (const m of availableModels) {
      const word = segment.words[m]?.[anchor.wordIdx]
      if (!word) continue
      const text = word.text
      if (!text) continue
      const existing = out.find((c) => c.text === text)
      if (existing) existing.models.push(m)
      else out.push({ text, models: [m] })
    }
    return out
  }, [availableModels, segment, anchor.wordIdx])

  const submitReason = () => (reason.trim() ? reason.trim() : undefined)

  const top = anchor.rect.bottom + 6
  const left = Math.min(anchor.rect.left, window.innerWidth - 300)

  return (
    <div
      ref={ref}
      style={{ position: 'fixed', top, left, width: 280, zIndex: 50 }}
      className="bg-white border border-border-strong rounded-md shadow-lg p-3 text-sm"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-baseline justify-between mb-2">
        <p className="text-[10px] uppercase tracking-widest text-ink-faint">
          {isDeleted ? 'Restore word' : 'Word candidates'}
        </p>
        <p className="font-mono text-[10px] text-ink-faint">
          seg {anchor.segId} · #{anchor.wordIdx + 1}
        </p>
      </div>

      <ul className="space-y-1 mb-2">
        {candidates.map((c) => {
          const isCurrent = !isDeleted && c.text === currentText
          return (
            <li key={c.text}>
              <button
                onClick={() => onApply(c.text, submitReason())}
                className={[
                  'w-full text-left px-2 py-1.5 rounded border transition-colors',
                  isCurrent
                    ? 'border-ink-muted bg-surface-muted'
                    : 'border-border hover:bg-surface-muted',
                ].join(' ')}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium text-ink">{c.text}</span>
                  <span className="text-[10px] text-ink-faint">
                    {c.models.map((m) => m.replace(/\s*\(.*\)/, '')).join(', ')}
                  </span>
                </div>
              </button>
            </li>
          )
        })}
      </ul>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          const v = manual.trim()
          if (v) onApply(v, submitReason())
        }}
        className="border-t border-border pt-2 flex gap-1 mb-2"
      >
        <input
          autoFocus
          type="text"
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          placeholder="Manual correction…"
          className="flex-1 text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-border-strong"
        />
        <button
          type="submit"
          disabled={!manual.trim()}
          className="text-xs px-2 py-1 rounded bg-ink text-white disabled:opacity-40"
        >
          Apply
        </button>
      </form>

      {/* Reason note — shared by Apply and Delete. */}
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder='Reason (optional, e.g. "not in audio")'
        className="w-full text-xs border border-border rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-border-strong mb-2"
      />

      {/* Delete / hallucination */}
      {!isDeleted && (
        <button
          onClick={() => onDelete(submitReason())}
          className="w-full flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded border border-risk-high/40 text-risk-high hover:bg-risk-high-bg transition-colors"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path d="M2 2l6 6M8 2l-6 6" strokeLinecap="round" />
          </svg>
          Delete (hallucination)
        </button>
      )}
      {isDeleted && (
        <p className="text-[10px] text-ink-faint italic text-center">
          Currently marked as deleted. Pick a candidate or type a correction to restore.
        </p>
      )}

      <p className="mt-2 text-[10px] text-ink-faint italic">
        Active model: {activeModel.replace(/\s*\(.*\)/, '')}
      </p>
    </div>
  )
}
