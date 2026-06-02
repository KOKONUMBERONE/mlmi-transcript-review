import { useState } from 'react'
import type {
  FocusMatchDetail,
  FocusMatchType,
  FocusMode,
  FocusResult,
  FocusSnippet,
} from '../types'

interface Props {
  text: string
  onTextChange: (text: string) => void
  mode: FocusMode
  onModeChange: (mode: FocusMode) => void
  onRun: () => void
  onClear: () => void
  running: boolean
  active: boolean
  result: FocusResult | null
  onSnippetClick: (snippet: FocusSnippet, label: string) => void
}

// Distinct from the risk palette (red/amber): focus uses violet so a
// focus-driven HIGH is visually separable from a default-HIGH.
const MATCH_CHIP: Record<FocusMatchType, string> = {
  exact: 'bg-focus/15 text-focus border-focus/40',
  alias: 'bg-focus/10 text-focus border-focus/30',
  semantic: 'bg-surface-muted text-ink-muted border-border',
  llm: 'bg-focus/15 text-focus border-focus/40',
}

const MATCH_LABEL: Record<FocusMatchType, string> = {
  exact: 'exact',
  alias: 'alias',
  semantic: 'semantic',
  llm: 'AI',
}

// Approximate match kinds worth flagging to the reviewer (literal/pattern are
// solid, so they get no note).
const DETAIL_NOTE: Partial<Record<FocusMatchDetail, string>> = {
  stem: 'variant',
  partial: 'partial',
  phonetic: 'sounds-alike',
  fuzzy: 'fuzzy',
  expanded: 'related',
}

function totalHits(result: FocusResult | null): number {
  if (!result) return 0
  return result.terms.reduce((n, t) => n + t.snippets.length, 0)
}

