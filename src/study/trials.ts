import type { Condition } from '../types'

// Three-session within-subject design — one round per session, fixed order
// T1 → T2 → T3 (operational plan v3, 2026-07-13; supersedes the 2×2):
//   T1 proofread      — matched short pair, Plain vs Full (the ONLY
//                       confirmatory contrast; H1 = recall@T, Full > Plain)
//   T2 long recording — ~30 min drama episode: find clues/contradictions,
//                       answer questions after, correct key passages
//   T3 voice notes    — concatenated short messages: find the target info
//
// Counterbalance (T1 only): condition order (2) × clip-condition assignment
// (2) = 4 groups; N=20 → 5 per group.
// T2 runs as scheme A (Full-only, one episode) until a second matched episode
// passes the selection probes; scheme C (two episodes, Plain/Full within) adds
// the episode-condition assignment V1/V2 → 4×2 = 8 cells (N=24, or accept
// partial imbalance — decided when C is confirmed).
export type CBGroup = 'CB1' | 'CB2' | 'CB3' | 'CB4'
export type T2Mode = 'A' | 'C'
export type T2Assign = 'V1' | 'V2'
export type StudyTask = 't1' | 't2' | 't3'

// ----- Frozen study stimuli -----------------------------------------------
// A stimulus = one pre-annotated transcript JSON (already through /predict, so
// it carries combined_risk) plus its audio, and — for Full trials that use case
// focus — a frozen FocusResult JSON so focus runs with ZERO network (the
// deployed build has no :8000). All files live in  public/stimuli/  and are
// served statically (works locally and on the deployed study build).
//
// HOW TO ADD A CLIP:
//   1. Put the files in  public/stimuli/  — e.g.  t1a.json + t1a.m4a
//   2. Register the clip below, keyed by the id the trials reference
//      (gp, t1a, t1b, t2a, t2b, t3) — see buildSession.
//   3. To freeze focus: run POST :8000/focus once offline on the clip with its
//      preset focusTerms, save the response as  <id>.focus.json,  set `focus:`.
//
// A stimulusId that is NOT registered here falls back to the bundled
// placeholder transcript (defaultTranscript.json), so the whole flow runs
// before any clips are wired in.
export interface Stimulus {
  // Omitting transcript/audio keeps the bundled placeholder (defaultTranscript
  // + case447 audio) while still serving any frozen panel files listed below —
  // used by the police demo tour.
  transcript?: string // filename in public/stimuli/
  audio?: string // filename in public/stimuli/ (optional)
  focus?: string // frozen FocusResult JSON — focus-enabled Full clips only
  // Pre-baked AI results keep study trials deterministic so the
  // panels show instantly instead of waiting ~20–80s per live call. The
  // Retry/Regenerate buttons still hit the live backend.
  timeline?: string // frozen /timeline response
  outline?: string // frozen /outline response
  anomalies?: string // frozen /anomalies response
  triage?: string // frozen /triage response (SENTENCES Importance/Both signal)
}

export const STIMULI: Record<string, Stimulus> = {
  // Police cohort (Wed session, MSt in Policing): evidence-collection /
  // information-foraging material for the full interface. Only police1 is
  // currently active; see POLICE_ACTIVE_CLIPS and buildPoliceSession.
  //   police1 = tom_the_tailor radio episode (~27 min), sentence-level tint.
  //   police2 = sland_s1_combined (Shetland synthetic interview, ~36 min),
  //             re-segmented from the teammate's 30s windows into sentences so
  //             the sentence tint discriminates; whisper-large, real word-level
  //             risk + confidence (no ASR alternatives in this source).
  // Swap the files in public/stimuli/ to replace the material — no code change.
  police1: {
    transcript: 'police1.json', audio: 'police1.mp3',
    timeline: 'police1.timeline.json', outline: 'police1.outline.json',
    anomalies: 'police1.anomalies.json', triage: 'police1.triage.json',
  },
  police2: {
    transcript: 'police2.json', audio: 'police2.mp3',
    timeline: 'police2.timeline.json', outline: 'police2.outline.json',
    anomalies: 'police2.anomalies.json', triage: 'police2.triage.json',
  },
  // Police guided demo (the spotlight tour before task 1): no transcript/audio
  // on purpose — the bundled placeholder case447 loads instead (word marks +
  // baked defaultTriage work offline) — but the toolkit panels are frozen so
  // Timeline/Conflicts/Outline open instantly without the backend.
  demo: {
    timeline: 'demo.timeline.json', outline: 'demo.outline.json',
    anomalies: 'demo.anomalies.json',
  },
  // Participant Task 1 — two matched excerpts from the same public-domain
  // detective audiobook chapter. Each is ~6.5 min with ~7% controlled errors
  // split into high-risk (red) and ordinary (amber) tiers. Since 2026-08-07 the
  // counterbalance lets EITHER clip carry the Full interface (see
  // PARTICIPANT_PLAN), so both now ship frozen toolkit panels — otherwise the
  // swapped cells would sit through live backend calls the other cells never
  // see. Both sets are the AUTHORED panels that build_participant_task1.py
  // writes from its per-clip specs (it only copied part1a's into public/ before,
  // when part1a was the only Full clip). Do NOT regenerate these with the live
  // LLM routes: on part1b that produces a conflicts panel pointing straight at
  // two of the nine planted errors, which would hand the swapped cells a hint
  // the already-collected sessions never got.
  part1a: {
    transcript: 'part1a.json', audio: 'part1a.mp3',
    timeline: 'part1a.timeline.json', outline: 'part1a.outline.json',
    anomalies: 'part1a.anomalies.json', triage: 'part1a.triage.json',
  },
  part1b: {
    transcript: 'part1b.json', audio: 'part1b.mp3',
    timeline: 'part1b.timeline.json', outline: 'part1b.outline.json',
    anomalies: 'part1b.anomalies.json', triage: 'part1b.triage.json',
  },
  //   Task 2 — two LONG recordings, Plain + Full (precise finding, with
  //   questions). Full = police1 (Tom the Tailor, planted errors + questions —
  //   the trial points at that stimulus directly). Plain = Mr District
  //   Attorney ("The Forgery-Proof Note", ~27 min — picked 2026-07-25 over the
  //   Sherlock episodes: near-identical duration/wordcount/segmentation to
  //   police1 and clean diarization, so the Plain-vs-Full materials match):
  part2b: {
    transcript: 'part2b.json', audio: 'part2b.mp3',
  },
  // Real clips drop in here. Until then every id below is unregistered and
  // resolves to the bundled placeholder transcript, so the session still runs.
  // Practice (short, Full/C4 — exercises highlight + focus + edit/verify/seek):
  // gp:  { transcript: 'gp.json', audio: 'gp.m4a', focus: 'gp.focus.json' },
  // T1 — the matched short pair from study_scripts_v1 (GA1/GA2 or GB1/GB2,
  // picked after the ASR probe; the other pair is the backup):
  // t1a: { transcript: 't1a.json', audio: 't1a.m4a' },
  // t1b: { transcript: 't1b.json', audio: 't1b.m4a' },
  // T2 — public-domain detective radio episode(s), ~30 min each. t2b only
  // exists under scheme C (second episode passed the probes):
  // t2a: { transcript: 't2a.json', audio: 't2a.m4a' },
  // t2b: { transcript: 't2b.json', audio: 't2b.m4a' },
  // T3 — concatenated voice notes from the teammate dataset (one segment per
  // message, speaker = sender, 0.5–1 s silence at the joins):
  // t3:  { transcript: 't3.json', audio: 't3.m4a' },
}

