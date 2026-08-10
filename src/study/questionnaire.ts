// Police feedback questionnaire — shown in-app on the Done screen. Source:
// the approved police-feedback questionnaire. Answers are
// logged as question_answer events with stimulus_id='questionnaire'.
//
// Sheet notes (flagged to the experimenter):
//  - row 9 (time saving) had no type/required — treated as Likert+NotSure, required.
//  - rows 27/28 had their response types swapped — corrected here.
//  - typos fixed: "infromation" -> "information", "to results in" -> "to result in".

export type SurveyItem =
  | { id: string; type: 'section'; title: string; blurb?: string }
  | { id: string; type: 'legend'; text: string }
  | { id: string; type: 'radio'; prompt: string; options: string[] }
  | {
      id: string
      type: 'scale' // 1–5 buttons; per-item anchors + optional "Not sure"
      prompt: string
      boldTerm?: string // visually emphasise one comparison term in the prompt
      minLabel?: string // default "Strongly disagree"
      maxLabel?: string // default "Strongly agree"
      notSure?: boolean
    }
  | {
      id: string
      type: 'multi'
      prompt: string
      options: string[]
      maxSelect?: number
      required?: boolean // default true; sheet marks the keep-features one optional
    }
  | {
      id: string
      type: 'open'
      prompt: string
      note?: string
      required?: boolean // default false
      inputMode?: 'email'
    }

export const AGREE_LEGEND =
  '1 = Strongly disagree · 2 = Disagree · 3 = Neither agree nor disagree · 4 = Agree · 5 = Strongly agree · or "Not sure"'
export const USEFUL_LEGEND = '1 = Not useful … 5 = Extremely useful · or "Not sure"'

const FAMILIARITY = [
  'Not at all familiar', 'Slightly familiar', 'Moderately familiar', 'Very familiar', 'Extremely familiar',
]

// Keep-features option list — mirrors the features rated in sections C/E/F.
const FEATURES = [
  'Sentence low-confidence highlighting',
  'Word low-confidence highlighting',
  'Confidence / Importance / Both control',
  'Word correction',
  'Sentence rewriting',
  'Segment verification',
  'Clean view / show changes control',
  'Find',
  'Assistant',
  'Conflicts',
  'Timeline',
  'Outline',
  'Change log',
  'Export options',
]

const agree = (id: string, prompt: string): SurveyItem => ({
  id, type: 'scale', prompt, notSure: true,
})
const useful = (id: string, prompt: string, boldTerm?: string): SurveyItem => ({
  id, type: 'scale', prompt, boldTerm,
  minLabel: 'Not useful', maxLabel: 'Extremely useful', notSure: true,
})

