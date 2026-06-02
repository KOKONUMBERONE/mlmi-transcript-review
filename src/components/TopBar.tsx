import { useRef } from 'react'
import type { ModelName, RiskDimension } from '../types'
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
  onSpeedChange?: (speed: number) => void
  recording: boolean
  recordingElapsedMs: number
  recordingSupported: boolean
  onToggleRecord: () => void
  recordingDownloadUrl: string | null
  recordingDownloadName: string | null
  dimension: RiskDimension
  onDimensionChange: (d: RiskDimension) => void
  predicting: boolean
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

function MicIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3.5" y="1" width="3" height="5" rx="1.5" />
      <path d="M2 5.5a3 3 0 0 0 6 0" strokeLinecap="round" />
      <path d="M5 8.5V9.5" strokeLinecap="round" />
    </svg>
  )
}

function StopIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 9 9" fill="currentColor">
      <rect x="1" y="1" width="7" height="7" rx="0.5" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M5 1.5V7M5 7 2.5 4.5M5 7 7.5 4.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M1.5 8.5h7" strokeLinecap="round" />
    </svg>
  )
}

function formatElapsed(ms: number): string {
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
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
  onSpeedChange,
  recording,
  recordingElapsedMs,
  recordingSupported,
  onToggleRecord,
  recordingDownloadUrl,
  recordingDownloadName,
  dimension,
  onDimensionChange,
  predicting,
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
          accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac,.aac,.webm,.mp4"
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

        <button
          onClick={onToggleRecord}
          disabled={!recordingSupported}
          className={[
            'flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors',
            recording
              ? 'border-risk-high/40 text-risk-high bg-risk-high-bg hover:border-risk-high/60'
              : 'border-border text-ink-muted hover:text-ink hover:border-border-strong disabled:opacity-40 disabled:hover:text-ink-muted disabled:hover:border-border',
          ].join(' ')}
          title={
            recordingSupported
              ? recording
                ? 'Stop recording and load it as the current audio'
                : 'Record audio from your microphone'
              : 'Recording is not supported in this browser'
          }
        >
          {recording ? (
            <>
              <span
                className="w-1.5 h-1.5 rounded-full bg-risk-high animate-pulse"
                aria-hidden
              />
              <StopIcon />
              <span className="font-mono tabular-nums">
                {formatElapsed(recordingElapsedMs)}
              </span>
            </>
          ) : (
            <>
              <MicIcon />
              Record
            </>
          )}
        </button>

        {recordingDownloadUrl && recordingDownloadName && !recording && (
          <a
            href={recordingDownloadUrl}
            download={recordingDownloadName}
            className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-ink px-2 py-1 rounded border border-border hover:border-border-strong transition-colors"
            title="Save the recorded audio to disk (for external transcription)"
          >
            <DownloadIcon />
            Save
          </a>
        )}
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
            onChange={(e) => {
              const v = parseFloat(e.target.value)
              if (onSpeedChange) onSpeedChange(v)
              else audio.setRate(v)
            }}
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

        <label
          className="flex items-center gap-1.5"
          title="Which risk signal drives the word highlights"
        >
          <span className="text-[10px] text-ink-faint uppercase tracking-widest">Risk</span>
          <select
            value={dimension}
            onChange={(e) => onDimensionChange(e.target.value as RiskDimension)}
            className="text-xs border border-border rounded px-2 py-1 bg-white text-ink hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong"
          >
            <option value="combined">Combined (2×2)</option>
            <option value="uncertainty">Uncertainty</option>
            <option value="importance">Importance</option>
          </select>
        </label>

        {predicting && (
          <span
            className="flex items-center gap-1.5 text-[10px] text-ink-muted uppercase tracking-widest"
            aria-live="polite"
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              className="animate-spin"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <circle cx="5" cy="5" r="3.5" strokeOpacity="0.25" />
              <path d="M5 1.5a3.5 3.5 0 0 1 3.5 3.5" strokeLinecap="round" />
            </svg>
            scoring…
          </span>
        )}
      </div>
    </header>
  )
}
