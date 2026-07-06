import type { AudioController } from '../state/useAudio'

interface Props {
  audio: AudioController
  reviewer: string
  onReviewerChange: (name: string) => void
  onSpeedChange?: (speed: number) => void
  // Play/pause with the auto-rewind-on-resume convention; falls back to the raw
  // audio toggle when not provided.
  onTogglePlay?: () => void
  // Relative seek for the ±10s buttons (logged as a 'keyboard' seek, like the
  // arrow-key shortcuts); falls back to a raw clamped audio.seek when absent.
  onSkip?: (deltaSeconds: number) => void
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}

// Page-bottom playback bar (à la Otter): reviewer identity on the left, the
// transport + scrubbable waveform stretched across the middle, speed on the
// right. Pinned to the bottom of the workspace column.
export default function PlayerBar({
  audio,
  reviewer,
  onReviewerChange,
  onSpeedChange,
  onTogglePlay,
  onSkip,
}: Props) {
  const reviewerMissing = reviewer.trim() === ''

  const skip = (delta: number) => {
    if (onSkip) onSkip(delta)
    else audio.seek(Math.max(0, Math.min(audio.duration, audio.currentTime + delta)))
  }

  return (
    <div className="h-14 grid grid-cols-[1fr_auto_1fr] items-center px-5 bg-surface border-t border-border shrink-0">
      {/* Reviewer identity (left cell) */}
      <label className="flex items-center gap-1.5 justify-self-start" title="Recorded on every audit-trail entry">
        <span className="text-[11px] text-ink-muted">
          Reviewer
        </span>
        <input
          type="text"
          value={reviewer}
          onChange={(e) => onReviewerChange(e.target.value)}
          placeholder="Set your name…"
          className={[
            'text-xs border rounded px-2 py-1 bg-surface text-ink min-w-[9rem] focus:outline-none focus:ring-1 focus:ring-border-strong transition-colors',
            reviewerMissing
              ? 'border-risk-med/50 focus:ring-risk-med/40 placeholder:text-risk-med/70 placeholder:italic'
              : 'border-border hover:border-border-strong',
          ].join(' ')}
        />
      </label>

      {/* Transport cluster — perfectly centred by the 1fr/auto/1fr grid */}
      <div className="flex items-center gap-2 justify-self-center">
      <button
        onClick={() => skip(-10)}
        disabled={!audio.ready}
        aria-label="Back 10 seconds"
        title="Back 10 seconds"
        className="w-8 h-8 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface-muted disabled:opacity-40 transition-colors shrink-0"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
          <path d="M3 3v5h5" />
          <text x="12" y="15.5" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">10</text>
        </svg>
      </button>
      <button
        onClick={onTogglePlay ?? audio.togglePlay}
        disabled={!audio.ready}
        aria-label={audio.isPlaying ? 'Pause' : 'Play'}
        className="w-8 h-8 flex items-center justify-center rounded border border-border text-ink hover:bg-surface-muted disabled:opacity-40 transition-colors shrink-0"
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
      <button
        onClick={() => skip(10)}
        disabled={!audio.ready}
        aria-label="Forward 10 seconds"
        title="Forward 10 seconds"
        className="w-8 h-8 flex items-center justify-center rounded text-ink-muted hover:text-ink hover:bg-surface-muted disabled:opacity-40 transition-colors shrink-0"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
          <path d="M21 3v5h-5" />
          <text x="12" y="15.5" fontSize="8.5" fontWeight="700" fill="currentColor" stroke="none" textAnchor="middle">10</text>
        </svg>
      </button>

      <span className="font-mono text-xs text-ink-muted w-10 text-right tabular-nums shrink-0">
        {formatTime(audio.currentTime)}
      </span>
      {/* Shorter, centred waveform + a YouTube-style draggable scrubber knob.
          The knob is a pure-visual app-DOM overlay (wavesurfer renders in a
          shadow DOM); pointer-events-none so wavesurfer's own drag-to-seek
          underneath still gets every click/drag. */}
      <div className="relative w-[34rem] max-w-[45vw] min-w-[12rem]">
        <div
          ref={audio.containerRef}
          className="w-full"
          title="Click to seek · drag to scrub"
        />
        {audio.duration > 0 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-brand ring-2 ring-surface shadow"
            style={{ left: `${(audio.currentTime / audio.duration) * 100}%` }}
          />
        )}
      </div>
      <span className="font-mono text-xs text-ink-muted w-10 tabular-nums shrink-0">
        {formatTime(audio.duration)}
      </span>
      </div>

      {/* Speed (right cell) */}
      <label className="flex items-center gap-1.5 justify-self-end">
        <span className="text-[11px] text-ink-muted">Speed</span>
        <select
          defaultValue="1"
          onChange={(e) => {
            const v = parseFloat(e.target.value)
            if (onSpeedChange) onSpeedChange(v)
            else audio.setRate(v)
          }}
          className="text-xs border border-border rounded px-2 py-1 bg-surface text-ink hover:border-border-strong focus:outline-none focus:ring-1 focus:ring-border-strong"
        >
          <option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option>
          <option value="1">1×</option>
          <option value="1.5">1.5×</option>
          <option value="2">2×</option>
        </select>
      </label>
    </div>
  )
}