export const POLICE_QUESTIONNAIRE: SurveyItem[] = [
  // ---- Professional background ----
  { id: 's_bg', type: 'section', title: 'Professional background',
    blurb: 'These questions help us understand the range of professional experience represented in the study.' },
  { id: 'bg1', type: 'radio',
    prompt: 'How often does your work involve reviewing interviews, statements, audio, or transcripts?',
    options: ['Daily', 'Weekly', 'Monthly', 'A few times per year', 'Less than once per year', 'Never'] },
  { id: 'bg2', type: 'radio', prompt: 'How familiar are you with automatic transcription tools?', options: FAMILIARITY },
  { id: 'bg3', type: 'radio', prompt: 'How familiar are you with AI-assisted work tools?', options: FAMILIARITY },
  { id: 'bg4', type: 'open',
    prompt: 'If you are comfortable doing so, please tell us a little more about your professional background (for example, country or region, role, years of policing experience, or other relevant experience).' },

  // ---- A. Overall impact ----
  { id: 's_a', type: 'section', title: 'A. Overall impact' },
  { id: 'imp1', type: 'scale',
    prompt: 'To what extent could this tool improve current practice?',
    minLabel: 'Not at all', maxLabel: 'Significantly' },
  { id: 'imp2', type: 'open', prompt: 'Please explain your answer' },
  { id: 'l_a', type: 'legend', text: AGREE_LEGEND },
  agree('oa1', 'Overall, I feel like using this interface is likely to result in time saving'),
  agree('oa2', 'Overall, I feel like this interface is likely to result in more accurate transcripts'),
  agree('oa3', 'I believe the interface would help me find important information quicker'),
  agree('oa4', 'The interface would improve handover to another officer or team.'),
  agree('oa5', 'The interface could support handover to typist or CPS'),
  agree('oa6', 'I would want to use this (or a slightly improved) interface in my work'),
  agree('oa7', 'The interface provides all the functions I need for transcript review'),
  agree('oa8', 'AI-generated summary and information can be traced to its audio source and verified'),

  // ---- C. Overall feedback — auditability and workflow ----
  { id: 's_c', type: 'section', title: 'C. Overall feedback — auditability and workflow' },
  agree('aw1', 'The change log clearly records edits and verification actions.'),
  agree('aw2', 'The export options provide an appropriate review record.'),
  agree('aw3', 'The manually verified text is clearly distinguished from the automated transcript'),
  useful('aw4', 'How useful is segment verification?'),
  useful('aw5', 'How useful is the clean view / show changes control?'),

  // ---- E. Transcript review and highlighting ----
  { id: 's_e', type: 'section', title: 'E. Transcript review and highlighting',
    blurb: 'How useful is each part? (1 = Not useful … 5 = Extremely useful, or "Not sure")' },
  useful('hl1', 'Overall, how useful are the confidence highlights?'),
  useful('hl2', 'How useful is the sentence low-confidence highlighting?', 'sentence'),
  useful('hl3', 'How useful is the word low-confidence highlighting?', 'word'),
  useful('hl4', 'How useful is the Confidence / Importance / Both control?'),
  useful('hl5', 'How useful is word correction?'),
  useful('hl6', 'How useful is sentence rewriting?'),
  { id: 'hlpref', type: 'radio',
    prompt: 'Which highlighting approach would you prefer?',
    options: ['Word highlighting only', 'Sentence highlighting only', 'Both word and sentence highlighting',
      'No highlighting', 'It depends on the task', 'Unable to judge'] },

  // ---- F. AI tools ----
  { id: 's_f', type: 'section', title: 'F. AI tools' },
  useful('ai1', 'How useful is the Find feature?'),
  useful('ai2', 'How useful is the Assistant feature?'),
  useful('ai3', "How useful are the Assistant's source links?"),
  useful('ai4', 'How useful is the conflict finding feature?'),
  useful('ai5', 'How useful is the Timeline feature?'),
  useful('ai6', 'How useful is the Outline feature?'),

  // ---- H. Feature priorities ----
  { id: 's_h', type: 'section', title: 'H. Feature priorities' },
  { id: 'fp1', type: 'multi', required: false,
    prompt: 'If you wanted to simplify the interface, which features will you keep?',
    options: FEATURES },

  // ---- I. Final comments ----
  { id: 's_i', type: 'section', title: 'I. Final comments' },
  { id: 'fc1', type: 'open', prompt: 'Is there any features / ability that you would want to add?' },
  { id: 'fc2', type: 'open', prompt: 'Which features are the most useful, and why?' },
  { id: 'fc3', type: 'open', prompt: 'Is any feature inaccurate, misleading, or difficult to verify?' },
  { id: 'fc4', type: 'open', prompt: 'Which feature is least useful or hardest to understand, and why?' },
  { id: 'fc5', type: 'open', prompt: 'Do you have any other concerns or suggestions?' },

]

/** IDs of the questions that MUST be answered before submit. */
export const REQUIRED_IDS = POLICE_QUESTIONNAIRE.filter(
  (q) =>
    (q.type === 'radio' ||
      q.type === 'scale' ||
      (q.type === 'multi' && q.required !== false) ||
      (q.type === 'open' && q.required === true)),
).map((q) => q.id)