// Resolve a stimulusId to fetchable URLs. import.meta.env.BASE_URL respects the
// deploy sub-path so it works both locally and on the hosted study build.
export function resolveStimulus(stimulusId: string): {
  transcriptUrl?: string
  audioUrl?: string
  focusUrl?: string
  timelineUrl?: string
  outlineUrl?: string
  anomaliesUrl?: string
  triageUrl?: string
} {
  const s = STIMULI[stimulusId]
  if (!s) return {}
  const base = import.meta.env.BASE_URL
  return {
    transcriptUrl: s.transcript ? `${base}stimuli/${s.transcript}` : undefined,
    audioUrl: s.audio ? `${base}stimuli/${s.audio}` : undefined,
    focusUrl: s.focus ? `${base}stimuli/${s.focus}` : undefined,
    timelineUrl: s.timeline ? `${base}stimuli/${s.timeline}` : undefined,
    outlineUrl: s.outline ? `${base}stimuli/${s.outline}` : undefined,
    anomaliesUrl: s.anomalies ? `${base}stimuli/${s.anomalies}` : undefined,
    triageUrl: s.triage ? `${base}stimuli/${s.triage}` : undefined,
  }
}

export interface TrialSpec {
  key: string
  block: 1 | 2 | 3 // session number: 1 = T1 (practice included), 2 = T2, 3 = T3
  trialIndex: number // 0-based within the session; practice = -1
  condition: Condition // Plain = C1, Full = C4
  task: StudyTask // stamped into the log as task_type ('t1' | 't2' | 't3')
  difficulty: string // clip tag for the log — 'practice' | 't1-matched' | 't2-episode' | 't3-notes'
  stimulusId: string
  timeBudgetSec: number
  focusTerms?: string // Full (C4) only — preset, read-only
  briefText?: string // task instructions shown before + pinned during the trial
  // Participant study only: which participant "task" this trial
  // belongs to (a task may span two recordings — the Plain-vs-Full contrast).
  // Drives the "Task N of M" banner/brief numbering; absent elsewhere.
  taskGroup?: number
  // Optional per-recording sub-label shown in the brief (e.g. 'Recording 1 of 2')
  // when a task spans two recordings.
  recordingLabel?: string
}

// ----- Counterbalance (T1) -------------------------------------------------
// Two crossed factors over the matched pair {t1a, t1b}:
//   condition order   — Plain first (CB1, CB3) vs Full first (CB2, CB4)
//   clip assignment   — t1a=Plain (CB1, CB2) vs t1a=Full (CB3, CB4)
// Each clip is Plain for 10 and Full for 10 at N=20.
const T1_PLAN: Record<CBGroup, { clips: [string, string]; conds: [Condition, Condition] }> = {
  CB1: { clips: ['t1a', 't1b'], conds: ['C1', 'C4'] }, // Plain first · t1a=Plain
  CB2: { clips: ['t1b', 't1a'], conds: ['C4', 'C1'] }, // Full first  · t1a=Plain
  CB3: { clips: ['t1b', 't1a'], conds: ['C1', 'C4'] }, // Plain first · t1a=Full
  CB4: { clips: ['t1a', 't1b'], conds: ['C4', 'C1'] }, // Full first  · t1a=Full
}

// T2 scheme C: which episode carries which interface (order is fixed t2a→t2b).
const T2_ASSIGN: Record<T2Assign, [Condition, Condition]> = {
  V1: ['C1', 'C4'], // t2a=Plain, t2b=Full
  V2: ['C4', 'C1'], // t2a=Full,  t2b=Plain
}

