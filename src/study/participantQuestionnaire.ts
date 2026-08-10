// Short end questionnaire for the regular participant study. This remains
// separate from the longer Police Scotland feedback questionnaire: participant
// outcomes come primarily from task performance, so this form captures only
// confidence, workload, time pressure, and immediate experience.

import type { SurveyItem } from './questionnaire'

export const AGREE_LEGEND =
  '1 = Strongly disagree · 2 = Disagree · 3 = Neither agree nor disagree · 4 = Agree · 5 = Strongly agree'

const scale = (
  id: string,
  prompt: string,
  minLabel: string,
  maxLabel: string,
  notSure = false,
): SurveyItem => ({ id, type: 'scale', prompt, minLabel, maxLabel, notSure })

export const PARTICIPANT_QUESTIONNAIRE: SurveyItem[] = [
  {
    id: 's_confidence',
    type: 'section',
    title: 'Your task experience',
    blurb: 'These brief questions are about how the tasks felt, not about evaluating the overall study design.',
  },
  scale(
    'confidence_corrections',
    'How confident are you in the transcription corrections you made?',
    'Not at all confident',
    'Very confident',
  ),
  scale(
    'confidence_answers',
    'How confident are you that your answers to the case questions were supported by the recordings?',
    'Not at all confident',
    'Very confident',
  ),
  { id: 'l_agree', type: 'legend', text: AGREE_LEGEND },
  scale(
    'time_sufficient',
    'The time available allowed me to make useful progress on each task.',
    'Strongly disagree',
    'Strongly agree',
  ),
  scale(
    'mental_demand',
    'How mentally demanding did the tasks feel?',
    'Not demanding',
    'Very demanding',
  ),

  { id: 's_tools', type: 'section', title: 'Interface experience' },
  scale(
    'highlight_help',
    'How useful were the highlights for deciding where to inspect or listen again?',
    'Not useful',
    'Very useful',
    true,
  ),
  scale(
    'tools_help',
    'How useful were the AI tools for locating evidence and answering the case questions?',
    'Not useful',
    'Very useful',
    true,
  ),
  scale(
    'ease_of_use',
    'The interface was easy to understand and use during the tasks.',
    'Strongly disagree',
    'Strongly agree',
  ),
  scale(
    'overall_support',
    'Overall, the interface helped me review the recordings effectively.',
    'Strongly disagree',
    'Strongly agree',
  ),

  { id: 's_comment', type: 'section', title: 'Optional comment' },
  {
    id: 'task_comment',
    type: 'open',
    prompt: 'What most helped or hindered you while completing the tasks?',
  },
]

/** All rating questions are required; the final comment stays optional. */
export const PARTICIPANT_REQUIRED_IDS = PARTICIPANT_QUESTIONNAIRE.filter(
  (q) =>
    q.type === 'radio' ||
    q.type === 'scale' ||
    (q.type === 'multi' && q.required !== false) ||
    (q.type === 'open' && q.required === true),
).map((q) => q.id)
