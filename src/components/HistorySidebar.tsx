import type { EditState, HistoryEntry, ModelName, Transcript } from '../types'
import { exportHistoryAsCSV, exportHistoryAsJSON } from '../utils/exportHistory'
import {
  exportTranscriptJson,
  exportTranscriptReportHtml,
  exportTranscriptText,
} from '../utils/exportTranscript'

interface Props {
  history: HistoryEntry[]
  verified: Record<number, boolean>
  verifiedCount: number
  totalSegments: number
  // Data needed to produce the reviewed-transcript exports:
  transcript: Transcript
  model: ModelName
  edits: Record<string, EditState>
  reviewer: string
  audioFilename: string | null
  transcriptFilename: string | null
  onExport?: (kind: string, count: number) => void
}

function formatAction(entry: HistoryEntry): React.ReactNode {
  if (entry.kind === 'edit') {
    return (
      <span>
        <span className="line-through text-ink-faint">{entry.from || '∅'}</span>
        <span className="mx-1.5 text-ink-faint">→</span>
        <span className="font-medium text-ink">{entry.to}</span>
      </span>
    )
  }
  if (entry.kind === 'delete') {
    return (
      <span>
        <span className="line-through text-ink-faint">{entry.from || '∅'}</span>
        <span className="mx-1.5 text-ink-faint">→</span>
        <span className="font-medium text-risk-high">(deleted)</span>
      </span>
    )
  }
  if (entry.kind === 'verify') {
    return <span className="text-verified font-medium">Verified segment</span>
  }
  return <span className="text-ink-muted font-medium">Un-verified segment</span>
}

const KIND_DOT: Record<HistoryEntry['kind'], string> = {
  edit: 'bg-blue-400',
  delete: 'bg-risk-high',
  verify: 'bg-verified-bar',
  unverify: 'bg-border-strong',
}

interface ExportButtonProps {
  label: string
  onClick: () => void
  disabled?: boolean
}

function ExportButton({ label, onClick, disabled }: ExportButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="text-[11px] font-mono px-2 py-0.5 border border-border rounded hover:border-border-strong text-ink-muted hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
    >
      {label}
    </button>
  )
}

export default function HistorySidebar({
  history,
  verified,
  verifiedCount,
  totalSegments,
  transcript,
  model,
  edits,
  reviewer,
  audioFilename,
  transcriptFilename,
  onExport,
}: Props) {
  const progress = totalSegments === 0 ? 0 : (verifiedCount / totalSegments) * 100
  const hasHistory = history.length > 0

  const exportArgs = {
    transcript,
    model,
    edits,
    verified,
    reviewer,
    audioFilename,
    transcriptFilename,
  }

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-white overflow-y-auto flex flex-col">
      <div className="px-4 py-3 border-b border-border sticky top-0 bg-white z-10">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] text-ink-faint uppercase tracking-[0.2em]">
            Audit trail
          </p>
          <p className="text-[10px] font-mono text-ink-faint tabular-nums">
            {history.length} {history.length === 1 ? 'entry' : 'entries'}
          </p>
        </div>

        <div className="flex items-baseline justify-between mb-1">
          <p className="text-xs text-ink">
            Verified{' '}
            <span className="font-mono tabular-nums font-medium">
              {verifiedCount} / {totalSegments}
            </span>{' '}
            segments
          </p>
        </div>
        <div className="h-1 bg-surface-subtle rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-verified-bar transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Export groups. The HTML report bundles both deliverables (final
            transcript + full change log) into one reader-friendly file; the
            CSV/JSON/TXT options below stay for analysis and archival. */}
        <div className="space-y-1.5">
          <button
            onClick={() => {
              exportTranscriptReportHtml({ ...exportArgs, history })
              onExport?.('report_html', totalSegments)
            }}
            title="A single, reader-friendly file with the full reviewed transcript and a complete log of what changed, when, and why."
            className="w-full text-xs font-medium px-3 py-1.5 rounded bg-ink text-white hover:opacity-90 transition-opacity flex items-center justify-center gap-1.5"
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M7 1v8m0 0L4 6m3 3l3-3" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M2 11v1a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1v-1" strokeLinecap="round" />
            </svg>
            Download report (HTML)
          </button>
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] text-ink-faint uppercase tracking-widest w-20 shrink-0"
              title="Chronological log of every edit, deletion, and verification."
            >
              Audit log
            </span>
            <ExportButton
              label="CSV"
              disabled={!hasHistory}
              onClick={() => {
                exportHistoryAsCSV(history)
                onExport?.('audit_csv', history.length)
              }}
            />
            <ExportButton
              label="JSON"
              disabled={!hasHistory}
              onClick={() => {
                exportHistoryAsJSON(history)
                onExport?.('audit_json', history.length)
              }}
            />
          </div>
          <div className="flex items-center gap-1.5">
            <span
              className="text-[10px] text-ink-faint uppercase tracking-widest w-20 shrink-0"
              title="The reviewed transcript itself, with all edits and deletions applied."
            >
              Transcript
            </span>
            <ExportButton
              label="TXT"
              onClick={() => {
                exportTranscriptText(exportArgs)
                onExport?.('transcript_txt', totalSegments)
              }}
            />
            <ExportButton
              label="JSON"
              onClick={() => {
                exportTranscriptJson(exportArgs)
                onExport?.('transcript_json', totalSegments)
              }}
            />
          </div>
        </div>
      </div>

      {!hasHistory ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center">
          <div className="w-10 h-10 rounded-full bg-surface-muted border border-border flex items-center justify-center mb-3">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-faint">
              <circle cx="7" cy="7" r="5.5" />
              <path d="M7 4v3l2 1.5" strokeLinecap="round" />
            </svg>
          </div>
          <p className="text-xs text-ink-muted mb-1">No changes yet</p>
          <p className="text-[11px] text-ink-faint leading-snug">
            Edits, deletions, and verifications will appear here in reverse chronological order.
          </p>
        </div>
      ) : (
        <ol className="flex-1">
          {history.map((entry) => (
            <li
              key={entry.id}
              className="px-4 py-2.5 text-xs border-b border-border last:border-b-0 hover:bg-surface-muted transition-colors"
            >
              <div className="flex items-baseline justify-between mb-1 gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${KIND_DOT[entry.kind]}`} />
                  <span className="text-[11px] text-ink truncate font-medium" title={entry.reviewer}>
                    {entry.reviewer}
                  </span>
                </div>
                <span className="font-mono text-[10px] text-ink-faint tabular-nums shrink-0">
                  {entry.timestamp}
                </span>
              </div>

              <div className="flex items-baseline gap-2 pl-3.5">
                <span className="font-mono text-[10px] text-ink-faint shrink-0">
                  seg {entry.segmentId}
                  {entry.wordIndex !== undefined ? ` · #${entry.wordIndex + 1}` : ''}
                </span>
                <div className="text-ink leading-snug">{formatAction(entry)}</div>
              </div>

              {entry.reason && (
                <p className="pl-3.5 mt-1 text-[10px] text-ink-faint italic">
                  ↳ {entry.reason}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}
    </aside>
  )
}
