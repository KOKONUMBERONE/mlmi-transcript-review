import { useState } from 'react'
import { exportEventLogAsCSV, exportEventLogAsJSON } from '../utils/exportEventLog'
import type { LogEvent } from '../types'

const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ['Space'], label: 'Play / pause' },
  { keys: ['←', '→'], label: 'Seek ±5 s' },
  { keys: ['J'], label: 'Previous segment' },
  { keys: ['K'], label: 'Next segment' },
  { keys: ['V'], label: 'Verify active segment' },
]

interface Props {
  /** Returns the latest in-memory event log. Called only when the researcher
   *  clicks an export button — never on render. */
  getEvents: () => LogEvent[]
  onExport: (kind: 'events_json' | 'events_csv', count: number) => void
}

export default function ShortcutLegend({ getEvents, onExport }: Props) {
  const [open, setOpen] = useState(false)

  const handleExport = (kind: 'events_json' | 'events_csv') => {
    const events = getEvents()
    onExport(kind, events.length)
    if (kind === 'events_json') exportEventLogAsJSON(events)
    else exportEventLogAsCSV(events)
  }

  return (
    <div className="fixed bottom-3 right-3 z-40">
      {open && (
        <div className="mb-2 w-64 bg-white border border-border rounded-md shadow-lg p-3">
          <p className="text-[10px] text-ink-faint uppercase tracking-[0.2em] mb-2">
            Keyboard shortcuts
          </p>
          <ul className="space-y-1.5 mb-3">
            {SHORTCUTS.map((s) => (
              <li
                key={s.label}
                className="flex items-center justify-between text-xs"
              >
                <span className="text-ink">{s.label}</span>
                <span className="flex items-center gap-1">
                  {s.keys.map((k) => (
                    <kbd
                      key={k}
                      className="font-mono text-[10px] px-1.5 py-0.5 bg-surface-muted border border-border rounded text-ink-muted min-w-[1.25rem] text-center"
                    >
                      {k}
                    </kbd>
                  ))}
                </span>
              </li>
            ))}
          </ul>

          {/* Researcher-only event-log export. Tucked here rather than in the
              main UI because it's not for the reviewer. */}
          <div className="pt-2 border-t border-border">
            <p className="text-[10px] text-ink-faint uppercase tracking-[0.2em] mb-1.5">
              Researcher
            </p>
            <p className="text-[10px] text-ink-faint leading-snug mb-2">
              Behavioural event log (session data for analysis).
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => handleExport('events_json')}
                className="text-[11px] font-mono px-2 py-0.5 border border-border rounded hover:border-border-strong text-ink-muted hover:text-ink transition-colors"
              >
                Events JSON
              </button>
              <button
                onClick={() => handleExport('events_csv')}
                className="text-[11px] font-mono px-2 py-0.5 border border-border rounded hover:border-border-strong text-ink-muted hover:text-ink transition-colors"
              >
                Events CSV
              </button>
            </div>
          </div>
        </div>
      )}

      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Keyboard shortcuts"
        aria-expanded={open}
        className="flex items-center gap-2 px-2.5 py-1.5 bg-white border border-border rounded-md shadow-sm hover:border-border-strong transition-colors"
      >
        <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-muted">
          <rect x="0.5" y="3" width="13" height="8" rx="1.5" />
          <path d="M3 6h0M5 6h0M7 6h0M9 6h0M11 6h0M3 8.5h8" strokeLinecap="round" />
        </svg>
        <span className="text-[11px] text-ink-muted">Shortcuts</span>
      </button>
    </div>
  )
}
