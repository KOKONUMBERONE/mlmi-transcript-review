// Tab strip + collapsed rail for the left column when the assistant chat is
// enabled (full build): the w-80 column holds Find OR Assistant, switched by
// these tabs. The study build never renders either of these — FocusPanel's
// own title + collapsed branch keep running there untouched.

export type LeftTab = 'find' | 'chat'

export function LeftTabStrip({
  active,
  onSelect,
  onOpenOutline,
}: {
  active: LeftTab
  onSelect: (tab: LeftTab) => void
  /** When set, an "Outline" launcher appears after Assistant. It is a button,
   *  not a selectable panel — clicking it opens the full-screen storyboard. */
  onOpenOutline?: () => void
}) {
  const cls = (tab: LeftTab) =>
    [
      'text-[10px] uppercase tracking-[0.1em] font-semibold pb-0.5 border-b-2 transition-colors',
      active === tab
        ? 'text-brand border-brand'
        : 'text-ink-faint border-transparent hover:text-ink',
    ].join(' ')
  return (
    <div className="flex items-baseline gap-3" role="tablist" aria-label="Left panel">
      <button role="tab" aria-selected={active === 'find'} className={cls('find')} onClick={() => onSelect('find')}>
        Find
      </button>
      <button role="tab" aria-selected={active === 'chat'} className={cls('chat')} onClick={() => onSelect('chat')}>
        Assistant
      </button>
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

/** Collapsed w-9 rail with both tab labels — clicking a label expands the
 *  column with that tab active. */
export function CollapsedLeftRail({
  findHits,
  onExpand,
  onOpenOutline,
}: {
  /** Find hit count shown under its label when a retrieval is active. */
  findHits?: number | null
  onExpand: (tab: LeftTab) => void
  /** Same Outline launcher as the expanded strip (full build). */
  onOpenOutline?: () => void
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
