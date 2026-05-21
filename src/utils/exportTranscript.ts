import type { EditState, ModelName, Transcript } from '../types'

interface ExportArgs {
  transcript: Transcript
  model: ModelName
  edits: Record<string, EditState>
  verified: Record<number, boolean>
  reviewer: string
  audioFilename: string | null
  transcriptFilename: string | null
}

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

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function fileStem(args: ExportArgs): string {
  const source = args.audioFilename ?? args.transcriptFilename ?? 'transcript'
  return source.replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9_-]+/g, '_')
}

function isoStamp(): string {
  return new Date().toISOString()
}

function safeFsStamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

function verifiedCount(verified: Record<number, boolean>): number {
  return Object.values(verified).filter(Boolean).length
}

// --------------------------------------------------------------------------

export function exportTranscriptText(args: ExportArgs): void {
  const { transcript, model, edits, verified, reviewer } = args
  const totalSegments = transcript.segments.length
  const verifiedN = verifiedCount(verified)

  const lines: string[] = []
  lines.push('REVIEWED TRANSCRIPT')
  lines.push('===================')
  lines.push(`Case:      ${args.audioFilename ?? 'interview_2024-03-14_case447.wav'}`)
  if (args.transcriptFilename) {
    lines.push(`Source:    ${args.transcriptFilename}`)
  }
  lines.push(`Reviewer:  ${reviewer.trim() || 'Unknown reviewer'}`)
  lines.push(`Model:     ${model}`)
  lines.push(`Verified:  ${verifiedN} / ${totalSegments} segments`)
  lines.push(`Exported:  ${isoStamp()}`)
  lines.push('')
  lines.push('-'.repeat(72))
  lines.push('')

  for (const seg of transcript.segments) {
    const words = seg.words[model] ?? []
    const renderedWords: string[] = []
    for (let i = 0; i < words.length; i++) {
      const edit = edits[`${seg.id}-${i}`]
      if (edit?.deleted) {
        renderedWords.push('[removed]')
      } else if (edit) {
        renderedWords.push(edit.text)
      } else {
        renderedWords.push(words[i].text)
      }
    }
    const verifiedTag = verified[seg.id] ? '  (✓ verified)' : ''
    lines.push(`[${formatTime(seg.start)}] ${seg.speaker.toUpperCase()}:${verifiedTag}`)
    lines.push(`  ${renderedWords.join(' ')}`)
    lines.push('')
  }

  lines.push('-'.repeat(72))
  lines.push('End of transcript.')
  lines.push('')

  downloadBlob(
    `transcript-${fileStem(args)}-${safeFsStamp()}.txt`,
    lines.join('\n'),
    'text/plain;charset=utf-8',
  )
}

// --------------------------------------------------------------------------

interface ExportedWord {
  text: string
  risk: 'high' | 'med' | 'low'
  alternatives?: string[]
  edited?: boolean
  deleted?: boolean
  original_text?: string
  reason?: string
}

interface ExportedSegment {
  id: number
  speaker: 'Officer' | 'Witness'
  start: number
  end: number
  paraRisk: 'high' | 'med' | 'low'
  verified: boolean
  words: { [modelName: string]: ExportedWord[] }
}

export function exportTranscriptJson(args: ExportArgs): void {
  const { transcript, model, edits, verified, reviewer } = args
  const totalSegments = transcript.segments.length
  const verifiedN = verifiedCount(verified)

  const segments: ExportedSegment[] = transcript.segments.map((seg) => {
    const sourceWords = seg.words[model] ?? []
    const reviewedWords: ExportedWord[] = sourceWords.map((w, i) => {
      const edit = edits[`${seg.id}-${i}`]
      if (!edit) {
        const out: ExportedWord = { text: w.text, risk: w.risk }
        if (w.alternatives) out.alternatives = w.alternatives
        return out
      }
      const out: ExportedWord = {
        text: edit.text,
        risk: w.risk,
        edited: true,
        original_text: w.text,
      }
      if (w.alternatives) out.alternatives = w.alternatives
      if (edit.deleted) out.deleted = true
      if (edit.reason) out.reason = edit.reason
      return out
    })

    return {
      id: seg.id,
      speaker: seg.speaker,
      start: seg.start,
      end: seg.end,
      paraRisk: seg.paraRisk,
      verified: !!verified[seg.id],
      words: { [model]: reviewedWords },
    }
  })

  const payload = {
    metadata: {
      reviewer: reviewer.trim() || 'Unknown reviewer',
      exported_at: isoStamp(),
      base_model: model,
      verified_count: verifiedN,
      total_segments: totalSegments,
      source_audio: args.audioFilename ?? null,
      source_transcript: args.transcriptFilename ?? null,
    },
    audioDuration: transcript.audioDuration,
    segments,
  }

  downloadBlob(
    `transcript-${fileStem(args)}-${safeFsStamp()}.json`,
    JSON.stringify(payload, null, 2),
    'application/json',
  )
}
