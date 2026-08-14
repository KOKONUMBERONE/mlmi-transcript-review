import type { LogEvent, RiskDimension, SentenceSignal } from '../types'
import type { LeftTab, RightTab } from './LeftPanelTabs'

// The setters DemoTour drives between steps — assembled by ReviewWorkspace from
// its local state so the interface visibly switches while the officer watches.
export interface TourApi {
  setDimension: (d: RiskDimension) => void
  setSentenceSignal: (s: SentenceSignal) => void
  openLeft: (tab: LeftTab) => void
  openRight: (tab: RightTab) => void
  setFocusText: (text: string) => void
  expandSegment: (id: number | null) => void
  closeOutline: () => void
  /** First segment carrying a high-risk word — the worked example. */
  highRiskSegmentId: number | null
  /** Current WORDS-switch position — lets step copy adapt live. */
  dimension: RiskDimension
}

export interface TourStep {
  id: string
  /** data-tour anchor (or a fn of the api, e.g. a data-segment-id selector).
   *  Omit for a centred card (welcome / closing). */
  anchor?: string | ((api: TourApi) => string | null)
  title: string
  /** Static copy, or a function of the api for copy that tracks live state. */
  body: string | ((api: TourApi) => string)
  /** State changes to apply just before this step is shown. */
  prepare?: (api: TourApi) => void
  /** Hands-on step: ONLY the spotlit hole(s) are clickable; Next unlocks when
   *  isDone sees the matching event(s). Everything else stays blocked. */
  interactive?: {
    instruction: string
    /** Extra clickable regions beyond the anchor (popups, dialogs). */
    extraHoles?: string[]
    isDone: (fresh: LogEvent[], dom: Document) => boolean
  }
  /** Extra card content: 'report' embeds the miniature report preview. */
  media?: 'report'
}

const has = (fresh: LogEvent[], ...types: string[]) =>
  fresh.some((e) => types.includes(e.type as string))

