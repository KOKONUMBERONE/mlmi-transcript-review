// Tab strip + collapsed rail for the left column when the assistant chat is
// enabled (full build): the w-80 column holds Find OR Assistant (plus the
// per-version Timeline / Conflicts panels), switched by these tabs. The study
// build never renders either of these — FocusPanel's own title + collapsed
// branch keep running there untouched.
//
// RightTabStrip switches the RIGHT column between the police case-questions
// panel and the Review/audit panel.

export type LeftTab = 'find' | 'chat' | 'timeline' | 'conflicts'
export type RightTab = 'questions' | 'review'

export function LeftTabStrip({
  active,
  onSelect,
  onOpenOutline,
  showTimeline = false,
  showConflicts = false,
}: {
  active: LeftTab
  onSelect: (tab: LeftTab) => void
  /** When set, an "Outline" launcher appears after Assistant. It is a button,
   *  not a selectable panel — clicking it opens the full-screen storyboard. */
  onOpenOutline?: () => void
  /** Timeline build only: show the "Timeline" tab (event list panel). */
  showTimeline?: boolean
  /** Anomaly build only: show the "Conflicts" tab (contradiction pairs). */
  showConflicts?: boolean
}) {
  const cls = (tab: LeftTab) =>
    [
      'text-[10px] uppercase tracking-[0.1em] font-semibold pb-0.5 border-b-2 transition-colors',
      active === tab
        ? 'text-brand border-brand'
        : 'text-ink-faint border-transparent hover:text-ink',
    ].join(' ')
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0" role="tablist" aria-label="Left panel">
      <button role="tab" aria-selected={active === 'find'} className={cls('find')} onClick={() => onSelect('find')}>
        Find
      </button>
      <button role="tab" aria-selected={active === 'chat'} className={cls('chat')} onClick={() => onSelect('chat')}>
        Assistant
      </button>
      {showTimeline && (
        <button role="tab" aria-selected={active === 'timeline'} className={cls('timeline')} onClick={() => onSelect('timeline')}>
          Timeline
        </button>
      )}
      {showConflicts && (
        <button role="tab" aria-selected={active === 'conflicts'} className={cls('conflicts')} onClick={() => onSelect('conflicts')}>
          Conflicts
        </button>
      )}
      {onOpenOutline && (
        <button
          onClick={onOpenOutline}
          title="Open the recording storyboard"
          className="text-[10px] uppercase tracking-[0.1em] font-semibold pb-0.5 border-b-2 border-transparent text-ink-faint hover:text-ink transition-colors"
        >
          Outline
        </button>
      )}
    </div>
  )
}

/** Right-column tab strip: the police case questions (framed brand chip so the
 *  task stays spottable) + the Review/audit panel. Rendered by whichever of the
 *  two panels is active, same slot pattern as the left strips. */
export function RightTabStrip({
  active,
  onSelect,
}: {
  active: RightTab
  onSelect: (tab: RightTab) => void
}) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 min-w-0" role="tablist" aria-label="Right panel">
      <button
        role="tab"
        aria-selected={active === 'questions'}
        className={[
          'text-[10px] uppercase tracking-[0.1em] font-semibold px-1.5 py-0.5 rounded border transition-colors',
          active === 'questions'
            ? 'text-white bg-brand border-brand'
            : 'text-brand bg-brand-bg border-brand/40 hover:border-brand',
        ].join(' ')}
        onClick={() => onSelect('questions')}
      >
        Questions
      </button>
      <button
        role="tab"
        aria-selected={active === 'review'}
        className={[
          'text-[10px] uppercase tracking-[0.1em] font-semibold pb-0.5 border-b-2 transition-colors',
          active === 'review'
            ? 'text-brand border-brand'
            : 'text-ink-faint border-transparent hover:text-ink',
        ].join(' ')}
        onClick={() => onSelect('review')}
      >
        Review
      </button>
    </div>
  )
}

/** Collapsed w-9 rail with both tab labels — clicking a label expands the
 *  column with that tab active. */
export function CollapsedLeftRail({
  findHits,
  onExpand,
  onOpenOutline,
  showTimeline = false,
  showConflicts = false,
  conflictCount,
}: {
  /** Find hit count shown under its label when a retrieval is active. */
  findHits?: number | null
  onExpand: (tab: LeftTab) => void
  /** Same Outline launcher as the expanded strip (full build). */
  onOpenOutline?: () => void
  /** Same per-version tabs as the expanded strip. */
  showTimeline?: boolean
  showConflicts?: boolean
  /** Conflict count shown under the Conflicts label (anomaly build). */
  conflictCount?: number | null
}) {
  return (
    <aside className="w-9 shrink-0 border-r border-border bg-surface flex flex-col items-center gap-3 py-3">
      <button
        onClick={() => onExpand('find')}
        title="Expand panel"
        className="text-ink-muted hover:text-brand p-1 rounded hover:bg-surface-muted"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M4.5 2.5 8 6l-3.5 3.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      <button
        onClick={() => onExpand('find')}
        title="Expand Find"
        className="[writing-mode:vertical-rl] text-[10px] text-brand uppercase tracking-[0.1em] font-semibold hover:text-brand-dark"
      >
        Find
      </button>
      {findHits != null && findHits > 0 && (
        <span className="font-mono text-[10px] text-ink-faint tabular-nums">{findHits}</span>
      )}
      <button
        onClick={() => onExpand('chat')}
        title="Expand Assistant"
        className="[writing-mode:vertical-rl] text-[10px] text-ink-faint uppercase tracking-[0.1em] font-semibold hover:text-brand"
      >
        Assistant
      </button>
      {showTimeline && (
        <button
          onClick={() => onExpand('timeline')}
          title="Expand Timeline"
          className="[writing-mode:vertical-rl] text-[10px] text-ink-faint uppercase tracking-[0.1em] font-semibold hover:text-brand"
        >
          Timeline
        </button>
      )}
      {showConflicts && (
        <button
          onClick={() => onExpand('conflicts')}
          title="Expand Conflicts"
          className="[writing-mode:vertical-rl] text-[10px] text-ink-faint uppercase tracking-[0.1em] font-semibold hover:text-brand"
        >
          Conflicts
        </button>
      )}
      {showConflicts && conflictCount != null && conflictCount > 0 && (
        <span className="font-mono text-[10px] text-risk-med tabular-nums">{conflictCount}</span>
      )}
      {onOpenOutline && (
        <button
          onClick={onOpenOutline}
          title="Open the recording storyboard"
          className="[writing-mode:vertical-rl] text-[10px] text-ink-faint uppercase tracking-[0.1em] font-semibold hover:text-brand"
        >
          Outline
        </button>
      )}
    </aside>
  )
}
