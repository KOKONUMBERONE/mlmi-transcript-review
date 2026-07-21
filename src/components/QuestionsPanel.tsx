import { useState } from 'react'
import type { PoliceQuestion } from '../study/trials'

// Persistent "Case questions" card pinned at the top of the left column during a
// police foraging task. Drives the search + captures answers in-app; answers are
// logged (question_answer events) and ride the Supabase snapshot with everything
// else. Four question types — see PoliceQuestion in trials.ts:
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
  className?: string
}

export default function QuestionsPanel({ questions, answers, onChange, onCommit, className = '' }: Props) {
  if (questions.length === 0) return null
  return (
    <aside
      className={`bg-surface border-r border-b border-border overflow-y-auto flex flex-col ${className}`}
      aria-label="Case questions"
    >
      <div className="px-4 py-2.5 border-b border-border shrink-0 sticky top-0 bg-surface z-10">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Case questions</h2>
        <p className="text-[10px] text-ink-faint mt-0.5">Answer as you work — your answers are saved automatically.</p>
      </div>
      <ol className="px-4 py-3 space-y-4">
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