const PRACTICE_CLIP = 'gp'
const T3_CLIP = 't3'

// ----- Task instructions (briefs) ------------------------------------------
// Neutral wording; every trial carries one, shown on the brief screen and
// pinned at the top for the whole trial. Placeholders where the real materials
// (answer key / target) are still being curated.
const T1_BRIEF =
  'Within the time limit, find and correct the transcription errors that change the meaning — negations, names, numbers, weapons, times. Click a word to edit, delete, or pick an alternative; verify each section when done.'

const T2_BRIEF: Record<string, string> = {
  t2a: 'This is a longer recording (~30 min episode). Within the time limit, find the key clues and any contradictions between statements — you will answer a few questions afterwards. Correct transcription errors in the passages that matter as you go.',
  t2b: 'This is a longer recording (~30 min episode). Within the time limit, find the key clues and any contradictions between statements — you will answer a few questions afterwards. Correct transcription errors in the passages that matter as you go.',
}

// TODO: set the real target when the T3 clip is registered.
const T3_BRIEF =
  'The audio is a sequence of short voice messages from different senders. Within the time limit, find the message(s) related to the target information and correct any errors in them — you do not need to review the rest.'

// Preset focus terms for Full trials, keyed by stimulus id. Empty until the
// materials are frozen (T2 answer key / T3 target); Plain trials never get them.
const FULL_FOCUS: Record<string, string> = {}

// Practice runs on the Full interface (C4) with a worked focus example so every
// participant exercises highlighting + focus retrieval + edit/delete/verify/seek
// ONCE before any scored trial (removes new-interface asymmetry).
const PRACTICE_BRIEF =
  'Practice: whether the caller mentioned a blue van. Try the tools — click a highlighted word to edit or pick an alternative, use the focus list on the left to jump to relevant lines, and verify a section when done. This one is not scored.'
const PRACTICE_FOCUS = 'blue van\ncaller'

// ----- Police cohort (Wed session) -----------------------------------------
// One active evidence-collection / information-foraging task + a feedback
// questionnaire (supervisor decision, 2026-07-24; no proofreading task). It runs
// on the FULL interface (C4 toolkit + sentence tints — AppStudy overlays the
// config), untimed: timeBudgetSec is effectively infinite and the banner hides
// the countdown; officers end the task themselves. The second task remains
// registered below so it can be restored through POLICE_ACTIVE_CLIPS.
// TODO: replace the placeholder case questions when the material is final.
const POLICE_BRIEFS: Record<string, string> = {
  police1:
    'A ~27 min recording. Using the tools however you like, find the passages that answer the case question: WHO is accused of what, and WHAT evidence is mentioned against them? You do not need to read everything — collect just the evidence that matters.',
  police2:
    'A ~36 min recording. Using the tools however you like, find the passages that answer the case questions and correct the transcription errors in the passages that matter. You do not need to read everything — collect just the evidence that matters.',
}

// In-task case questions shown in the left-column QuestionsPanel and answered in
// app (answers ride the local event log as question_answer events). Four types:
//   mc    single- or multi-select (multi: true) choice
//   open  free-text answer box below the prompt
//   scale Likert rating min..max (default 1..5)
//   task  directive only — no answer field; the response is what they correct in
//         the transcript.
// FULL question banks (2026-07-21) — deliberately over-complete so the
// experimenter can trim to a final set; answers live OUTSIDE the repo.
// id scheme: p<task><type-letter><n> — t=task, a=mc, b=multi, c=open,
// d=correction-focused open, e=scale.
export type PoliceQuestion =
  | { id: string; type: 'mc'; prompt: string; options: string[]; multi?: boolean }
  | { id: string; type: 'open'; prompt: string; placeholder?: string }
  | { id: string; type: 'scale'; prompt: string; min?: number; max?: number; minLabel?: string; maxLabel?: string }
  | { id: string; type: 'task'; prompt: string }

