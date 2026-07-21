import { useMemo, useRef, useState } from 'react'
import {
  POLICE_QUESTIONNAIRE,
  REQUIRED_IDS,
  type SurveyItem,
} from '../study/questionnaire'

export type SurveyValue = string | string[] | number
export type SurveyAnswers = Record<string, SurveyValue>

// Full-page in-app feedback questionnaire shown on the police Done screen
// (replaces the Google Form). Choice questions are required; open text is not.
// On submit the parent logs every answer + re-uploads the snapshot.
export default function EndQuestionnaire({
  onSubmit,
  submitting,
}: {
  onSubmit: (answers: SurveyAnswers) => void
  submitting: boolean
}) {
  const [answers, setAnswers] = useState<SurveyAnswers>({})
  const [showErrors, setShowErrors] = useState(false)
  const rowRefs = useRef<Record<string, HTMLDivElement | null>>({})

  const missing = useMemo(() => {
    const set = new Set<string>()
    for (const id of REQUIRED_IDS) {
      const v = answers[id]
      const empty = v == null || (Array.isArray(v) && v.length === 0) || v === ''
      if (empty) set.add(id)
    }
    return set
  }, [answers])

  const set = (id: string, v: SurveyValue) => setAnswers((prev) => ({ ...prev, [id]: v }))

  const handleSubmit = () => {
    if (missing.size > 0) {
      setShowErrors(true)
      const firstId = POLICE_QUESTIONNAIRE.find((q) => missing.has(q.id))?.id
      if (firstId) rowRefs.current[firstId]?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      return
    }
    onSubmit(answers)
  }

  return (
    <div className="absolute inset-0 z-30 bg-surface-muted overflow-y-auto">
      <div className="mx-auto max-w-2xl px-5 py-8">
        <h1 className="text-base font-semibold text-ink mb-1">Feedback questionnaire</h1>
        <p className="text-[12px] text-ink-muted mb-6">
          Thank you for completing both tasks. Please answer the questions below — the starred (
          <span className="text-risk-high">*</span>) choice questions are required; the open
          comments are optional.
        </p>

        <div className="space-y-5">
          {POLICE_QUESTIONNAIRE.map((q) => (
            <div key={q.id} ref={(el) => (rowRefs.current[q.id] = el)}>
              <SurveyRow
                q={q}
                value={answers[q.id]}
                onChange={(v) => set(q.id, v)}
                invalid={showErrors && missing.has(q.id)}
              />
            </div>
          ))}
        </div>

        <div className="mt-8 border-t border-border pt-5">
          {showErrors && missing.size > 0 && (
            <p className="text-[12px] text-risk-high mb-3">
              {missing.size} required question{missing.size > 1 ? 's' : ''} still need an answer —
              they’re marked in red above.
            </p>
          )}
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full text-sm font-medium px-3 py-2.5 rounded bg-brand text-white hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'Submit feedback'}
          </button>
        </div>
      </div>
    </div>
  )
}

function SurveyRow({
  q,
  value,
  onChange,
  invalid,
}: {
  q: SurveyItem
  value: SurveyValue | undefined
  onChange: (v: SurveyValue) => void
  invalid: boolean
}) {
  if (q.type === 'section') {
    return (
      <div className="pt-4 first:pt-0">
        <h2 className="text-[13px] font-semibold text-brand uppercase tracking-wide">{q.title}</h2>
        {q.blurb && <p className="text-[12px] text-ink-muted mt-1 leading-snug">{q.blurb}</p>}
      </div>
    )
  }
  if (q.type === 'legend') {
    return <p className="text-[11px] text-ink-faint italic leading-snug">{q.text}</p>
  }

  const required = q.type === 'radio' || q.type === 'scale' || q.type === 'multi'
  return (
    <div
      className={`rounded-lg border p-3.5 ${
        invalid ? 'border-risk-high bg-risk-high-bg/40' : 'border-border bg-surface'
      }`}
    >
      <p className="text-[13px] text-ink leading-snug mb-2.5">
        {q.prompt}
        {required && <span className="text-risk-high ml-1">*</span>}
      </p>
      {'note' in q && q.note && <p className="text-[11px] text-ink-faint italic -mt-1.5 mb-2">{q.note}</p>}
      <SurveyInput q={q} value={value} onChange={onChange} />
    </div>
  )
}

type InputItem = Extract<SurveyItem, { type: 'radio' | 'scale' | 'multi' | 'open' }>

function SurveyInput({
  q,
  value,
  onChange,
}: {
  q: InputItem
  value: SurveyValue | undefined
  onChange: (v: SurveyValue) => void
}) {
  if (q.type === 'scale') {
    return (
      <div>
        <div className="flex gap-1.5">
          {[1, 2, 3, 4, 5].map((n) => {
            const on = value === n
            return (
              <button
                key={n}
                type="button"
                aria-pressed={on}
                onClick={() => onChange(n)}
                className={`w-9 h-9 rounded border text-[12px] tabular-nums transition-colors ${
                  on ? 'border-brand bg-brand text-white' : 'border-border text-ink-muted hover:border-brand/60 hover:text-ink'
                }`}
              >
                {n}
              </button>
            )
          })}
        </div>
        <div className="flex justify-between text-[9px] text-ink-faint mt-0.5 pr-1" style={{ maxWidth: '13.5rem' }}>
          <span>Strongly disagree</span>
          <span>Strongly agree</span>
        </div>
      </div>
    )
  }

  if (q.type === 'open') {
    return (
      <textarea
        value={typeof value === 'string' ? value : ''}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional…"
        rows={2}
        className="w-full text-[13px] rounded border border-border bg-bg px-2.5 py-1.5 text-ink placeholder:text-ink-faint resize-y focus:outline-none focus:border-brand/60"
      />
    )
  }

  // radio / multi
  const multi = q.type === 'multi'
  const selected: string[] = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : []
  const atCap = multi && q.type === 'multi' && q.maxSelect != null && selected.length >= q.maxSelect
  const toggle = (opt: string) => {
    if (multi) {
      const next = selected.includes(opt)
        ? selected.filter((o) => o !== opt)
        : atCap
          ? selected // ignore extra picks past the cap
          : [...selected, opt]
      onChange(next)
    } else {
      onChange(opt)
    }
  }
  return (
    <div className="space-y-1.5">
      {q.options.map((opt) => {
        const on = selected.includes(opt)
        const blocked = multi && !on && atCap
        return (
          <button
            key={opt}
            type="button"
            role={multi ? 'checkbox' : 'radio'}
            aria-checked={on}
            disabled={blocked}
            onClick={() => toggle(opt)}
            className={`flex items-start gap-2.5 w-full text-left group ${blocked ? 'opacity-40' : ''}`}
          >
            <span
              className={`mt-0.5 w-4 h-4 shrink-0 border flex items-center justify-center ${
                multi ? 'rounded-[3px]' : 'rounded-full'
              } ${on ? 'border-brand bg-brand' : 'border-border group-hover:border-brand/60'}`}
            >
              {on && <span className={`bg-white ${multi ? 'w-1.5 h-1.5 rounded-[1px]' : 'w-2 h-2 rounded-full'}`} />}
            </span>
            <span className={`text-[13px] leading-snug ${on ? 'text-ink' : 'text-ink-muted'}`}>{opt}</span>
          </button>
        )
      })}
      {multi && q.type === 'multi' && q.maxSelect != null && (
        <p className="text-[10px] text-ink-faint pt-0.5">
          {selected.length}/{q.maxSelect} selected
        </p>
      )}
    </div>
  )
}
