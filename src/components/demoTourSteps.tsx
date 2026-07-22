import type { RiskDimension, SentenceSignal } from '../types'
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
  /** First segment carrying a high-risk word — the worked example. */
  highRiskSegmentId: number | null
}

export interface TourStep {
  id: string
  /** data-tour anchor (or a fn of the api, e.g. a data-segment-id selector).
   *  Omit for a centred card (welcome / closing). */
  anchor?: string | ((api: TourApi) => string | null)
  title: string
  body: string
  /** State changes to apply just before this step is shown. */
  prepare?: (api: TourApi) => void
}

// One pass over everything the officers will use, in reading order:
// overview → word marks → a real flagged sentence → sentence tint → view
// options → edit/verify → review log → export → questions → Find → the other
// AI tools → go. Kept to 12 steps ≈ 3 minutes read aloud.
export const DEMO_TOUR_STEPS: TourStep[] = [
  {
    id: 'welcome',
    title: 'Quick tour (about 3 minutes)',
    body:
      'This screen is where you review an AI-transcribed recording. The transcript is in the middle, AI tools sit on the left, the case questions and your review log are on the right, and the audio player runs along the bottom. Click Next to walk through each part.',
  },
  {
    id: 'words',
    anchor: 'words-toggle',
    title: 'Word highlighting',
    body:
      'The transcript marks individual words the AI may have got wrong: red = likely wrong AND important, amber = medium risk. This switch changes what the marks mean — how unsure the AI was (Uncertainty), how much a mistake would matter (Importance), or both combined.',
    prepare: (api) => api.setDimension('combined'),
  },
  {
    id: 'flagged-sentence',
    anchor: (api) =>
      api.highRiskSegmentId != null ? `[data-segment-id="${api.highRiskSegmentId}"]` : null,
    title: 'A flagged sentence',
    body:
      'Here is a real example — the marked words are the risky ones. Click any word to see other candidates, type a correction, or play the audio from that exact word. Click the timestamp to listen to the whole sentence.',
    prepare: (api) => api.expandSegment(api.highRiskSegmentId),
  },
  {
    id: 'sentences',
    anchor: 'sentences-toggle',
    title: 'Sentence highlighting',
    body:
      'Whole sentences are also tinted: Confidence shows where the speech recognition itself was least sure; Importance shows the sentences that matter most to the case; Both combines them. Darker tint = look here first.',
    prepare: (api) => api.setSentenceSignal('confidence'),
  },
  {
    id: 'view-menu',
    anchor: 'view-menu',
    title: 'View options',
    body:
      'This menu adjusts the display: filter to only high-risk sections, show or hide the amber medium marks, or pin every word mark on screen. Use it whenever the highlighting feels like too much or too little.',
  },
  {
    id: 'edit-verify',
    anchor: (api) =>
      api.highRiskSegmentId != null ? `[data-segment-id="${api.highRiskSegmentId}"]` : null,
    title: 'Fix and verify',
    body:
      'Double-click a sentence (or use the pencil) to rewrite it. When you are happy a section is accurate, press Verify — it turns green. Shift-click Verify to sign off a whole range at once.',
    prepare: (api) => api.expandSegment(api.highRiskSegmentId),
  },
  {
    id: 'review-log',
    anchor: 'right-panel',
    title: 'Your review log',
    body:
      'Every change you make is recorded here automatically — who, when, and what changed. Nothing is lost: even deleted words stay visible with a line through them, so the transcript can stand as a proper record.',
    prepare: (api) => api.openRight('review'),
  },
  {
    id: 'export',
    anchor: 'export',
    title: 'Export',
    body:
      'When a review is finished you can download it from here — a readable report, the corrected transcript, or the full change log — for disclosure or handover.',
    prepare: (api) => api.openRight('review'),
  },
  {
    id: 'questions',
    anchor: 'right-panel',
    title: 'Case questions',
    body:
      'During each task the case questions sit here. Answer them as you work — answers save automatically, and you can change them at any time before you end the task.',
    prepare: (api) => api.openRight('questions'),
  },
  {
    id: 'find',
    anchor: 'left-rail',
    title: 'Find',
    body:
      'Type a case term — a name, an object, a time — and Find pulls up every passage about it, with clickable jumps into the audio. We have typed one for you; feel free to try your own during the tasks.',
    prepare: (api) => {
      api.openLeft('find')
      api.setFocusText('knife')
    },
  },
  {
    id: 'toolkit',
    anchor: 'left-rail',
    title: 'The other AI tools',
    body:
      'Assistant answers questions about the recording and cites the exact passage. Timeline lays out the events in order — click one to jump there. Conflicts lists statements that may contradict each other. Outline gives a storyboard of the whole recording. All AI output is a lead, not evidence — verify against the audio.',
    prepare: (api) => api.openLeft('timeline'),
  },
  {
    id: 'ready',
    title: 'Ready to start',
    body:
      'That is everything. You will review two recordings, each with its case questions; there is no time limit, and the AI transcripts do contain mistakes — finding them is part of the job. Press "End task" (top right) whenever you finish a task.',
  },
]