// Choice order is deliberately fixed but balanced across positions. Keeping it
// deterministic gives every participant the same task, while avoiding the old
// "correct answer is always first" cue. Answer keys use option TEXT, not index.
const POLICE_QUESTION_BANK: Record<string, PoliceQuestion[]> = {
  police1: [
    { id: 'p1t1', type: 'task',
      prompt: 'Correct the transcription errors in the passages that matter to the case — at minimum the inspector’s list of thefts and the newspaper headline.' },
    { id: 'p1a1', type: 'mc',
      prompt: 'How did the thief get into the shops?',
      options: ['Forced the back door', 'Window jimmied open', 'Used a stolen key', 'They were left unlocked'] },
    { id: 'p1a2', type: 'mc',
      prompt: 'What did Ned, the hardware-store owner, fail to report as stolen?',
      options: ['A breakfast set worth $8.95', 'Fishing tackle', 'A baby’s cradle', 'A sewing machine worth $80'] },
    { id: 'p1a3', type: 'mc',
      prompt: 'Who identified the stolen cradle?',
      options: ['Sid Locke from the furniture store', 'Frank Hetherington', 'Sergeant Woody Heron', 'The hotel manager'] },
    { id: 'p1a4', type: 'mc',
      prompt: 'What finally gave Tom away at the moment of arrest?',
      options: ['Fingerprints at the shop', 'An informer tipped off the police', 'Three days’ growth of beard on an “old lady”', 'He was caught inside the pool room'] },
    { id: 'p1a5', type: 'mc',
      prompt: 'In what role did the two constables go undercover?',
      options: ['Travelling salesmen', 'Homesteaders looking for land', 'Ranch hands', 'Fur traders'] },
    { id: 'p1a6', type: 'mc',
      prompt: 'What address did the tailoring advert give?',
      options: ['30 Maple Street', '300 Main Street', '3397 Maple Street', '300 Maple Street'] },
    { id: 'p1a7', type: 'mc',
      prompt: 'What exactly happened with the moccasins?',
      options: ['Size 10½ stolen and never returned', 'Two pairs were stolen', 'Size 9 stolen, then returned and size 10½ taken instead', 'They were returned with an apology note'] },
    { id: 'p1a8', type: 'mc',
      prompt: 'What happened to Murdoch and Grant after they drove Tom into hiding?',
      options: ['Desk duty for the rest of the month', 'Transfer south', 'Suspension without pay', 'A written warning only'] },
    { id: 'p1a9', type: 'mc',
      prompt: 'Which town did the constables base themselves in, and why?',
      options: ['Longacre — the nearest detachment', 'Sherwin — the hub of the area', 'Peace River — the subdivision HQ', 'Carney — where the jeweller was robbed'] },
    { id: 'p1b1', type: 'mc', multi: true,
      prompt: 'Which of these were among the reported thefts? (select all that apply)',
      options: ['A string of beads', 'A rifle', 'A set of kitchen dishes', 'Cash from a till', 'A wristwatch from Carney’s', 'A baby’s cradle'] },
    { id: 'p1b2', type: 'mc', multi: true,
      prompt: 'Which statements about Tom are supported by the recording? (select all that apply)',
      options: ['He was violent when arrested', 'He steals to give presents to his friends', 'He only works as a tailor while in jail', 'He fled to British Columbia', 'The townspeople — even his victims — shielded him'] },
    { id: 'p1c1', type: 'open',
      prompt: 'Why did shopkeepers protect Tom even after he had robbed them?',
      placeholder: 'Type your answer…' },
    { id: 'p1c2', type: 'open',
      prompt: 'In 1–2 sentences: how did the undercover plan work, and what finally gave Tom away?',
      placeholder: 'Type your answer…' },
    { id: 'p1c3', type: 'open',
      prompt: 'What did the hotel manager let slip, and why did he trust the two strangers?',
      placeholder: 'Type your answer…' },
    { id: 'p1c4', type: 'open',
      prompt: 'List the two items involved at the hardware store with their values, and explain why the discrepancy mattered.',
      placeholder: 'Type your answer…' },
    { id: 'p1d1', type: 'open',
      prompt: 'One item in the inspector’s list of thefts is clearly mis-transcribed. Find it — what do you think was actually said?',
      placeholder: 'Quote the garbled text, then your correction…' },
    { id: 'p1d2', type: 'open',
      prompt: 'The local newspaper headline appears garbled in the transcript. Quote it as written, then give your corrected version.',
      placeholder: 'Quote, then correct…' },
    { id: 'p1e1', type: 'scale',
      prompt: 'How confident are you that the transcript is now accurate in the passages that matter?',
      min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Very' },
    { id: 'p1e2', type: 'scale',
      prompt: 'How useful was the highlighting for deciding where to listen back?',
      min: 1, max: 5, minLabel: 'Not useful', maxLabel: 'Very useful' },
    { id: 'p1e3', type: 'scale',
      prompt: 'If this were a real case file, how comfortable would you be relying on this reviewed transcript as evidence?',
      min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Fully' },
  ],
  // Participant Task 2 Plain — Mr District Attorney, "The Forgery-Proof Note"
  // (~27 min). Mirrors police1's structure: task + 9 mc + 2 multi + 4 open +
  // 2 correction-open (+ 3 scales, hidden by the slice). The correction items
  // target NATURAL ASR damage already in this transcript: the con man's name
  // renders as Royger / Orger / Riker / Reuger / Olga, and the check-room
  // parcel description came out as "about sold by soul by sl w".
  part2b: [
    { id: 'mdat1', type: 'task',
      prompt: 'Correct the transcription errors in the passages that matter to the case — at minimum the con man’s name (it appears in several different corrupted forms) and the description of the parcel at the check room.' },
    { id: 'mdaa1', type: 'mc',
      prompt: 'What was Jake Malmeister’s job?',
      options: ['A Treasury engraver', 'A bank teller', 'State chemist and spectrograph expert in the police laboratory', 'A print-shop owner'] },
    { id: 'mdaa2', type: 'mc',
      prompt: 'What were the engraved plates for?',
      options: ['$10 bills', '$20 bills', '$100 bills', 'German 100-mark notes'] },
    { id: 'mdaa3', type: 'mc',
      prompt: 'Where did the Chief and Miss Miller find the plates?',
      options: ['Locked in the darkroom', 'Under the copper plate on the workbench', 'In Jake’s coat pocket', 'Hidden inside a hollowed-out copy of The Life of Rembrandt'] },
    { id: 'mdaa4', type: 'mc',
      prompt: 'What was the agreed payment for the plates?',
      options: ['$5,000 up front', '$2,500 down and $2,500 on delivery', '$1,000 in small bills', '$24,000 on delivery'] },
    { id: 'mdaa5', type: 'mc',
      prompt: 'How much did the con man claim the operation could print per day?',
      options: ['$2,500', '$10,000', '$24,000', '$5,000'] },
    { id: 'mdaa6', type: 'mc',
      prompt: 'What did the con man threaten Miss Miller with to make her talk?',
      options: ['Boiling water', 'A hot iron', 'Being thrown from the window', 'A staged car accident'] },
    { id: 'mdaa7', type: 'mc',
      prompt: 'Where did the caller tell the district attorney to sit on the 3:15 train?',
      options: ['In the first car, south side', 'In the dining car', 'Anywhere, as long as he came alone', 'In the last car, north side, next to the windows'] },
    { id: 'mdaa8', type: 'mc',
      prompt: 'Where was the second plate while the DA met the con man on the train?',
      options: ['In the DA’s pocket with the first one', 'Checked at the main baggage check room in the railway station', 'Locked in the office desk', 'Hidden at Miss Miller’s flat'] },
    { id: 'mdaa9', type: 'mc',
      prompt: 'How did the DA get the con man’s fingerprints?',
      options: ['From the gun after the fight', 'From the kettle in Miss Miller’s kitchen', 'He asked for his handkerchief back after the con man had handled it', 'From the door of the hideout'] },
    { id: 'mdab1', type: 'mc', multi: true,
      prompt: 'Which of these books were on Jake’s laboratory shelf? (select all that apply)',
      options: ['The Life of Rembrandt', 'A biography of Alexander Hamilton', 'Photography by Polarized Light', 'Old Tin Engravers to 1850', 'A railway timetable', 'Forensic Chemistry and Charred Documents'] },
    { id: 'mdab2', type: 'mc', multi: true,
      prompt: 'Which statements about Jake are supported by the recording? (select all that apply)',
      options: ['He insisted he was an artist, not a crook', 'He fired the shot that ended the fight', 'He had been caught drinking on the job', 'He escaped before the arrest', 'He refused to have anything to do with killing Miss Miller', 'He designed a “forgery-proof” 100-mark note in Germany in 1915'] },
    { id: 'mdac1', type: 'open',
      prompt: 'Why did the DA hand over only ONE plate on the train — what did he call the arrangement?',
      placeholder: 'Type your answer…' },
    { id: 'mdac2', type: 'open',
      prompt: 'In 1–2 sentences: how did the DA get back from Bennington City before the con man, and how did he find the hideout?',
      placeholder: 'Type your answer…' },
    { id: 'mdac3', type: 'open',
      prompt: 'What was the con man’s plan for Jake once the plates were finished, and why?',
      placeholder: 'Type your answer…' },
    { id: 'mdac4', type: 'open',
      prompt: 'What happened to the check-room attendant and the $1,000 bribe, and why?',
      placeholder: 'Type your answer…' },
    { id: 'mdad1', type: 'open',
      prompt: 'The con man’s name appears in several different corrupted forms in the transcript. Quote two of them, then give the name you think was actually said.',
      placeholder: 'Quote the corrupted forms, then your correction…' },
    { id: 'mdad2', type: 'open',
      prompt: 'At the check room, the description of the parcel is clearly garbled. Quote it as written, then give your corrected version.',
      placeholder: 'Quote, then correct…' },
    { id: 'mdae1', type: 'scale',
      prompt: 'How confident are you that the transcript is now accurate in the passages that matter?',
      min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Very' },
    { id: 'mdae2', type: 'scale',
      prompt: 'How hard was it to decide where to listen back without any highlighting?',
      min: 1, max: 5, minLabel: 'Easy', maxLabel: 'Very hard' },
    { id: 'mdae3', type: 'scale',
      prompt: 'If this were a real case file, how comfortable would you be relying on this reviewed transcript as evidence?',
      min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Fully' },
  ],
  police2: [
    { id: 'p2t1', type: 'task',
      prompt: 'Correct the transcription errors in the passages that matter to the case — note the victim’s name is corrupted in several places.' },
    { id: 'p2a1', type: 'mc',
      prompt: 'How did Mima Wilson die?',
      options: ['She was shot', 'She was stabbed', 'She drowned', 'She fell'] },
    { id: 'p2a2', type: 'mc',
      prompt: 'Around what time was Mima killed?',
      options: ['Around 11 p.m.', 'At 9.45 p.m.', 'At 3 a.m.', 'At 1900'] },
    { id: 'p2a3', type: 'mc',
      prompt: 'What did the archaeological dig turn up that upset Mima?',
      options: ['A fragment of human skull', 'Silver coins', 'A pendant', 'A knife'] },
    { id: 'p2a4', type: 'mc',
      prompt: 'Whose initials were on the knife found by Hattie’s body?',
      options: ['PB — Paul Berglund', 'JW — Joseph Wilson', 'RH — Ronald Haldane', 'JP — Jimmy Perez'] },
    { id: 'p2a5', type: 'mc',
      prompt: 'What was the “Shetland Bus”?',
      options: ['WWII small-boat runs carrying agents, supplies and money to Norway', 'An inter-island bus route', 'A fishing fleet', 'A ferry company'] },
    { id: 'p2a6', type: 'mc',
      prompt: 'How much money was Per Lungstad carrying when he disappeared?',
      options: ['About 100,000 Norwegian kroner', '£3,000', 'Ten million', '24,000 kroner'] },
    { id: 'p2a7', type: 'mc',
      prompt: 'The pendant Mima kept for 70 years showed…?',
      options: ['Freya — the Norse goddess of love', 'A Viking ship', 'St Magnus', 'A silver coin'] },
    { id: 'p2a8', type: 'mc',
      prompt: 'Why did Joseph lie about where he was the night Mima died?',
      options: ['He was landing fish beyond his quota', 'He was with another woman', 'He had attacked Ronald', 'He was at the festival'] },
    { id: 'p2a9', type: 'mc',
      prompt: 'Who confesses to the killings?',
      options: ['Jackie Haldane', 'Ronald Haldane', 'Paul Berglund', 'Joseph Wilson'] },
    { id: 'p2b1', type: 'mc', multi: true,
      prompt: 'During the investigation, which people come under suspicion at some point? (select all that apply)',
      options: ['Joseph Wilson', 'Ronald Haldane', 'Paul Berglund', 'Jackie Haldane', 'Duncan', 'Billy'] },
    { id: 'p2b2', type: 'mc', multi: true,
      prompt: 'What made Hattie’s “suicide” look doubtful? (select all that apply)',
      options: ['A bruise on her arm', 'Another bruise on the back of her head', 'Cuts that could be defensive', 'Only Hattie’s prints on a knife many people had used', 'A suicide note', 'CCTV of an attacker'] },
    { id: 'p2b3', type: 'mc', multi: true,
      prompt: 'What did the Shetland Bus carry during the war? (select all that apply)',
      options: ['Spies and saboteurs', 'Supplies', 'Large sums of money', 'Refugees on the return trips', 'German prisoners'] },
    { id: 'p2c1', type: 'open',
      prompt: 'Why did the killer murder Mima? Explain the motive in 1–2 sentences.',
      placeholder: 'Type your answer…' },
    { id: 'p2c2', type: 'open',
      prompt: 'Why was Hattie killed?',
      placeholder: 'Type your answer…' },
    { id: 'p2c3', type: 'open',
      prompt: 'Where did the Haldane family fortune come from, according to the investigation?',
      placeholder: 'Type your answer…' },
    { id: 'p2c4', type: 'open',
      prompt: 'What made the “burglary” at Mima’s croft look staged?',
      placeholder: 'Type your answer…' },
    { id: 'p2d1', type: 'open',
      prompt: 'The victim’s name appears in several corrupted forms in the transcript. List the variants you spotted and give the correct name.',
      placeholder: 'Variants → correct name…' },
    { id: 'p2d2', type: 'open',
      prompt: 'One line says the professor has been “telling porcupines”. What was actually said?',
      placeholder: 'Type your correction…' },
    { id: 'p2d3', type: 'open',
      prompt: 'In the phone call to Gwen James, the constabulary’s name is transcribed wrongly. Quote it and correct it.',
      placeholder: 'Quote, then correct…' },
    { id: 'p2e1', type: 'scale',
      prompt: 'How confident are you that the transcript is now accurate in the passages that matter?',
      min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Very' },
    { id: 'p2e2', type: 'scale',
      prompt: 'How useful was the highlighting for deciding where to listen back?',
      min: 1, max: 5, minLabel: 'Not useful', maxLabel: 'Very useful' },
    { id: 'p2e3', type: 'scale',
      prompt: 'If this were a real case file, how comfortable would you be relying on this reviewed transcript as evidence?',
      min: 1, max: 5, minLabel: 'Not at all', maxLabel: 'Fully' },
  ],
}

// Final selection for the police session (2026-07-22): only the leading slice
// of each bank is shown/answered — task 1 stops after #18 (p1d2; the p1e
// scales are hidden), task 2 after #13 (p2b3; the p2c/p2d/p2e items are
// hidden). The full banks stay above for reference — the experimenter's
// answer key indexes the complete id scheme.
export const POLICE_QUESTIONS: Record<string, PoliceQuestion[]> = {
  police1: POLICE_QUESTION_BANK.police1.slice(0, 18),
  police2: POLICE_QUESTION_BANK.police2.slice(0, 13),
  // Guided-demo placeholders so the Questions step of the tour shows a real,
  // answerable panel. Answers are excluded from analysis (difficulty:'demo').
  demo: [
    { id: 'demoq1', type: 'mc',
      prompt: 'Practice question — questions appear here and answers save automatically. What did the witness say was taken?',
      options: ['A handbag', 'A bicycle', 'A phone', 'Nothing was taken'] },
    { id: 'demoq2', type: 'open',
      prompt: 'Practice question — open answers are typed here. Where did the witness say the man was standing?',
      placeholder: 'Type your answer…' },
  ],
  // Participant study — Task 1 (the two SHORT recordings) has NO case-questions
  // panel at all: the task is purely error-finding, explained by the brief
  // overlay ("find as many errors as you can") before the trial starts. With no
  // POLICE_QUESTIONS entry for part1a/part1b, caseQuestions is empty, so the
  // right column drops the Questions tab and shows only the Review log.
  // Participant Task 2 — Full reuses police1's set via the shared stimulusId;
  // Plain (part2b / Mr District Attorney) mirrors it: first 18 of the bank
  // (task + 9 mc + 2 multi + 6 open; the mdae scales stay hidden).
  part2b: POLICE_QUESTION_BANK.part2b.slice(0, 18),
}

// Effectively untimed (the runner has no "no limit" mode; ~11.5 days).
export const POLICE_TIME_BUDGET_SEC = 999_999

// 2026-07-24 (supervisor): one task is enough — the session runs demo + task 1
// only. police2 stays fully registered (stimulus, questions, brief); to restore
// the two-task session just add 'police2' back to this list.
const POLICE_ACTIVE_CLIPS = ['police1'] as const

export function buildPoliceSession(): TrialSpec[] {
  const tasks: TrialSpec[] = POLICE_ACTIVE_CLIPS.map((clip, i) => ({
    key: `police-${i}`,
    block: 2,
    trialIndex: i,
    condition: 'C4',
    task: 't2',
    difficulty: 'police-foraging',
    stimulusId: clip,
    timeBudgetSec: POLICE_TIME_BUDGET_SEC,
    briefText: POLICE_BRIEFS[clip],
  }))
  // Guided demo first: the spotlight tour runs on the bundled placeholder clip
  // (stimulus 'demo', practice convention trialIndex -1 / difficulty 'demo' so
  // its events are trivially excluded). No briefText → intro jumps straight
  // into the trial where DemoTour mounts.
  return [
    {
      key: 'police-demo',
      block: 2,
      trialIndex: -1,
      condition: 'C4',
      task: 't2',
      difficulty: 'demo',
      stimulusId: 'demo',
      timeBudgetSec: POLICE_TIME_BUDGET_SEC,
    },
    ...tasks,
  ]
}

// ---- Participant study (mirrors the police flow: guided demo → tasks →
// in-app questionnaire, self-run) but TIMED. 2026-07-24 design:
//   Task 1 — TWO short recordings, Plain and Full (the contrast). Error-finding
//            only: correct as many transcription errors as you can. NO questions.
//   Task 2 — TWO long recordings, Plain and Full (the contrast). Precise finding
//            against a time limit, WITH case questions.
// The former Task 3 stimulus remains registered for other flows, but is hidden
// from this participant session to keep the total study time manageable.
const PARTICIPANT_BRIEFS: Record<string, string> = {
  part1_full:
    'A short recording. You have the full set of AI tools (search, assistant, timeline, conflicts, outline, highlights). Find and correct as many transcription errors as you can before the time runs out.',
  part1_plain:
    'A short recording, plain transcript. Read it against the audio and correct as many transcription errors as you can before the time runs out.',
  part2_plain:
    'A ~27 min recording with a plain AI transcript. Answer as many case questions as you can — you are not expected to finish them all. The transcript may be wrong, including in key evidence, so find the relevant passages, listen to confirm what was actually said, and correct important transcription errors as you work.',
  part2_full:
    'A ~27 min recording with the full AI-assisted interface. Answer as many case questions as you can — you are not expected to finish them all. Use the tools to find relevant passages, but listen to confirm key evidence: the transcript may be wrong, and correcting important transcription errors is part of the task.',
}

// ----- Participant design cells (2026-08-07, supervisor) --------------------
// The first ~12 participants all ran ONE arrangement: Plain always first, and
// always the same recording carrying Plain. Design review requested that the remaining
// participants to swap that round — and, because the link had already gone out,
// to keep ONE bare link (no query string) rather than a per-participant URL.
// So there is no live randomisation: the bare link runs the cell being
// recruited, and ?g= exists only to reproduce an earlier cell for testing.
//
// Both tasks now swap the ORDER (Full first), but only Task 1 also swaps the
// clip assignment — which is why the order flag is per task rather than shared:
//   Task 1 — swaps BOTH the clip assignment and the order. It is the
//     confirmatory error-correction contrast, and its pair part1a/part1b is
//     genuinely matched (~6.5 min each, ~7% planted errors, and both JSONs carry
//     full word-level annotation), so either clip can carry either interface.
//   Task 2 — swaps the order only, keeping its original clip assignment. Its
//     pair is police1 (Tom the Tailor) and part2b (Mr District Attorney), and
//     part2b was frozen as a Plain-only clip: every word is risk='low', with no
//     per-word confidence and no word timings (only sentence paraRisk). Running
//     it as Full would show an empty highlight layer, so it cannot trade places
//     without being re-annotated at word level first.
export type PGroup = 'G1' | 'G2'
export const PARTICIPANT_GROUPS: PGroup[] = ['G1', 'G2']

interface ParticipantCell {
  t1FullFirst: boolean
  t2FullFirst: boolean
  /** Task 1 only: part1a carries Plain (and part1b Full) instead of the reverse. */
  swapT1: boolean
}

const PARTICIPANT_PLAN: Record<PGroup, ParticipantCell> = {
  // Sessions 1–12, up to 2026-08-07. Kept so the collected design stays
  // documented (and reproducible with ?g=G1), not because it is still recruited.
  //   T1: Plain part1b → Full part1a     T2: Plain part2b → Full police1
  G1: { t1FullFirst: false, t2FullFirst: false, swapT1: false },
  // The cell being recruited from 2026-08-07. Both tasks meet the Full
  // interface first (T2's order flipped 2026-08-08); only T1 also trades which
  // recording carries which interface.
  //   T1: Full part1b  → Plain part1a    T2: Full police1 → Plain part2b
  G2: { t1FullFirst: true, t2FullFirst: true, swapT1: true },
}

/** The cell the bare study link runs. Every remaining participant gets this. */
export const PARTICIPANT_DEFAULT_GROUP: PGroup = 'G2'

/** Does this task meet the Full interface before the Plain one? Drives the
 *  per-task order preview on the participant welcome screen. */
export function participantFullFirst(group: PGroup, taskGroup: 1 | 2): boolean {
  const cell = PARTICIPANT_PLAN[group]
  return taskGroup === 1 ? cell.t1FullFirst : cell.t2FullFirst
}

export function buildParticipantSession(
  times: SessionTimes = DEFAULT_TIMES,
  group: PGroup = PARTICIPANT_DEFAULT_GROUP,
): TrialSpec[] {
  const { swapT1 } = PARTICIPANT_PLAN[group]
  // Task 1 — the matched short pair; either clip can carry either interface.
  const t1Plain = swapT1 ? 'part1a' : 'part1b'
  const t1Full = swapT1 ? 'part1b' : 'part1a'
  // Task 2 — assignment fixed (see the note above): Plain = Mr District Attorney
  // (part2b); Full = the police task-1 material as-is (Tom the Tailor, with
  // questions and frozen panels).
  const t2Plain = 'part2b'
  const t2Full = 'police1'

  // One task = two recordings of the same pair, ordered by the cell's plan for
  // THAT task (Task 1 and Task 2 do not share an order).
  let idx = 0
  const pair = (
    taskGroup: 1 | 2,
    block: 1 | 2,
    task: StudyTask,
    budget: number,
    plainClip: string,
    fullClip: string,
  ): TrialSpec[] => {
    const seq: [string, Condition][] = participantFullFirst(group, taskGroup)
      ? [[fullClip, 'C4'], [plainClip, 'C1']]
      : [[plainClip, 'C1'], [fullClip, 'C4']]
    return seq.map(([stimulusId, condition], i) => {
      const role = condition === 'C1' ? 'plain' : 'full'
      return {
        key: `part-t${taskGroup}-${role}`,
        block,
        trialIndex: idx++,
        condition,
        task,
        difficulty: `part-t${taskGroup}-${role}`,
        stimulusId,
        timeBudgetSec: budget,
        taskGroup,
        recordingLabel: `Recording ${i + 1} of 2`,
        briefText: PARTICIPANT_BRIEFS[`part${taskGroup}_${role}`],
      }
    })
  }

  return [
    // Guided demo first (untimed) — same spotlight tour as the police session.
    {
      key: 'part-demo',
      block: 1,
      trialIndex: -1,
      condition: 'C4',
      task: 't1',
      difficulty: 'demo',
      stimulusId: 'demo',
      timeBudgetSec: POLICE_TIME_BUDGET_SEC,
    },
    // Task 1 — two SHORT recordings. Error-finding, no questions.
    ...pair(1, 1, 't1', times.t1, t1Plain, t1Full),
    // Task 2 — two LONG recordings. Precise finding, with case questions.
    ...pair(2, 2, 't2', times.t2, t2Plain, t2Full),
  ]
}

export interface SessionTimes {
  practice: number // T for the practice trial (s)
  t1: number // T for each T1 proofread trial (s)
  t2: number // T for each T2 long-recording trial (s) — ~6–8 min (scheme C leans 6:00)
  t3: number // T for the T3 voice-notes trial (s) — ~4–5 min
}

export const DEFAULT_TIMES: SessionTimes = { practice: 120, t1: 270, t2: 420, t3: 270 }

export interface SessionOptions {
  t2Mode?: T2Mode // 'A' (default) = Full-only single episode; 'C' = two episodes, Plain/Full
  t2Assign?: T2Assign // scheme C only — episode-condition assignment
  includePractice?: boolean
}

export function buildSession(
  group: CBGroup,
  times: SessionTimes = DEFAULT_TIMES,
  opts: SessionOptions = {},
): TrialSpec[] {
  const { t2Mode = 'A', t2Assign = 'V1', includePractice = true } = opts
  const trials: TrialSpec[] = []
  let idx = 0

  // Practice — Full (C4) + focus example, before any scored trial.
  if (includePractice) {
    trials.push({
      key: 'practice',
      block: 1,
      trialIndex: -1,
      condition: 'C4',
      task: 't1',
      difficulty: 'practice',
      stimulusId: PRACTICE_CLIP,
      timeBudgetSec: times.practice,
      focusTerms: PRACTICE_FOCUS,
      briefText: PRACTICE_BRIEF,
    })
  }

  // T1 — the matched pair, Plain vs Full per the group's plan (the only
  // confirmatory contrast).
  const t1 = T1_PLAN[group]
  t1.clips.forEach((clip, i) => {
    const condition = t1.conds[i]
    trials.push({
      key: `t1-${idx}`,
      block: 1,
      trialIndex: idx,
      condition,
      task: 't1',
      difficulty: 't1-matched',
      stimulusId: clip,
      timeBudgetSec: times.t1,
      briefText: T1_BRIEF,
      focusTerms: condition === 'C4' ? FULL_FOCUS[clip] : undefined,
    })
    idx++
  })

  // T2 — scheme A: one episode on Full; scheme C: both episodes, Plain/Full
  // per the assignment (order fixed t2a → t2b).
  const t2Clips = t2Mode === 'C' ? (['t2a', 't2b'] as const) : (['t2a'] as const)
  t2Clips.forEach((clip, i) => {
    const condition: Condition = t2Mode === 'C' ? T2_ASSIGN[t2Assign][i] : 'C4'
    trials.push({
      key: `t2-${idx}`,
      block: 2,
      trialIndex: idx,
      condition,
      task: 't2',
      difficulty: 't2-episode',
      stimulusId: clip,
      timeBudgetSec: times.t2,
      briefText: T2_BRIEF[clip],
      focusTerms: condition === 'C4' ? FULL_FOCUS[clip] : undefined,
    })
    idx++
  })

  // T3 — voice-note triage, Full-only capability probe.
  trials.push({
    key: `t3-${idx}`,
    block: 3,
    trialIndex: idx,
    condition: 'C4',
    task: 't3',
    difficulty: 't3-notes',
    stimulusId: T3_CLIP,
    timeBudgetSec: times.t3,
    briefText: T3_BRIEF,
    focusTerms: FULL_FOCUS[T3_CLIP],
  })

  return trials
}
