import type { LogEvent } from '../types'

function downloadBlob(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return ''
  const s = String(value)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

// Stable column order for analysis tooling. Any extra fields are appended
// in insertion order at the end.
const KNOWN_COLUMNS = [
  't_ms',
  't_iso',
  'type',
  'reviewer',
  'model',
  'segment_id',
  'segment_start',
  'segment_risk',
  'word_index',
  'word_text',
  'word_risk',
  'audio_position',
  'from_position',
  'to_position',
  'trigger',
  'old_speed',
  'new_speed',
  'from_model',
  'to_model',
  'from_text',
  'to_text',
  'via',
  'reason',
  'filter',
  'sort',
  'export_kind',
  'audio_duration',
  'transcript_filename',
  'audio_filename',
  'segment_count',
] as const

function summary(events: LogEvent[]): Record<string, unknown> {
  const counts: Record<string, number> = {}
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1
  const totalMs = events.length === 0 ? 0 : events[events.length - 1].t_ms
  return {
    event_count: events.length,
    total_duration_ms: totalMs,
    counts_by_type: counts,
  }
}

function safeStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function exportEventLogAsJSON(events: LogEvent[]): void {
  const payload = {
    exported_at: new Date().toISOString(),
    schema_version: 1,
    summary: summary(events),
    events,
  }
  downloadBlob(
    `event-log-${safeStamp()}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  )
}

export function exportEventLogAsCSV(events: LogEvent[]): void {
  // Collect all keys present across all rows so the CSV is rectangular even
  // when an event omits some fields.
  const seen = new Set<string>(KNOWN_COLUMNS)
  for (const e of events) {
    for (const k of Object.keys(e)) seen.add(k)
  }
  const columns = [
    ...KNOWN_COLUMNS,
    ...Array.from(seen).filter((k) => !KNOWN_COLUMNS.includes(k as (typeof KNOWN_COLUMNS)[number])),
  ]

  const lines = [columns.join(',')]
  for (const e of events) {
    const row = columns.map((c) => csvEscape((e as unknown as Record<string, unknown>)[c]))
    lines.push(row.join(','))
  }
  downloadBlob(
    `event-log-${safeStamp()}.csv`,
    lines.join('\n'),
    'text/csv;charset=utf-8',
  )
}
