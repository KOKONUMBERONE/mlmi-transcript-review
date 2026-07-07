import { useState } from 'react'
import ReviewWorkspace from './core/ReviewWorkspace'
import {
  FULL_CONFIG,
  SENTENCE_CONFIG,
  SENTENCE_UNCERTAINTY_CONFIG,
  type WorkspaceConfig,
} from './core/config'
import { useEventLog } from './state/useEventLog'

// The version launcher (default build): ONE deployment, a landing menu, and
// every interface variant one click away — so feedback sessions (Police
// Scotland) never touch a command line and can hop between versions freely.
// Adding a future variant = one entry here (+ its WorkspaceConfig).
interface Version {
  id: string
  title: string
  blurb: string
  config: WorkspaceConfig
}

const VERSIONS: Version[] = [
  {
    id: 'word',
    title: 'Word highlighting',
    blurb:
      'Word-level risk marks: words that are likely wrong and matter are flagged in the text.',
    config: FULL_CONFIG,
  },
  {
    id: 'sentence',
    title: 'Word + sentence importance',
    blurb:
      'Everything in the word version, plus an AI layer that highlights the whole sentences worth re-listening to first.',
    config: SENTENCE_CONFIG,
  },
  {
    id: 'sentence-uncertainty',
    title: 'Sentence confidence',
    blurb:
      'Whole sentences are highlighted by how confident the speech-recognition was — the ones most likely to be mis-transcribed stand out for a listen.',
    config: SENTENCE_UNCERTAINTY_CONFIG,
  },
]

export default function AppVersions() {
  const events = useEventLog()
  const [active, setActive] = useState<Version | null>(null)

  // ---------------- Landing menu ----------------
  if (!active) {
    return (
      <div className="h-full bg-surface-muted flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <h1 className="text-sm font-semibold text-ink uppercase tracking-[0.15em] mb-1">
            Transcript review
          </h1>
          <p className="text-[12px] text-ink-muted mb-5 leading-relaxed">
            Choose an interface version. Both review the same demo interview —
            you can switch versions at any time.
          </p>
          <div className="space-y-3">
            {VERSIONS.map((v) => (
              <button
                key={v.id}
                onClick={() => setActive(v)}
                className="w-full text-left bg-surface border border-border rounded-lg shadow-sm px-5 py-4 hover:border-brand/50 hover:shadow transition-all group"
              >
                <p className="text-[13px] font-semibold text-ink group-hover:text-brand transition-colors">
                  {v.title}
                </p>
                <p className="mt-1 text-[12px] text-ink-muted leading-snug">{v.blurb}</p>
              </button>
            ))}
          </div>
        </div>
      </div>
    )
  }

  // ---------------- Selected version ----------------
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-2 px-4 py-1.5 shrink-0 text-[11px] bg-surface-muted border-b border-border">
        <span className="text-ink-faint uppercase tracking-widest">Version</span>
        <span className="text-ink font-medium">{active.title}</span>
        <button
          onClick={() => setActive(null)}
          className="ml-auto px-2 py-0.5 rounded border border-border text-ink-muted bg-surface hover:border-border-strong hover:text-ink transition-colors"
        >
          ‹ Switch version
        </button>
      </div>
      <div className="flex-1 min-h-0">
        {/* key remounts the workspace per version — each entry starts fresh.
            participantOverride tags every logged row with the active version
            (same mechanism the study uses for participant ids). */}
        <ReviewWorkspace
          key={active.id}
          config={active.config}
          events={events}
          participantOverride={`ver:${active.id}`}
        />
      </div>
    </div>
  )
}
