import { useState, type ReactNode } from 'react'
import type { PoliceQuestion } from '../study/trials'

// "Case questions" panel — lives in the RIGHT column during a police foraging
// task, sharing it with the Review panel via a two-tab strip (Questions is a
// framed brand chip so it's spottable). Drives the search + captures answers
// in-app; answers are logged (question_answer events) and ride the Supabase
// snapshot with everything else.
// Four question types — see PoliceQuestion in trials.ts:
//   mc    single- or multi-select choice
//   open  free-text answer in a box below the prompt (NOT an in-sentence blank)
//   scale Likert rating (min..max)
//   task  directive only — no answer field; the "answer" is what they correct in
//         the transcript.
export type AnswerValue = string | string[] | number

interface Props {
  questions: PoliceQuestion[]
  answers: Record<string, AnswerValue>
  /** Live value change (controlled inputs) — state only, cheap. */
  onChange: (id: string, value: AnswerValue) => void
  /** Commit point worth logging (select / blur). */
  onCommit: (id: string, value: AnswerValue, type: PoliceQuestion['type']) => void
  /** The column's tab strip (right column: Questions / Review). */
  tabStrip?: ReactNode
  onToggleCollapse?: () => void
  /** Which side of the workspace the panel sits on (border + chevron flip). */
  side?: 'left' | 'right'
  /** Optional study-specific guidance shown above the question list. */
  guidance?: string
}

export default function QuestionsPanel({
  questions,
  answers,
  onChange,
  onCommit,
  tabStrip,
  onToggleCollapse,
  side = 'left',
  guidance,
}: Props) {
  if (questions.length === 0) return null
  return (
    <aside
      className={`w-80 shrink-0 ${side === 'right' ? 'border-l' : 'border-r'} border-border bg-surface flex flex-col overflow-hidden`}
      aria-label="Case questions"
      data-tour="right-panel"
    >
      <div className="px-4 py-3 border-b border-border shrink-0 bg-surface">
        <div className="flex items-center justify-between gap-2">
          {tabStrip}
          {onToggleCollapse && (
            <button
              onClick={onToggleCollapse}
              title="Collapse panel"
              className="shrink-0 text-ink-faint hover:text-ink p-0.5 rounded hover:bg-surface-muted"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d={side === 'right' ? 'M4.5 2.5 8 6l-3.5 3.5' : 'M7.5 2.5 4 6l3.5 3.5'} strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          )}
        </div>
      </div>
      {/* Brand-tinted banner keeps the "this is the task" signal inside the tab.
          Copy: questions are optional; officers may move to the feedback whenever
          they feel ready (supervisor request, 2026-07-24). */}
      <div className="px-4 py-2 border-b border-brand/20 bg-brand-bg shrink-0">
        <p className="text-[10px] text-ink-muted">
          {guidance ?? (
            <>
              You don't have to finish all the questions — you can move on to the feedback whenever
              you feel ready.
            </>
          )}
        </p>
      </div>
      <ol className="px-4 py-3 space-y-4 overflow-y-auto flex-1">
        {questions.map((q, i) => (
          <li key={q.id} className="text-[12px]">
            <div className="flex gap-1.5">
              <span className="text-ink-faint tabular-nums shrink-0">{i + 1}.</span>
              <p className="text-ink leading-snug">{q.prompt}</p>
            </div>
            <div className="mt-1.5 pl-4">
              <QuestionInput q={q} value={answers[q.id]} onChange={onChange} onCommit={onCommit} />
            </div>
          </li>
        ))}
      </ol>
    </aside>
  )
}

function QuestionInput({
  q,
  value,
  onChange,
  onCommit,
}: {
  q: PoliceQuestion
  value: AnswerValue | undefined
  onChange: Props['onChange']
  onCommit: Props['onCommit']
}) {
  if (q.type === 'task') {
    return (
      <p className="text-[11px] text-ink-faint italic">
        No written answer — make your corrections directly in the transcript.
      </p>
    )
  }

  if (q.type === 'open') {
    return <OpenInput q={q} value={typeof value === 'string' ? value : ''} onChange={onChange} onCommit={onCommit} />
  }

  if (q.type === 'scale') {
    const min = q.min ?? 1
    const max = q.max ?? 5
    const nums = Array.from({ length: max - min + 1 }, (_, k) => min + k)
    return (
      <div>
        <div className="flex gap-1">
          {nums.map((n) => {
            const on = value === n
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  onChange(q.id, n)
                  onCommit(q.id, n, 'scale')
                }}
                className={`w-7 h-7 rounded border text-[11px] tabular-nums transition-colors ${
                  on
                    ? 'border-brand bg-brand text-white'
                    : 'border-border text-ink-muted hover:border-brand/60 hover:text-ink'
                }`}
              >
                {n}
              </button>
            )
          })}
        </div>
        {(q.minLabel || q.maxLabel) && (
          <div className="flex justify-between text-[9px] text-ink-faint mt-0.5 pr-1">
            <span>{q.minLabel}</span>
            <span>{q.maxLabel}</span>
          </div>
        )}
      </div>
    )
  }

  // mc — single or multi select
  const multi = q.multi === true
  const selected: string[] = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []
  const toggle = (opt: string) => {
    if (multi) {
      const next = selected.includes(opt) ? selected.filter((o) => o !== opt) : [...selected, opt]
      onChange(q.id, next)
      onCommit(q.id, next, 'mc')
    } else {
      onChange(q.id, opt)
      onCommit(q.id, opt, 'mc')
    }
  }
  return (
    <div className="space-y-1">
      {q.options.map((opt) => {
        const on = selected.includes(opt)
        return (
          <button
            key={opt}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            onClick={() => toggle(opt)}
            className="flex items-start gap-2 w-full text-left group"
          >
            <span
              className={`mt-0.5 w-3.5 h-3.5 shrink-0 border flex items-center justify-center ${
                multi ? 'rounded-[3px]' : 'rounded-full'
              } ${on ? 'border-brand bg-brand' : 'border-border group-hover:border-brand/60'}`}
            >
              {on && <span className={`bg-white ${multi ? 'w-1.5 h-1.5 rounded-[1px]' : 'w-1.5 h-1.5 rounded-full'}`} />}
            </span>
            <span className={`text-[12px] leading-snug ${on ? 'text-ink' : 'text-ink-muted'}`}>{opt}</span>
          </button>
        )
      })}
    </div>
  )
}

// Open text keeps its own draft so typing never re-renders the whole workspace;
// commits (for logging) on blur.
function OpenInput({
  q,
  value,
  onChange,
  onCommit,
}: {
  q: Extract<PoliceQuestion, { type: 'open' }>
  value: string
  onChange: Props['onChange']
  onCommit: Props['onCommit']
}) {
  const [draft, setDraft] = useState(value)
  return (
    <textarea
      value={draft}
      placeholder={q.placeholder ?? 'Type your answer…'}
      onChange={(e) => {
        setDraft(e.target.value)
        onChange(q.id, e.target.value)
      }}
      onBlur={() => onCommit(q.id, draft, 'open')}
      rows={2}
      className="w-full text-[12px] rounded border border-border bg-bg px-2 py-1.5 text-ink placeholder:text-ink-faint resize-y focus:outline-none focus:border-brand/60"
    />
  )
}
