import { useRef } from 'react'
import type { ModelName, RiskDimension } from '../types'
import type { RiskRegime } from '../core/config'

interface Props {
  model: ModelName
  availableModels: ModelName[]
  onModelChange: (model: ModelName) => void
  audioFilename: string | null
  transcriptFilename: string | null
  onUploadAudio: (file: File) => void
  onUploadTranscript: (file: File) => void
  recording: boolean
  recordingElapsedMs: number
  recordingSupported: boolean
  onToggleRecord: () => void
  recordingDownloadUrl: string | null
  recordingDownloadName: string | null
  dimension: RiskDimension
  onDimensionChange: (d: RiskDimension) => void
  predicting: boolean
  // Study build gates: hide the free risk toggle and the upload/record
  // controls when the condition is locked by the experiment.
  showRiskSelect?: boolean
  // Runtime flagging-regime toggle (full build): preview deployment ⇄ study.
  allowRiskRegime?: boolean
  riskRegime?: RiskRegime
  onRiskRegimeChange?: (r: RiskRegime) => void
  allowUpload?: boolean
  allowRecord?: boolean
  // "Transcribe" runs the ASR service on the currently-loaded audio. Decoupled
  // from the Audio button (which now only loads audio for playback).
  allowTranscribe?: boolean
  canTranscribe?: boolean
  transcribing?: boolean
  onTranscribe?: () => void
  // "Outline" opens the centre sub-page (chaptered table of contents of the
  // whole recording). Full build only — the study uses short, frozen clips.
  allowOutline?: boolean
  onOpenOutline?: () => void
  // Track-changes view toggle (full build only; study keeps it always on).
  allowChangeToggle?: boolean
  showChanges?: boolean
  onToggleChanges?: () => void
  // Light/dark theme toggle (full build only; study locks the theme at setup).
  allowThemeToggle?: boolean
  theme?: 'light' | 'dark'
  onToggleTheme?: () => void
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

function OutlineIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 2.5h1M2 6h1M2 9.5h1M4.5 2.5h5.5M4.5 6h5.5M4.5 9.5h5.5" strokeLinecap="round" />
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
  audioFilename,
  transcriptFilename,
  onUploadAudio,
  onUploadTranscript,
  recording,
  recordingElapsedMs,
  recordingSupported,
  onToggleRecord,
  recordingDownloadUrl,
  recordingDownloadName,
  dimension,
  onDimensionChange,
  predicting,
  showRiskSelect = true,
  allowRiskRegime = false,
  riskRegime = 'deployment',
  onRiskRegimeChange,
  allowUpload = true,
  allowRecord = true,
  allowTranscribe = false,
  canTranscribe = false,
  transcribing = false,
  onTranscribe,
  allowOutline = false,
  onOpenOutline,
  allowChangeToggle = false,
  showChanges = true,
  onToggleChanges,
  allowThemeToggle,
  theme,
  onToggleTheme,
}: Props) {
  const audioInputRef = useRef<HTMLInputElement>(null)
  const transcriptInputRef = useRef<HTMLInputElement>(null)

  return (
    <header className="h-14 flex items-center px-5 gap-4 bg-surface border-b border-border shrink-0">
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

      {/* Upload + record controls (hidden when the study build locks them). */}
      {(allowUpload || allowRecord) && (
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

        {allowTranscribe && (
          <button
            onClick={onTranscribe}
            disabled={!canTranscribe || transcribing}
            className="flex items-center gap-1 text-[11px] px-2 py-1 rounded border transition-colors border-focus/40 text-focus bg-focus-bg hover:border-focus/60 disabled:opacity-40 disabled:cursor-not-allowed disabled:bg-surface disabled:text-ink-muted disabled:border-border"
            title={canTranscribe ? 'Run the ASR models on the loaded audio' : 'Load an audio file first'}
          >
            {transcribing ? (
              <>
                <svg className="animate-spin" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="5" cy="5" r="3.5" strokeOpacity="0.25" />
                  <path d="M5 1.5a3.5 3.5 0 0 1 3.5 3.5" strokeLinecap="round" />
                </svg>
                Transcribing…
              </>
            ) : (
              <>
                <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <path d="M2 4v2M4 2.5v5M6 1.5v7M8 3.5v3" strokeLinecap="round" />
                </svg>
                Transcribe
              </>
            )}
          </button>
        )}

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
      )}

      {/* Outline sub-page launcher (full build only). */}
      {allowOutline && (
        <button
          onClick={onOpenOutline}
          className="flex items-center gap-1 text-[11px] text-ink-muted hover:text-focus px-2 py-1 rounded border border-border hover:border-focus/50 transition-colors"
          title="Open a chaptered outline of the whole recording"
        >
          <OutlineIcon />
          Outline
        </button>
      )}

      {/* Spacer: pushes the config group to the right (playback moved to the
          bottom bar). */}
      <div className="flex-1" />

      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5">
          <span className="text-[10px] text-ink-faint uppercase tracking-widest">Model</span>
          <select
            value={model}
            onChange={(e) => onModelChange(e.target.value as ModelName)}
            className="text-xs border border-border rounded px-2 py-1 bg-surface text-ink hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong min-w-[11rem]"
          >
            {availableModels.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>

        {showRiskSelect && (
        <label
          className="flex items-center gap-1.5"
          title="Which risk signal drives the word highlights"
        >
          <span className="text-[10px] text-ink-faint uppercase tracking-widest">Risk</span>
          <select
            value={dimension}
            onChange={(e) => onDimensionChange(e.target.value as RiskDimension)}
            className="text-xs border border-border rounded px-2 py-1 bg-surface text-ink hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong"
          >
            <option value="combined">Combined (2×2)</option>
            <option value="uncertainty">Uncertainty</option>
            <option value="importance">Importance</option>
          </select>
        </label>
        )}

        {allowRiskRegime && (
          <button
            onClick={() =>
              onRiskRegimeChange?.(riskRegime === 'deployment' ? 'study' : 'deployment')
            }
            title="Flagging regime for the Combined view — Deployment: quiet (statutory always-red + require both signals + per-segment budget). Study: importance-dominant, denser. Click to switch."
            className={[
              'flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border transition-colors',
              riskRegime === 'study'
                ? 'border-accent/60 text-ink bg-accent/10'
                : 'border-border text-ink-muted bg-surface hover:border-border-strong',
            ].join(' ')}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M2 3.5h8M2 8.5h8" strokeLinecap="round" />
              <circle cx={riskRegime === 'study' ? 8 : 4} cy="3.5" r="1.5" fill="currentColor" stroke="none" />
              <circle cx={riskRegime === 'study' ? 4 : 8} cy="8.5" r="1.5" fill="currentColor" stroke="none" />
            </svg>
            {riskRegime === 'study' ? 'Flagging: Study' : 'Flagging: Deployment'}
          </button>
        )}

        {allowChangeToggle && (
          <button
            onClick={onToggleChanges}
            title={showChanges ? 'Hide reviewer changes (clean read)' : 'Show reviewer changes'}
            className={[
              'flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border transition-colors',
              showChanges
                ? 'border-change-ins/50 text-change-ins bg-change-ins-bg'
                : 'border-border text-ink-muted bg-surface hover:border-border-strong',
            ].join(' ')}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
              <path d="M8.5 1.5 10.5 3.5 4 10 1.5 10.5 2 8z" strokeLinejoin="round" />
            </svg>
            {showChanges ? 'Changes: on' : 'Changes: off'}
          </button>
        )}

        {allowThemeToggle && (
          <button
            onClick={onToggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            aria-label="Toggle dark mode"
            className="flex items-center gap-1.5 text-[11px] px-2 py-1 rounded border border-border text-ink-muted bg-surface hover:border-border-strong transition-colors"
          >
            {theme === 'dark' ? (
              // Sun — click to go light
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
                <circle cx="6" cy="6" r="2.3" />
                <path d="M6 .8v1.4M6 9.8v1.4M.8 6h1.4M9.8 6h1.4M2.3 2.3l1 1M8.7 8.7l1 1M9.7 2.3l-1 1M3.3 8.7l-1 1" strokeLinecap="round" />
              </svg>
            ) : (
              // Moon — click to go dark
              <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor">
                <path d="M9.5 7.2A4 4 0 0 1 4.8 2.5a.5.5 0 0 0-.7-.6A4.5 4.5 0 1 0 10.1 8a.5.5 0 0 0-.6-.8z" />
              </svg>
            )}
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
        )}

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