// Prefill the Assistant input once the chat panel has mounted (React-controlled
// textarea → native setter + input event). Retries briefly; never overwrites
// anything the officer already typed.
function prefillChat(text: string) {
  let tries = 0
  const tick = () => {
    const ta = document.querySelector<HTMLTextAreaElement>('[data-tour="left-panel"] textarea')
    if (ta) {
      if (!ta.value) {
        const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
        set.call(ta, text)
        ta.dispatchEvent(new Event('input', { bubbles: true }))
      }
      return
    }
    if (++tries < 25) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

// Hands-on pass over everything the officers will use: every tool is tried for
// real — only the spotlit control is clickable, and the effect (marks changing,
// the review log filling up, the AI panels answering) happens live.
export const DEMO_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Quick tour (about 5 minutes)',
    body:
      'This screen is where you review an AI-transcribed recording. The transcript is in the middle, AI tools sit on the left, the case questions and your review log are on the right, and the audio player runs along the bottom. Each step now lets you try the feature yourself — only the highlighted part is clickable.',
  },
  {
    id: 'reviewer-name',
    anchor: 'reviewer',
    title: 'Put your name on the record',
    body:
      'Every edit and verification you make is recorded under this name — like signing your notebook.',
    interactive: {
      instruction: 'Click the Reviewer box and type your name.',
      isDone: (_f, dom) => {
        const inp = dom.querySelector<HTMLInputElement>('[data-tour="reviewer"] input')
        return !!inp && inp.value.trim().length >= 2
      },
    },
  },
  {
    id: 'words',
    anchor: 'words-toggle',
    title: 'Word highlighting',
    // mean depends on the selected dimension.
    body: (api) =>
      api.dimension === 'uncertainty'
        ? 'Now showing UNCERTAINTY: red = the AI was least sure it heard the word right, amber = medium uncertainty. The switch also offers Importance (words that matter to the case) and Combined (both at once). Whole-sentence tinting is a separate SENTENCES switch — you will try that shortly.'
        : api.dimension === 'importance'
          ? 'Now showing IMPORTANCE: red = words that matter most to the case, amber = medium importance. The switch also offers Uncertainty (possibly misheard) and Combined (both at once). Whole-sentence tinting is a separate SENTENCES switch — you will try that shortly.'
          : 'Now showing COMBINED: red = likely wrong AND important to the case, amber = medium risk. The switch can also show Uncertainty (possibly misheard) or Importance (matters to the case) alone. Whole-sentence tinting is a separate SENTENCES switch — you will try that shortly.',
    prepare: (api) => api.setDimension('combined'),
    interactive: {
      instruction:
        'Click "Uncertainty", then back to "Combined" — watch which words are marked change.',
      isDone: (f) => has(f, 'dimension_change'),
    },
  },
  {
    id: 'flagged-sentence',
    anchor: (api) =>
      api.highRiskSegmentId != null ? `[data-segment-id="${api.highRiskSegmentId}"]` : null,
    title: 'A flagged sentence',
    body:
      'Here is a real example — the marked words are the risky ones. Next you will fix one yourself.',
    prepare: (api) => {
      api.setDimension('combined')
      api.expandSegment(api.highRiskSegmentId)
    },
  },
  {
    id: 'edit',
    anchor: (api) =>
      api.highRiskSegmentId != null ? `[data-segment-id="${api.highRiskSegmentId}"]` : null,
    title: 'Make a correction',
    body:
      'Two ways to edit: DOUBLE-CLICK the sentence to rewrite the whole line, or CLICK A SINGLE WORD to fix just that word (a popup offers candidates, or type your own).',
    prepare: (api) => api.expandSegment(api.highRiskSegmentId),
    interactive: {
      instruction: 'Change something in this sentence now — one word or the whole line.',
      extraHoles: ['[data-tour="popup"]'],
      isDone: (f) => has(f, 'edit_apply', 'word_delete'),
    },
  },
  {
    id: 'verify',
    anchor: (api) =>
      api.highRiskSegmentId != null ? `[data-segment-id="${api.highRiskSegmentId}"]` : null,
    title: 'Verify it',
    body:
      'When you are happy a section is accurate, mark it checked — it turns green. (Shift-click Verify signs off a whole range at once.)',
    interactive: {
      instruction: 'Press "Verify" on this sentence.',
      isDone: (f) => has(f, 'verify'),
    },
  },
  {
    id: 'review-log',
    anchor: 'right-panel',
    title: 'Your review log',
    body:
      'Look — the edit and the verification you just made are already recorded here, with your name and the time. Every change is kept like this (even deleted words stay visible, struck through), so the transcript can stand as a proper record.',
    prepare: (api) => api.openRight('review'),
  },
  {
    id: 'sentences',
    anchor: 'sentences-toggle',
    title: 'Sentence highlighting',
    body:
      'Whole sentences are tinted too: Confidence shows where the speech recognition was least sure; Importance shows the sentences that matter most to the case.',
    interactive: {
      instruction: 'Click "Importance" or "Both" — watch the sentence tints change.',
      isDone: (f) =>
        f.some(
          (e) => e.type === 'filter_change' && String(e.filter ?? '').startsWith('sentence_signal:'),
        ),
    },
  },
  {
    id: 'view-menu',
    anchor: 'view-menu',
    title: 'View options',
    body:
      'This menu adjusts the display: filter to only high-risk sections, show or hide the amber medium marks, or pin every word mark on screen.',
    interactive: {
      instruction: 'Open the "View" menu and have a look at the options.',
      extraHoles: ['[data-tour="popup"]'],
      isDone: (_f, dom) => !!dom.querySelector('[role="menu"]'),
    },
  },
  {
    id: 'questions',
    anchor: 'right-panel',
    title: 'Case questions',
    body:
      'During each task the case questions sit here. Answers save automatically and you can change them any time before you end the task.',
    prepare: (api) => api.openRight('questions'),
    interactive: {
      instruction: 'Answer the practice question — click any option.',
      isDone: (f) => has(f, 'question_answer'),
    },
  },
  {
    id: 'export',
    anchor: 'export',
    title: 'Export',
    body:
      'When a review is finished you can download it — a readable report (preview below), the corrected transcript, or the full change log — for disclosure or handover.',
    prepare: (api) => api.openRight('review'),
    media: 'report',
  },
  {
    id: 'find',
    anchor: 'left-panel',
    title: 'Find',
    body:
      'Type a case term — a name, an object, a time — and Find pulls up every passage about it, with clickable jumps into the audio. We have typed one for you.',
    prepare: (api) => {
      api.openLeft('find')
      api.setFocusText('knife')
    },
    interactive: {
      instruction: 'Press "Find" and watch the matches light up in the transcript.',
      isDone: (f) => has(f, 'focus_apply'),
    },
  },
  {
    id: 'assistant',
    anchor: 'left-panel',
    title: 'Assistant',
    body:
      'Ask questions in plain English — the answer cites the exact passage it came from (click a citation to jump there). AI answers are leads, not evidence: always verify against the audio.',
    prepare: (api) => {
      api.openLeft('chat')
      prefillChat('Did the witness see a weapon?')
    },
    interactive: {
      instruction: 'Send the question we typed for you (or ask your own).',
      isDone: (f) => has(f, 'chat_send'),
    },
  },
  {
    id: 'timeline',
    anchor: 'left-panel',
    title: 'Timeline',
    body:
      'The events the AI found in the recording, in order, each linked to the moment it was said.',
    prepare: (api) => api.openLeft('timeline'),
    interactive: {
      instruction: 'Click any event — the audio jumps straight to it.',
      isDone: (f) => has(f, 'timeline_event_click'),
    },
  },
  {
    id: 'conflicts',
    anchor: 'left-panel',
    title: 'Conflicts',
    body:
      'Statements that may contradict each other — for example two different times for the same event. Each pair links to both passages.',
    prepare: (api) => api.openLeft('conflicts'),
    interactive: {
      instruction: 'Click a conflict to jump to the passages involved.',
      isDone: (f) => has(f, 'anomaly_jump'),
    },
  },
  {
    id: 'outline',
    anchor: 'left-rail',
    title: 'Outline',
    body:
      'The storyboard view: a summary of the whole recording, laid out as parts and chapters you can jump into.',
    interactive: {
      instruction: 'Click "Outline" to open the storyboard, then look around.',
      // The storyboard dialog — NOT the tour's own dialog (that would punch a
      // full-screen hole and invert the mask).
      extraHoles: ['[role="dialog"][aria-modal="true"]:not([aria-label="Guided demo"])'],
      isDone: (f) => has(f, 'outline_open'),
    },
  },
  {
    id: 'ready',
    title: 'Explore on your own',
    body:
      'That is the guided part finished. Press "Continue" to close these steps, then take as much time as you need to explore this practice recording. When you feel ready, press "Start task 1" in the top-right corner.',
    prepare: (api) => api.closeOutline(),
  },
]