export default function FocusPanel({
  text,
  onTextChange,
  mode,
  onModeChange,
  onRun,
  onClear,
  running,
  active,
  result,
  onSnippetClick,
}: Props) {
  const [showHelp, setShowHelp] = useState(false)
  const hits = totalHits(result)
  const ai = mode === 'ai'

  return (
    <aside className="w-80 shrink-0 border-r border-border bg-white overflow-y-auto flex flex-col">
      <div className="px-4 py-3 border-b border-border sticky top-0 bg-white z-10">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[10px] text-focus uppercase tracking-[0.2em] font-semibold">
            Case focus
          </p>
          {active && (
            <p className="text-[10px] font-mono text-ink-faint tabular-nums">
              {hits} {hits === 1 ? 'hit' : 'hits'}
            </p>
          )}
        </div>

        {/* Retrieval-engine toggle: deterministic lexical vs local-LLM. */}
        <div className="mb-2 inline-flex rounded border border-border overflow-hidden text-[11px]">
          {(['lexical', 'ai'] as FocusMode[]).map((mname) => (
            <button
              key={mname}
              onClick={() => onModeChange(mname)}
              className={[
                'px-2.5 py-0.5 transition-colors',
                mode === mname
                  ? 'bg-focus text-white'
                  : 'bg-white text-ink-muted hover:text-ink',
              ].join(' ')}
            >
              {mname === 'lexical' ? 'Lexical' : 'AI'}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => onTextChange(e.target.value)}
          onKeyDown={(e) => {
            // Cmd/Ctrl+Enter runs focus without forcing a button hunt.
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              onRun()
            }
          }}
          rows={3}
          placeholder={
            ai
              ? 'the parts about the park\nweapon\nwho paid for the taxi'
              : 'weapon: gun, knife\nsilver hatchback\nReece'
          }
          className="w-full text-[13px] leading-snug border border-border rounded px-2 py-1.5 bg-white resize-y placeholder:text-ink-faint/60 focus:outline-none focus:ring-1 focus:ring-focus/50 focus:border-focus/50"
        />

        <div className="mt-1 flex items-center justify-between">
          <button
            type="button"
            onClick={() => setShowHelp((s) => !s)}
            className="text-[10px] text-ink-faint hover:text-ink underline decoration-dotted underline-offset-2"
          >
            how to enter terms
          </button>
        </div>
        {showHelp && ai && (
          <p className="mt-1 text-[10px] text-ink-muted leading-relaxed bg-surface-subtle rounded px-2 py-1.5">
            One query per line — a keyword or a plain-English need (e.g.{' '}
            <span className="font-mono">the parts about the park</span>). A{' '}
            <span className="font-medium">local model reads the whole transcript</span>{' '}
            and returns the segments that are <em>about</em> it, including lines
            that don't use your words but refer to it by context. It still runs
            on your machine — nothing is uploaded.
          </p>
        )}
        {showHelp && !ai && (
          <p className="mt-1 text-[10px] text-ink-muted leading-relaxed bg-surface-subtle rounded px-2 py-1.5">
            One focus term per line. Related wording from this transcript is
            pulled in <span className="font-medium">automatically</span> — typing{' '}
            <span className="font-mono">weapon</span> also finds "gun"/"knife" if
            the case uses them. Common categories (time, date, money, age, phone,
            postcode, plate, …) are detected too, so{' '}
            <span className="font-mono">time</span> also finds "9.36" / "half
            past". Add comma-separated{' '}
            <span className="font-medium">aliases</span> after a colon to widen
            the search: <span className="font-mono">weapon: gun, knife</span>.
            (Advanced: force a category with{' '}
            <span className="font-mono">@</span>, e.g.{' '}
            <span className="font-mono">@clock</span>.) Everything stays on your
            machine — no model is asked to generate it.
          </p>
        )}

        <div className="mt-2 flex items-center gap-1.5">
          <button
            onClick={onRun}
            disabled={running || text.trim() === ''}
            className="flex-1 text-xs font-medium px-3 py-1.5 rounded bg-focus text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {running ? 'Searching…' : 'Run focus'}
          </button>
          <button
            onClick={onClear}
            disabled={!active && !result}
            className="text-xs px-3 py-1.5 rounded border border-border text-ink-muted bg-white hover:border-ink-muted hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear focus
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        {!active || !result ? (
          <p className="py-8 px-2 text-center text-[11px] text-ink-faint italic leading-relaxed">
            Declare the people, objects, or topics that matter for this case.
            Matching spans are elevated to high risk and the audio is anchored
            to each piece of evidence.
          </p>
        ) : hits === 0 ? (
          <p className="py-8 px-2 text-center text-[11px] text-ink-faint italic">
            No segments matched these focus terms. Try adding aliases (e.g.{' '}
            <span className="font-mono not-italic">weapon: gun, knife</span>).
          </p>
        ) : (
          <div className="space-y-4">
            {result.terms.map((term) => (
              <section key={term.focus_label}>
                <div className="flex items-baseline justify-between mb-1 px-1">
                  <h3 className="text-xs font-semibold text-ink truncate">
                    {term.focus_label}
                  </h3>
                  <span className="text-[10px] font-mono text-ink-faint tabular-nums shrink-0 ml-2">
                    {term.snippets.length}
                  </span>
                </div>
                {term.auto_aliases && term.auto_aliases.length > 0 && (
                  <p className="px-1 mb-1.5 text-[10px] text-ink-faint leading-snug">
                    + related in this transcript:{' '}
                    <span className="text-focus/90">{term.auto_aliases.join(', ')}</span>
                  </p>
                )}
                {term.snippets.length === 0 ? (
                  <p className="px-1 text-[11px] text-ink-faint italic">
                    no matches
                  </p>
                ) : (
                  <ol className="space-y-1">
                    {term.snippets.map((s, i) => (
                      <li key={`${s.segment_id}-${i}`}>
                        <button
                          onClick={() => onSnippetClick(s, term.focus_label)}
                          className="w-full text-left rounded px-2 py-1.5 hover:bg-focus/5 border border-transparent hover:border-focus/20 transition-colors group"
                        >
                          <div className="flex items-center gap-1.5 mb-0.5">
                            <span
                              className={`text-[9px] font-mono uppercase tracking-wide px-1 py-px rounded-sm border ${MATCH_CHIP[s.match_type]}`}
                            >
                              {MATCH_LABEL[s.match_type]}
                            </span>
                            <span className="text-[10px] font-mono text-ink-faint tabular-nums">
                              {s.focus_score.toFixed(2)}
                            </span>
                            {s.match_detail && DETAIL_NOTE[s.match_detail] && (
                              <span className="text-[9px] italic text-focus/80">
                                {DETAIL_NOTE[s.match_detail]}
                              </span>
                            )}
                            <span className="text-[10px] font-mono text-ink-faint tabular-nums ml-auto">
                              {formatTime(s.segment_start)}
                            </span>
                          </div>
                          <p className="text-[12px] leading-snug text-ink-muted group-hover:text-ink line-clamp-2">
                            {s.evidence}
                          </p>
                          {s.llm_reason && (
                            <p className="mt-0.5 text-[10px] italic text-focus/80 leading-snug line-clamp-2">
                              {s.llm_reason}
                            </p>
                          )}
                        </button>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            ))}
          </div>
        )}
      </div>
    </aside>
  )
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${s.toString().padStart(2, '0')}`
}
