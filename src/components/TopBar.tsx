import { useRef } from 'react'
import type { ModelName } from '../types'
import type { AudioController } from '../state/useAudio'

interface Props {
  model: ModelName
  availableModels: ModelName[]
  onModelChange: (model: ModelName) => void
  audio: AudioController
  audioFilename: string | null
  transcriptFilename: string | null
  reviewer: string
  onReviewerChange: (name: string) => void
  onUploadAudio: (file: File) => void
  onUploadTranscript: (file: File) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

function UploadIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 7V1.5M5 1.5 2.5 4M5 1.5 7.5 4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 8.5h7" strokeLinecap="round" />
    </svg>
  )
}

export default function TopBar({
  model,
  availableModels,
  onModelChange,
  audio,
  audioFilename,
  transcriptFilename,
  reviewer,
  onReviewerChange,
  onUploadAudio,
  onUploadTranscript,
}: Props) {
  const reviewerMissing = reviewer.trim() === ''

  const audioInputRef = useRef<HTMLInputElement>(null)
  const transcriptInputRef = useRef<HTMLInputElement>(null)

  return (
    <header className="h-14 flex items-center px-5 gap-4 bg-white border-b border-border shrink-0">
      {/* Filename block */}
      <div className="flex flex-col leading-tight mr-1 min-w-0 max-w-[14rem]">
        <span className="font-mono text-[11px] text-ink tracking-wide truncate" title={audioFilename ?? undefined}>
          {audioFilename ?? 'interview_2024-03-14_case447.wav'}
        </span>
        <span className="text-[10px] text-ink-faint italic truncate">
          {audioFilename
            ? `uploaded audio${transcriptFilename ? ` · ${transcriptFilename}` : ''}`
            : transcriptFilename
            ? `placeholder audio · ${transcriptFilename}`
            : 'placeholder audio · silent'}
        </span>
      </div>

      {/* Upload controls */}
      <div className="flex items-center gap-1">
        <input
          ref={audioInputRef}
          type="file"
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onUploadAudio(f)
            e.target.value = ''
          }}
        />
        <input
          ref={transcriptInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onUploadTranscript(f)
            e.target.value = ''
          }}
        />

        <button
          onClick={() => audioInputRef.current?.click()}
          className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink px-2 py-1 rounded border border-border hover:border-border-strong transition-colors"
          title="Replace the placeholder audio with a real .wav / .mp3 file"
        >
          <UploadIcon />
          Audio
        </button>
        <button
          onClick={() => transcriptInputRef.current?.click()}
          className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink px-2 py-1 rounded border border-border hover:border-border-strong transition-colors"
          title="Replace the mock transcript with a .json file matching the Transcript type"
        >
          <UploadIcon />
          Transcript
        </button>
      </div>

      {/* Reviewer identity */}
      <label className="flex items-center gap-1.5" title="Recorded on every audit-trail entry">
        <span className="text-[10px] text-ink-faint uppercase tracking-widest">
          Reviewer
        </span>
        <input
          type="text"
          value={reviewer}
          onChange={(e) => onReviewerChange(e.target.value)}
          placeholder="Set your name…"
          className={[
            'text-xs border rounded px-2 py-1 bg-white text-ink min-w-[10rem] focus:outline-none focus:ring-1 focus:ring-border-strong transition-colors',
            reviewerMissing
              ? 'border-risk-med/50 focus:ring-risk-med/40 placeholder:text-risk-med/70 placeholder:italic'
              : 'border-border hover:border-border-strong',
          ].join(' ')}
        />
      </label>

      <div className="h-7 w-px bg-border" />

      <button
        onClick={audio.togglePlay}
        disabled={!audio.ready}
        aria-label={audio.isPlaying ? 'Pause' : 'Play'}
        className="w-8 h-8 flex items-center justify-center rounded border border-border text-ink hover:bg-surface-muted disabled:opacity-40 transition-colors"
      >
        {audio.isPlaying ? (
          <svg width="10" height="12" viewBox="0 0 10 12" fill="currentColor">
            <rect x="0" y="0" width="3" height="12" />
            <rect x="7" y="0" width="3" height="12" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
            <polygon points="2,1 11,6 2,11" />
          </svg>
        )}
      </button>

      <span className="font-mono text-xs text-ink-faint w-10 text-right tabular-nums">
        {formatTime(audio.currentTime)}
      </span>
      <div
        ref={audio.containerRef}
        className="flex-1 max-w-2xl min-w-[8rem]"
        title="Click to seek"
      />
      <span className="font-mono text-xs text-ink-faint w-10 tabular-nums">
        {formatTime(audio.duration)}
      </span>

      <div className="h-7 w-px bg-border" />

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] text-ink-faint uppercase tracking-widest">Speed</span>
          <select
            defaultValue="1"
            onChange={(e) => audio.setRate(parseFloat(e.target.value))}
            className="text-xs border border-border rounded px-2 py-1 bg-white text-ink hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong"
          >
            <option value="0.5">0.5×</option>
            <option value="0.75">0.75×</option>
            <option value="1">1×</option>
            <option value="1.5">1.5×</option>
            <option value="2">2×</option>
          </select>
        </label>

        <label className="flex items-center gap-1.5">
          <span className="text-[10px] text-ink-faint uppercase tracking-widest">Model</span>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value as ModelName)}
            className="text-xs border border-border rounded px-2 py-1 bg-white text-ink hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong min-w-[11rem]"
          >
            {availableModels.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>
    </header>
  )
}
