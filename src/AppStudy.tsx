import { useEffect, useMemo, useRef, useState } from 'react'
import ReviewWorkspace, { type ReviewWorkspaceHandle } from './core/ReviewWorkspace'
import { STUDY_CONFIG } from './core/config'
import { CONDITION_CONFIG } from './core/conditions'
import { useEventLog } from './state/useEventLog'
import { exportEventLogAsCSV, exportEventLogAsJSON } from './utils/exportEventLog'
import { newStudySessionId, studyUploadEnabled, uploadStudySnapshot } from './lib/studyUpload'
import {
  buildParticipantSession,
  buildPoliceSession,
  buildSession,
  participantFullFirst,
  resolveStimulus,
  DEFAULT_TIMES,
  PARTICIPANT_DEFAULT_GROUP,
  PARTICIPANT_GROUPS,
  type CBGroup,
  type PGroup,
  type StudyTask,
  type T2Assign,
  type T2Mode,
  type TrialSpec,
} from './study/trials'
import { useTrialRunner } from './study/useTrialRunner'
import { useTheme, type Theme } from './hooks/useTheme'
import EndQuestionnaire, { type SurveyAnswers } from './components/EndQuestionnaire'
import {
  PARTICIPANT_QUESTIONNAIRE,
  PARTICIPANT_REQUIRED_IDS,
} from './study/participantQuestionnaire'

const CB_GROUPS: CBGroup[] = ['CB1', 'CB2', 'CB3', 'CB4']

// The Tip shown on a Full (C4) participant brief, per task. The two tasks reward
// different tools, so they get different advice: Task 1 is error correction, where
// the word/sentence highlighting is the shortcut; Task 2 is finding evidence for
// case questions across ~27 minutes, where the Assistant plus its citations is far
// faster than reading.
const PARTICIPANT_TIP: Record<1 | 2, string> = {
  1: 'Start with the highlighted words and sentences: they are more likely to contain transcription errors. Listening back to those passages first can save time, but always check the audio before making a correction.',
  2: 'Lean on the Assistant. Ask a case question in plain English and its answer comes back with blue citation chips — click one to jump straight to that passage in the transcript. Then play the audio there to confirm what was actually said before you answer the question or correct the text.',
}

// Keep the police entry summary in sync with the active session definition.
// The guided demo is not one of the officer's evidence-finding tasks.
const POLICE_TASK_COUNT = buildPoliceSession().filter((t) => t.difficulty !== 'demo').length
const POLICE_SESSION_SUMMARY = `${
  POLICE_TASK_COUNT === 1 ? 'One evidence-finding task' : `${POLICE_TASK_COUNT} evidence-finding tasks`
} + a short questionnaire`

// Police cohort (Wed session, MSt in Policing): the study URL opens on a
// two-button chooser — Police experiment vs Regular study. Flip to false after
// the police session to hide the entry and go straight to the regular setup.
const SHOW_POLICE_ENTRY = true
// The police feedback questionnaire is now IN-APP — see EndQuestionnaire on the
// Done screen (src/study/questionnaire.ts holds the content). No external form.

// Plain = C1, Full = C4 (the only two conditions the study uses).
const assistanceLabel = (c: string) => (c === 'C1' ? 'Plain' : 'Full')

// Participant design cell. One bare link for everyone (supervisor, 2026-08-07):
// it always runs PARTICIPANT_DEFAULT_GROUP, so nothing depends on the URL
// carrying a query string. ?g=G1 only exists to reproduce the earlier cell when
// testing. See PARTICIPANT_PLAN in study/trials.ts for what each cell runs.
function readGroupFromUrl(): PGroup | null {
  if (typeof window === 'undefined') return null
  const q = new URLSearchParams(window.location.search)
  const raw = (q.get('g') ?? q.get('group') ?? '').trim().toUpperCase()
  return (PARTICIPANT_GROUPS as string[]).includes(raw) ? (raw as PGroup) : null
}

// Section labels for the banner / preview (three-session design T1→T2→T3).
const TASK_LABEL: Record<StudyTask, string> = {
  t1: 'T1 · Proofread',
  t2: 'T2 · Long recording',
  t3: 'T3 · Voice notes',
}

function fmtClock(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`
}

// Full-screen overlay used for the intro / brief / break / done screens that sit
// on top of the (always-mounted) workspace so the event log + audio survive trials.
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-30 bg-surface-muted/95 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-surface border border-border rounded-lg shadow-lg p-6">
        {children}
      </div>
    </div>
  )
}

// Repeated, compact condition preview used on the participant welcome screen.
// Both participant tasks run the same order, but WHICH order is counterbalanced
// per participant (fullFirst), so this must follow the assigned cell rather than
// state a fixed Plain → Full.
function ModeSequence({ fullFirst }: { fullFirst: boolean }) {
  const plain = (
    <span
      key="plain"
      className="rounded border border-border-strong bg-surface px-1.5 py-0.5 font-medium text-ink-muted"
    >
      Plain
    </span>
  )
  const full = (
    <span key="full" className="rounded bg-brand px-1.5 py-0.5 font-medium text-white">
      Full + AI tools
    </span>
  )
  return (
    <div className="mt-1.5 flex items-center gap-1.5 text-[10px]">
      {fullFirst ? full : plain}
      <span className="text-ink-faint" aria-hidden="true">→</span>
      {fullFirst ? plain : full}
    </div>
  )
}

export default function AppStudy() {
  const events = useEventLog()
  const workspaceRef = useRef<ReviewWorkspaceHandle>(null)
  const runner = useTrialRunner()
  const [participant, setParticipant] = useState('P01')
  // null = the chooser screen. 'police' + 'participant' are the self-run in-app
  // flows (guided demo → tasks → in-app questionnaire); 'regular' is the legacy
  // experimenter-run T1–T3 session with the setup screen.
  const [cohort, setCohort] = useState<'police' | 'participant' | 'regular' | null>(
    SHOW_POLICE_ENTRY ? null : 'regular',
  )
  const isPolice = cohort === 'police'
  const isParticipant = cohort === 'participant'
  // Shared "in-app, self-run" behaviours (auto-start, guided demo, red End task,
  // skip the terminal break, in-app questionnaire, no experimenter downloads).
  // Police is untimed; the participant study keeps per-task time limits.
  const inApp = isPolice || isParticipant
  const [cbGroup, setCbGroup] = useState<CBGroup>('CB1')
  // Participant counterbalance cell for THIS session (fixed once the session
  // starts). Also encoded into the participant code, so every export and the
  // trial banner carry it without a schema change.
  const [pGroup, setPGroup] = useState<PGroup>(PARTICIPANT_DEFAULT_GROUP)
  // The pinned task brief lives INSIDE the trial banner as one truncated line;
  // clicking it expands the full text. Collapses again on every new trial.
  const [briefExpanded, setBriefExpanded] = useState(false)
  useEffect(() => setBriefExpanded(false), [runner.index])
  const [t2Mode, setT2Mode] = useState<T2Mode>('A')
  const [t2Assign, setT2Assign] = useState<T2Assign>('V1')
  const [t1Time, setT1Time] = useState(DEFAULT_TIMES.t1)
  const [t2Time, setT2Time] = useState(DEFAULT_TIMES.t2)
  const [t3Time, setT3Time] = useState(DEFAULT_TIMES.t3)
  // Study locks the theme: the experimenter picks it here; participants can't
  // switch mid-session (TopBar toggle hidden via STUDY_CONFIG.allowThemeToggle).
  const { theme, setTheme } = useTheme()

  // ---- Local result handling -------------------------------------------------
  // The public artifact keeps its event log in the browser and exposes manual
  // JSON/CSV exports. The snapshot interface remains as a local-only no-op so
  // the study runner and historical UI structure stay reproducible.
  const sessionIdRef = useRef('')
  const lastSnapKeyRef = useRef('')
  const [uploadState, setUploadState] = useState<'idle' | 'uploading' | 'ok' | 'error'>('idle')

  // Full design cell for the log: CB group + T2 scheme (+ assignment under C).
  // The self-run cohorts carry a fixed tag instead — analysis filters on it.
  const groupTag = isPolice
    ? 'POLICE'
    : isParticipant
      ? 'PARTICIPANT'
      : `${cbGroup}·${t2Mode}${t2Mode === 'C' ? `-${t2Assign}` : ''}`

  const uploadSnapshot = (complete: boolean, attempts = 1) => {
    const evs = events.getEvents()
    // The police guided demo (difficulty 'demo') is not a real trial — keep it
    // out of the completed-tasks count used by analysis.
    const realTrials = runner.trials.filter((t) => t.difficulty !== 'demo')
    const realDone = runner.trials
      .slice(0, runner.index + 1)
      .filter((t) => t.difficulty !== 'demo').length
    return uploadStudySnapshot(
      {
        session_id: sessionIdRef.current,
        participant_id: participant,
        cb_group: groupTag,
        trials_completed: complete ? realTrials.length : realDone,
        complete,
        n_events: evs.length,
        events: evs,
      },
      { attempts },
    )
  }

  const runFinalUpload = () => {
    setUploadState('uploading')
    uploadSnapshot(true, 3)
      .then(() => setUploadState('ok'))
      .catch(() => setUploadState('error'))
  }

  // In-app feedback questionnaire (police). Answers are logged as
  // question_answer events (stimulus_id='questionnaire'), then a fresh
  // final local snapshot records questionnaire completion.
  const [questionnaireDone, setQuestionnaireDone] = useState(false)
  // Completing the guided steps no longer exits the demo. Participants first
  // get an unrestricted practice period, then explicitly start task 1 from the
  // banner when they feel ready.
  const [demoTourCompleted, setDemoTourCompleted] = useState(false)
  // "Reopen the review screen" during the questionnaire: the questionnaire is
  // HIDDEN (not unmounted — answers survive) and the workspace unlocks so the
  // officer can try the tools again while thinking about an answer.
  const [qPeek, setQPeek] = useState(false)
  // The workspace keeps showing the last real task through the done phase, so
  // edits/verifications are still on screen when the officer peeks back.
  const lastRealTrialRef = useRef<TrialSpec | null>(null)
  useEffect(() => {
    if (runner.current && runner.current.difficulty !== 'demo')
      lastRealTrialRef.current = runner.current
  }, [runner.current])
  const handleQuestionnaireSubmit = (answers: SurveyAnswers) => {
    for (const [id, value] of Object.entries(answers)) {
      events.log('question_answer', {
        question_id: id,
        question_type: 'survey',
        question_value: Array.isArray(value) ? value.join(' | ') : String(value),
        stimulus_id: 'questionnaire',
      })
    }
    setQuestionnaireDone(true)
    setQPeek(false)
    lastSnapKeyRef.current = '' // allow this post-questionnaire snapshot through
    runFinalUpload()
  }

  // Demo skipped, or free exploration finished: jump straight into task 1. The two
  // runner calls batch into one render, so the demo's break screen never shows.
  // One-shot per session: a double-click on the banner action
  // must not advance the runner twice — that would skip task 1 entirely.
  const demoFinishedRef = useRef(false)
  const handleDemoFinish = () => {
    if (demoFinishedRef.current) return
    demoFinishedRef.current = true
    runner.endTrial()
    runner.continueNext()
  }

  // In-app "End task": never show the terminal "Task complete" break — endTrial
  // + continueNext batch into one render, so 'break' never paints and we land on
  // the next task's brief (or, after the last task, on 'done' → the feedback
  // questionnaire). Because skipping 'break' also skips its per-trial snapshot
  // upload, fire a best-effort snapshot here first so a mid-session abandon (the
  // participant study has multiple tasks) still leaves completed work on the server.
  const handleInAppEndTask = () => {
    // Materialise the visible transcript before getEvents() builds the upload
    // payload. This remains synchronous even though the network request is not.
    workspaceRef.current?.captureTaskResult()
    if (studyUploadEnabled && sessionIdRef.current && runner.next) {
      void uploadSnapshot(false).catch(() => {})
    }
    runner.endTrial()
    runner.continueNext()
  }

  useEffect(() => {
    if (!studyUploadEnabled || !sessionIdRef.current) return
    if (runner.phase === 'break') {
      // Fire-and-forget per-trial snapshot; a failure here is quietly absorbed
      // (the final complete=true upload carries everything anyway).
      const key = `break:${sessionIdRef.current}:${runner.index}`
      if (lastSnapKeyRef.current === key) return
      lastSnapKeyRef.current = key
      void uploadSnapshot(false).catch((err) =>
        console.warn('study snapshot upload failed (final upload will retry):', err),
      )
    } else if (runner.phase === 'done') {
      const key = `done:${sessionIdRef.current}`
      if (lastSnapKeyRef.current === key) return
      lastSnapKeyRef.current = key
      runFinalUpload()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runner.phase, runner.index])

  const times = { practice: DEFAULT_TIMES.practice, t1: t1Time, t2: t2Time, t3: t3Time }
  const sessionOpts = { t2Mode, t2Assign }

  // During the brief screen the workspace must NOT switch to the new trial yet:
  // trial_start + the per-trial clock + the countdown should all begin together
  // when the participant clicks "Begin review". On the police done screen the
  // workspace keeps the finished task loaded (instead of resetting to the
  // bundled default) so "Reopen the review screen" shows their work intact.
  const workspaceTrial =
    runner.phase === 'brief'
      ? null
      : inApp && runner.phase === 'done'
        ? lastRealTrialRef.current
        : runner.current

  // Per-trial workspace config — 2026-07-19 decision: the study runs the LIVE
  // AI toolkit (no freezing; participants search with their own words, so
  // outputs can't be pre-baked). Full (C4) trials get free-input Find +
  // Assistant + Outline + Conflicts + Timeline against the live backend
  // (VITE_API_BASE); Plain (C1) trials stay bare so the contrast is purely
  // the interface. Base flags stay off in STUDY_CONFIG.
  const workspaceConfig = useMemo(() => {
    if (!workspaceTrial || !CONDITION_CONFIG[workspaceTrial.condition].toolkit) {
      // hideBrandBanner: the study's own trial banner carries the context +
      // Help, so the workspace's brand row would be a third strip of chrome.
      // The police display defaults must ALSO live on this base path: the
      // workspace mounts during intro/brief (no trial yet), and useState
      // initials are captured at mount — set only in the trial overlay they
      // would never apply.
      return {
        ...STUDY_CONFIG,
        hideBrandBanner: true,
        // (defaultReviewCollapsed intentionally NOT set: the in-app case
        // questions live on the right column's first tab, so it must start
        // expanded — Review sits behind the second tab.)
        ...(inApp ? { defaultHighlightLevel: 'high' as const } : {}),
        ...(isParticipant ? { showPlaybackSpeed: false } : {}),
        // Plain participant trials keep collecting edits + behavioural events,
        // but do not expose the Review/audit UI. Questions, when present, stay.
        ...(isParticipant && workspaceTrial?.condition === 'C1'
          ? { hideAuditUi: true }
          : {}),
      }
    }
    return {
      ...STUDY_CONFIG,
      hideBrandBanner: true,
      allowFocusFreeInput: true,
      allowOutline: true,
      allowChat: true,
      anomalyDetection: true,
      timelineView: true,
      // In-app cohorts (police + participant) additionally see the sentence-
      // confidence tint — their stimuli are real pipeline output whose per-
      // sentence confidence is meaningful — plus the FULL header controls (let
      // people play with every view): WORDS dimension switcher, SENTENCES signal
      // switcher, Highlights level and the Editing-mode toggle. The LEGACY
      // regular study keeps these locked (part of its condition manipulation).
      ...(inApp
        ? {
            sentenceUncertainty: true,
            allowFreeDimension: true,
            allowSentenceSignalToggle: true,
            allowHighlightLevelToggle: true,
            allowEditModeToggle: true,
            // Calmer default: MED word marks hidden (View → Highlights brings
            // them back). The right column stays expanded: its first tab IS the
            // case questions.
            defaultHighlightLevel: 'high' as const,
          }
        : {}),
      ...(isParticipant ? { showPlaybackSpeed: false } : {}),
      // Participant Task 2 is a ~27 min recording answered against case
      // questions — the tools are the point, so its Full trial opens with the
      // left column already expanded on Assistant rather than collapsed to the
      // rail. Task 1 keeps the collapsed default: it is the confirmatory
      // error-correction contrast and its interface should stay as the earlier
      // sessions had it.
      ...(isParticipant && workspaceTrial.taskGroup === 2
        ? { defaultLeftTab: 'chat' as const }
        : {}),
      // Participant Task 1 opens on the WORDS · Uncertainty view. Its Full clip
      // (part1b) has had its uncertainty layer retuned to mark the planted
      // errors and nothing else (scripts/retune_task1_uncertainty.py), so that
      // view is the one that actually helps on an error-correction task —
      // Combined adds ~40 marks on correct-but-important words. Task 2 stays on
      // Combined: police1's uncertainty is real ASR confidence, not curated.
      // …and shows the amber marks too. In Uncertainty on the retuned clip the
      // amber words are exactly the ordinary-tier errors, so 'high' would hide
      // 19 of the 66 findable errors for no benefit.
      ...(isParticipant && workspaceTrial.taskGroup === 1
        ? { defaultWordDimension: 'uncertainty' as const, defaultHighlightLevel: 'all' as const }
        : {}),
    }
  }, [workspaceTrial, inApp, isParticipant])

  // ---------------- Cohort chooser (before any setup) ----------------
  if (runner.phase === 'setup' && cohort === null) {
    return (
      <div className="h-full bg-surface-muted flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-surface border border-border rounded-lg shadow-sm p-6">
          <h1 className="text-sm font-semibold text-ink uppercase tracking-[0.15em] mb-1">
            Transcript review study
          </h1>
          <p className="text-[11px] text-ink-faint mb-5">Choose your session type.</p>
          <button
            onClick={() => {
              // No setup screen for officers — auto-assign a unique participant
              // code and start the session straight away (theme stays default
              // light). The code is time-based so two officers never collide.
              setCohort('police')
              setParticipant(`OFF-${Date.now().toString(36).slice(-5).toUpperCase()}`)
              sessionIdRef.current = newStudySessionId()
              setUploadState('idle')
              setQuestionnaireDone(false)
              setQPeek(false)
              setDemoTourCompleted(false)
              demoFinishedRef.current = false
              lastRealTrialRef.current = null
              runner.startSession(buildPoliceSession())
            }}
            className="w-full text-sm font-medium px-3 py-3 rounded bg-brand text-white hover:opacity-90 transition-opacity mb-2"
          >
            Police experiment
            <span className="block text-[11px] font-normal text-white/70 mt-0.5">
              {POLICE_SESSION_SUMMARY}
            </span>
          </button>
          <button
            onClick={() => {
              // Regular (participant) study — self-run like the police flow
              // (guided demo → 2 timed tasks → in-app questionnaire). Auto-assign
              // a code and start immediately; no experimenter setup screen.
              // The counterbalance cell comes from ?g= on the link (the cell
              // being recruited when absent) and rides along in the participant
              // code, e.g. P-G3-4K2QX.
              const g = readGroupFromUrl() ?? PARTICIPANT_DEFAULT_GROUP
              setPGroup(g)
              setCohort('participant')
              setParticipant(`P-${g}-${Date.now().toString(36).slice(-5).toUpperCase()}`)
              sessionIdRef.current = newStudySessionId()
              setUploadState('idle')
              setQuestionnaireDone(false)
              setQPeek(false)
              setDemoTourCompleted(false)
              demoFinishedRef.current = false
              lastRealTrialRef.current = null
              runner.startSession(buildParticipantSession(times, g))
            }}
            className="w-full text-sm font-medium px-3 py-3 rounded border border-border text-ink hover:border-border-strong transition-colors"
          >
            Regular study
            <span className="block text-[11px] font-normal text-ink-faint mt-0.5">
              Guided demo + two tasks + a short questionnaire
            </span>
          </button>
          {/* Experimenter check: confirm the link carried the intended
              counterbalance cell before handing the device/link over. Meaningless
              to the participant, so it can stay on screen. */}
          <p className="mt-3 text-center text-[10px] font-mono text-ink-faint">
            {readGroupFromUrl()
              ? `Counterbalance ${readGroupFromUrl()} (from link)`
              : `Counterbalance ${PARTICIPANT_DEFAULT_GROUP} (default)`}
          </p>
          {/* The legacy experimenter-run T1–T3 session is retained in the code
              (cohort 'regular' + buildSession) but hidden from the chooser. To
              bring it back, restore a button here that sets cohort 'regular'. */}
        </div>
      </div>
    )
  }

  // (No police setup screen — the chooser's "Police experiment" button assigns
  // a participant code and starts the session directly.)

  // ---------------- Setup (regular study) ----------------
  if (runner.phase === 'setup') {
    const preview = buildSession(cbGroup, times, sessionOpts).filter(
      (t) => t.difficulty !== 'practice',
    )
    return (
      <div className="h-full bg-surface-muted flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-surface border border-border rounded-lg shadow-sm p-6">
          <h1 className="text-sm font-semibold text-ink uppercase tracking-[0.15em] mb-1">
            Study session setup
          </h1>
          <p className="text-[11px] text-ink-faint mb-5">
            Experimenter only. Three sections, fixed order T1→T2→T3: T1 proofread (Plain vs
            Full — the confirmatory contrast), T2 long-recording review, T3 voice-note triage.
            Pick the counterbalance group, T2 scheme and the per-section review time.
          </p>

          <label className="block mb-3">
            <span className="text-[10px] text-ink-faint uppercase tracking-widest">Participant</span>
            <input
              value={participant}
              onChange={(e) => setParticipant(e.target.value)}
              className="mt-1 w-full font-mono text-sm border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-border-strong"
            />
          </label>

          <label className="block mb-3">
            <span className="text-[10px] text-ink-faint uppercase tracking-widest">Counterbalance group</span>
            <select
              value={cbGroup}
              onChange={(e) => setCbGroup(e.target.value as CBGroup)}
              className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-surface focus:outline-none focus:ring-1 focus:ring-border-strong"
            >
              {CB_GROUPS.map((g) => (
                <option key={g} value={g}>{g}</option>
              ))}
            </select>
          </label>

          {/* T2 scheme — A until the second episode passes the probes, then C. */}
          <div className={`grid gap-3 mb-3 ${t2Mode === 'C' ? 'grid-cols-2' : 'grid-cols-1'}`}>
            <label className="block">
              <span className="text-[10px] text-ink-faint uppercase tracking-widest">T2 scheme</span>
              <select
                value={t2Mode}
                onChange={(e) => setT2Mode(e.target.value as T2Mode)}
                className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-surface focus:outline-none focus:ring-1 focus:ring-border-strong"
              >
                <option value="A">A — one episode, Full only</option>
                <option value="C">C — two episodes, Plain/Full</option>
              </select>
            </label>
            {t2Mode === 'C' && (
              <label className="block">
                <span className="text-[10px] text-ink-faint uppercase tracking-widest">T2 assignment</span>
                <select
                  value={t2Assign}
                  onChange={(e) => setT2Assign(e.target.value as T2Assign)}
                  className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-surface focus:outline-none focus:ring-1 focus:ring-border-strong"
                >
                  <option value="V1">V1 — ep1 Plain · ep2 Full</option>
                  <option value="V2">V2 — ep1 Full · ep2 Plain</option>
                </select>
              </label>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3 mb-3">
            <label className="block">
              <span className="text-[10px] text-ink-faint uppercase tracking-widest">T1 T (s)</span>
              <input
                type="number"
                min={10}
                value={t1Time}
                onChange={(e) => setT1Time(Math.max(10, Number(e.target.value) || 0))}
                className="mt-1 w-full font-mono text-sm border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-border-strong"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-ink-faint uppercase tracking-widest">T2 T (s)</span>
              <input
                type="number"
                min={10}
                value={t2Time}
                onChange={(e) => setT2Time(Math.max(10, Number(e.target.value) || 0))}
                className="mt-1 w-full font-mono text-sm border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-border-strong"
              />
            </label>
            <label className="block">
              <span className="text-[10px] text-ink-faint uppercase tracking-widest">T3 T (s)</span>
              <input
                type="number"
                min={10}
                value={t3Time}
                onChange={(e) => setT3Time(Math.max(10, Number(e.target.value) || 0))}
                className="mt-1 w-full font-mono text-sm border border-border rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-border-strong"
              />
            </label>
          </div>

          <label className="block mb-4">
            <span className="text-[10px] text-ink-faint uppercase tracking-widest">Appearance (locked for the session)</span>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as Theme)}
              className="mt-1 w-full text-sm border border-border rounded px-2 py-1.5 bg-surface focus:outline-none focus:ring-1 focus:ring-border-strong"
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>

          {/* Counterbalance preview — verify the clip→interface assignment before starting. */}
          <div className="mb-5 rounded border border-border bg-surface-subtle px-3 py-2.5">
            <p className="text-[10px] text-ink-faint uppercase tracking-widest mb-1.5">
              {groupTag} · trial order
            </p>
            <div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[11px] font-mono text-ink-muted">
              {preview.map((t) => (
                <div key={t.key} className="flex justify-between">
                  <span>{t.task.toUpperCase()} · {t.stimulusId}</span>
                  <span className={t.condition === 'C1' ? 'text-ink-faint' : 'text-brand'}>
                    {assistanceLabel(t.condition)}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => {
              sessionIdRef.current = newStudySessionId()
              setUploadState('idle')
              runner.startSession(buildSession(cbGroup, times, sessionOpts))
            }}
            className="w-full text-sm font-medium px-3 py-2 rounded bg-brand text-white hover:opacity-90 transition-opacity"
          >
            Start session
          </button>
          <p className="mt-3 text-[10px] text-ink-faint leading-snug">
            {preview.length + 1} trials total (1 practice + T1 ×2 + T2 ×{t2Mode === 'C' ? 2 : 1} +
            T3 ×1). Stimuli are placeholders until curated clips are registered in{' '}
            <code>STIMULI</code>.
          </p>
        </div>
      </div>
    )
  }

  const t = runner.current
  // (workspaceTrial — the trial the workspace actually shows, withheld during
  // the brief screen — is computed above the setup early-return, next to the
  // per-trial workspaceConfig.)
  const trialCtx = workspaceTrial
    ? {
        key: workspaceTrial.key,
        block: workspaceTrial.block,
        trialIndex: workspaceTrial.trialIndex,
        condition: workspaceTrial.condition,
        task: workspaceTrial.task,
        difficulty: workspaceTrial.difficulty,
        stimulusId: workspaceTrial.stimulusId,
        timeBudgetMs: workspaceTrial.timeBudgetSec * 1000,
        focusTerms: workspaceTrial.focusTerms,
        // Frozen clip files for this trial (empty for unregistered placeholder
        // ids → ReviewWorkspace falls back to the bundled default transcript).
        ...resolveStimulus(workspaceTrial.stimulusId),
      }
    : undefined

  const totalTrials = runner.trials.length
  const phaseLabel = t
    ? t.difficulty === 'practice'
      ? 'Practice'
      : TASK_LABEL[t.task]
    : ''
  // In-app numbering skips the guided demo. When trials carry a taskGroup (the
  // participant study — a "task" can span two recordings), number by DISTINCT
  // group so both recordings of Task 1 read "Task 1 of M"; otherwise number by
  // non-demo trial (police reads "Task 1"). A single active task reads "Task 1".
  const isDemoTrial = t?.difficulty === 'demo'
  const realTrials = runner.trials.filter((x) => x.difficulty !== 'demo')
  const usesTaskGroups = realTrials.some((x) => x.taskGroup != null)
  const realTotal = usesTaskGroups
    ? new Set(realTrials.map((x) => x.taskGroup)).size
    : realTrials.length
  const taskNo = usesTaskGroups
    ? t?.taskGroup ?? 0
    : runner.trials.slice(0, runner.index + 1).filter((x) => x.difficulty !== 'demo').length
  // Countdown shows for the timed flows (participant + legacy regular) on real
  // tasks; the police flow is untimed and the guided demo is never timed.
  const countdownShown = !isPolice && !isDemoTrial
  return (
    <div className="relative h-full flex flex-col">
      {/* Trial banner — ONE row: participant/task · pinned brief (truncated,
          click to expand) · clock (regular) · Help · End. The brief stays
          pinned per the brief-screen promise, just without its own strip; the
          workspace's brand row is hidden too (hideBrandBanner). */}
      {runner.phase === 'trial' && t && (
        <div
          className={`shrink-0 text-[11px] text-white ${
            runner.locked ? 'bg-risk-high' : 'bg-brand'
          }`}
          data-tour="banner"
        >
          <div className="flex items-center gap-3 px-4 py-1.5">
            <span className="font-mono shrink-0">{participant}</span>
            <span className="text-white/40 shrink-0">·</span>
            {inApp ? (
              // Self-run cohorts: plain task numbering, no experiment jargon.
              <span className="shrink-0">
                {isDemoTrial
                  ? demoTourCompleted
                    ? 'Demo · free exploration'
                    : 'Demo · guided tour'
                  : `${realTotal === 1 ? 'Task 1' : `Task ${taskNo} of ${realTotal}`}${
                      t.recordingLabel ? ` · ${t.recordingLabel}` : ''
                    }`}
              </span>
            ) : (
              <>
                <span className="shrink-0">{phaseLabel} · trial {runner.index + 1}/{totalTrials}</span>
                <span className="text-white/40 shrink-0">·</span>
                <span className="font-mono shrink-0" title={`${assistanceLabel(t.condition)} — ${CONDITION_CONFIG[t.condition].label}`}>
                  {t.condition}
                </span>
              </>
            )}
            {t.briefText && (
              <button
                onClick={() => {
                  events.log('filter_change', { filter: briefExpanded ? 'brief:collapsed' : 'brief:expanded' })
                  setBriefExpanded((v) => !v)
                }}
                title={briefExpanded ? 'Collapse the task brief' : t.briefText}
                className="flex-1 min-w-0 text-left truncate text-white/80 hover:text-white transition-colors"
              >
                <span className="text-[9px] uppercase tracking-widest text-white/50 mr-1.5">Task</span>
                {t.briefText}
              </button>
            )}
            {countdownShown && (
              <span className={`shrink-0 font-mono tabular-nums text-sm${t.briefText ? '' : ' ml-auto'}`}>
                {runner.locked ? "Time's up" : fmtClock(runner.timeRemainingMs)}
              </span>
            )}
            <a
              href="/guide.html"
              target="_blank"
              rel="noopener noreferrer"
              title="Help — open the reviewer guide"
              className={`shrink-0 text-white/75 hover:text-white transition-colors${
                t.briefText || countdownShown ? '' : ' ml-auto'
              }`}
            >
              Help
            </a>
            <button
              onClick={
                isDemoTrial ? handleDemoFinish : inApp ? handleInAppEndTask : runner.endTrial
              }
              className={`shrink-0 px-2.5 py-0.5 rounded transition-colors ${
                inApp && (!isDemoTrial || demoTourCompleted)
                  ? // Prominent red so participants can spot how to finish and move on.
                    'bg-risk-high text-white font-semibold shadow-sm hover:opacity-90'
                  : 'bg-white/15 hover:bg-white/25'
              }`}
            >
              {isDemoTrial
                ? demoTourCompleted
                  ? 'Start task 1'
                  : 'Skip demo'
                : runner.locked
                  ? 'Continue →'
                  : inApp
                    ? 'End task'
                    : 'End trial'}
            </button>
          </div>
          {briefExpanded && t.briefText && (
            <p className="px-4 pb-1.5 leading-snug text-white/85">{t.briefText}</p>
          )}
        </div>
      )}

      <div className="flex-1 min-h-0">
        <ReviewWorkspace
          ref={workspaceRef}
          config={workspaceConfig}
          events={events}
          trial={trialCtx}
          interactionLocked={(runner.phase !== 'trial' && !qPeek) || runner.locked}
          participantOverride={participant}
          onDemoFinish={inApp ? handleDemoFinish : undefined}
          onDemoTourComplete={inApp ? () => setDemoTourCompleted(true) : undefined}
          demoTourCompleted={demoTourCompleted}
        />
      </div>

      {/* ---------------- Intro ---------------- */}
      {runner.phase === 'intro' && (
        <Overlay>
          <h1 className="text-sm font-semibold text-ink uppercase tracking-[0.15em] mb-2">Welcome</h1>
          {isPolice ? (
            <p className="text-[13px] text-ink-muted leading-relaxed mb-4">
              You'll review an AI-transcribed recording. Its case questions tell you what
              evidence to look for — use the tools however you like (search, outline,
              assistant, highlights) and listen to the audio to check what matters. The
              transcript contains AI errors; that's expected. There is no time limit — press{' '}
              <strong>End task</strong> when you're done. A short feedback questionnaire follows
              at the end. We'll start with a quick <strong>guided demo</strong> of the interface
              on a separate practice recording.
            </p>
          ) : isParticipant ? (
            <div className="mb-5">
              <p className="text-[12px] text-ink-muted leading-snug mb-4">
                Here is the full study journey. You can pause on every preparation screen; a timer
                starts only when you say you are ready.
              </p>

              <div className="space-y-2">
                <div className="flex gap-3 rounded-md border border-brand/25 bg-brand-bg px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand text-[11px] font-semibold text-white">
                    1
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold text-ink">Guided demo</p>
                    <p className="text-[11px] text-ink-muted">Learn the controls on a practice recording.</p>
                  </div>
                </div>

                <div className="flex gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                    2
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-ink">Task 1 · Correct errors</p>
                      <span className="shrink-0 text-[10px] font-mono text-ink-faint">4:30 each</span>
                    </div>
                    <p className="text-[11px] text-ink-muted mt-0.5">
                      Listen and correct as many transcription errors as you can.
                    </p>
                    <ModeSequence fullFirst={participantFullFirst(pGroup, 1)} />
                  </div>
                </div>

                <div className="flex gap-3 rounded-md border border-border bg-surface-subtle px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
                    3
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-[12px] font-semibold text-ink">Task 2 · Find evidence</p>
                      <span className="shrink-0 text-[10px] font-mono text-ink-faint">7:00 each</span>
                    </div>
                    <p className="text-[11px] text-ink-muted mt-0.5">
                      Answer as many questions as you can; check key evidence against the audio and
                      correct important transcript errors.
                    </p>
                    <ModeSequence fullFirst={participantFullFirst(pGroup, 2)} />
                  </div>
                </div>

                <div className="flex gap-3 rounded-md border border-border bg-surface px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-[11px] font-semibold text-ink-muted">
                    4
                  </span>
                  <div>
                    <p className="text-[12px] font-semibold text-ink">Short questionnaire</p>
                    <p className="text-[11px] text-ink-muted">Share your confidence and task experience.</p>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[13px] text-ink-muted leading-relaxed mb-4">
              You'll work through three kinds of review against the audio, plus one practice run:
              correcting short transcripts, reviewing a longer recording for clues and
              contradictions, and searching a batch of voice messages for target information. Each
              part explains itself before it starts and has a fixed time limit. Click a word to
              edit, delete, or pick an alternative; verify each section when done.
            </p>
          )}
          <button
            onClick={runner.beginTrials}
            className="w-full text-sm font-medium px-3 py-2 rounded bg-brand text-white hover:opacity-90 transition-opacity"
          >
            {inApp
              ? runner.trials[0]?.difficulty === 'demo'
                ? isParticipant
                  ? 'Start guided demo'
                  : 'Begin demo'
                : 'Begin task 1'
              : `Begin ${runner.trials[0]?.difficulty === 'practice' ? 'practice trial' : 'first trial'}`}
          </button>
        </Overlay>
      )}

      {/* ---------------- Task instructions (before every trial) ---------------- */}
      {runner.phase === 'brief' && t && (
        <Overlay>
          <h1 className="text-sm font-semibold text-ink uppercase tracking-[0.15em] mb-2">
            {inApp
              ? `${realTotal === 1 ? 'Task 1' : `Task ${taskNo} of ${realTotal}`}${
                  t.recordingLabel ? ` · ${t.recordingLabel}` : ''
                }`
              : t.difficulty === 'practice'
                ? 'Practice'
                : TASK_LABEL[t.task]}
          </h1>
          {isParticipant && (
            <div className="rounded border border-border bg-surface-subtle px-3 py-2.5 mb-4">
              <p className="text-[10px] text-ink-faint uppercase tracking-widest mb-1">
                Coming next · {assistanceLabel(t.condition)} interface
              </p>
              <p className="text-[12px] text-ink-muted leading-snug">
                {t.condition === 'C1'
                  ? 'You will see a plain transcript without AI highlights or side tools. Use the recording and transcript directly.'
                  : 'You will see the full AI-assisted interface, including highlights and tools for locating useful passages.'}
              </p>
            </div>
          )}
          <p className="text-[13px] text-ink-muted leading-relaxed mb-4">{t.briefText}</p>
          {isParticipant && t.condition === 'C4' && (
            <div className="rounded border border-risk-med/40 bg-risk-med-bg/50 px-3 py-2.5 mb-4">
              <p className="text-[10px] font-semibold text-risk-med uppercase tracking-widest mb-1">
                Tip
              </p>
              <p className="text-[12px] font-semibold text-ink leading-snug">
                {PARTICIPANT_TIP[t.taskGroup === 2 ? 2 : 1]}
              </p>
            </div>
          )}
          <p className="text-[11px] text-ink-faint leading-snug mb-4">
            {isPolice
              ? 'The case questions stay pinned on the right while you work. There is no time limit, and you do not have to answer every question — press "End task" (top right) to move on to the feedback whenever you feel ready.'
              : isParticipant
                ? `${
                    t.taskGroup === 1
                      ? 'This task is about finding and correcting transcription errors.'
                      : 'The case questions stay pinned on the right while you work.'
                  } Your ${fmtClock(t.timeBudgetSec * 1000)} review time starts only when you begin. Take a break now if you need one; continue whenever you feel ready.`
                : `The brief stays pinned at the top while you work. Your ${fmtClock(t.timeBudgetSec * 1000)} review time starts when you begin.`}
          </p>
          <button
            onClick={runner.beginReview}
            className="w-full text-sm font-medium px-3 py-2 rounded bg-brand text-white hover:opacity-90 transition-opacity"
          >
            {isParticipant
              ? "I'm ready — begin task"
              : inApp
                ? 'Begin task'
                : t.difficulty === 'practice'
                  ? 'Begin practice'
                  : 'Begin review'}
          </button>
        </Overlay>
      )}

      {/* ---------------- Break / questionnaire ----------------
          The in-app cohorts (police + participant) never reach 'break' — their
          End task batches endTrial + continueNext, so this screen is only the
          legacy experimenter study's between-trial questionnaire step. */}
      {runner.phase === 'break' && !inApp && (
        <Overlay>
          <h1 className="text-sm font-semibold text-ink uppercase tracking-[0.15em] mb-2">
            {runner.next ? 'Trial complete' : 'Last trial complete'}
          </h1>
          <div className="rounded border border-dashed border-border bg-surface-subtle px-3 py-2.5 mb-4">
            <p className="text-[11px] text-ink-faint uppercase tracking-widest mb-1">Questionnaire</p>
            <p className="text-[12px] text-ink-muted leading-snug">
              Complete the short rating form for the interface you just used (external link), then
              continue.
            </p>
          </div>
          <button
            onClick={runner.continueNext}
            className="w-full text-sm font-medium px-3 py-2 rounded bg-brand text-white hover:opacity-90 transition-opacity"
          >
            {runner.next ? 'Continue to next trial' : 'Finish session'}
          </button>
        </Overlay>
      )}

      {/* ---------------- Done ---------------- */}
      {/* In-app cohorts: the feedback questionnaire fills the screen until
          submitted. While "peeking" it is hidden, NOT unmounted — the answers
          must survive the trip back to the review screen. Police and participant
          use their own question sets. */}
      {runner.phase === 'done' && inApp && !questionnaireDone && (
        <div className={qPeek ? 'hidden' : 'contents'}>
          <EndQuestionnaire
            onSubmit={handleQuestionnaireSubmit}
            submitting={uploadState === 'uploading'}
            items={isParticipant ? PARTICIPANT_QUESTIONNAIRE : undefined}
            requiredIds={isParticipant ? PARTICIPANT_REQUIRED_IDS : undefined}
            onPeek={() => {
              events.log('filter_change', { filter: 'questionnaire:reopen_review' })
              setQPeek(true)
            }}
          />
        </div>
      )}
      {/* Floating way back from the reopened review screen to the questionnaire. */}
      {runner.phase === 'done' && inApp && !questionnaireDone && qPeek && (
        <button
          onClick={() => {
            events.log('filter_change', { filter: 'questionnaire:return' })
            setQPeek(false)
          }}
          className="fixed top-2 left-1/2 -translate-x-1/2 z-50 text-[12px] font-medium px-3.5 py-1.5 rounded-full bg-brand text-white shadow-lg hover:opacity-90 transition-opacity"
        >
          Return to questionnaire →
        </button>
      )}
      {runner.phase === 'done' && (!inApp || questionnaireDone) && (
        <Overlay>
          <h1 className="text-sm font-semibold text-ink uppercase tracking-[0.15em] mb-2">Session complete</h1>
          <p className="text-[13px] text-ink-muted leading-relaxed mb-4">
            {inApp
              ? "Thank you. Export the behavioural log before closing the tab. It is also backed up in this browser's local storage."
              : studyUploadEnabled
                ? 'Thank you. Your results are submitted automatically — the downloads below are an optional backup.'
                : "Thank you. Export the behavioural log before closing the tab. (It is also backed up in this browser's local storage.)"}
          </p>
          {studyUploadEnabled && (
            <div
              className={`mb-4 rounded border px-3 py-2.5 text-[12px] leading-snug ${
                uploadState === 'error'
                  ? 'border-risk-med/40 bg-risk-med-bg text-ink-muted'
                  : 'border-border bg-surface-subtle text-ink-muted'
              }`}
            >
              {uploadState === 'ok' && <>✓ Results uploaded. You can close this tab.</>}
              {uploadState === 'uploading' && <>Uploading results…</>}
              {uploadState === 'error' && (
                <div className="flex items-center gap-2">
                  <span>
                    Upload failed — check the connection and retry, or download the files below and
                    send them instead.
                  </span>
                  <button
                    onClick={runFinalUpload}
                    className="shrink-0 text-xs font-medium px-2.5 py-1 rounded bg-brand text-white hover:opacity-90 transition-opacity"
                  >
                    Retry
                  </button>
                </div>
              )}
            </div>
          )}
          {/* Self-run cohorts don't need the raw-log downloads (auto-upload
              carries the data); the buttons stay for the experimenter-run
              legacy regular study only. */}
          {!inApp && (
            <div className="flex gap-2 mb-3">
              <button
                onClick={() => exportEventLogAsJSON(events.getEvents())}
                className="flex-1 text-xs font-mono px-3 py-2 rounded border border-border hover:border-border-strong text-ink-muted hover:text-ink transition-colors"
              >
                Events JSON
              </button>
              <button
                onClick={() => exportEventLogAsCSV(events.getEvents())}
                className="flex-1 text-xs font-mono px-3 py-2 rounded border border-border hover:border-border-strong text-ink-muted hover:text-ink transition-colors"
              >
                Events CSV
              </button>
            </div>
          )}
          <button
            onClick={() => {
              // Back to the cohort chooser, not the legacy experimenter setup
              // form: runner.reset() alone leaves `cohort` set, so a self-run
              // participant clicking this at the end of their session landed on
              // the CB-group / trial-timing screen meant for the experimenter.
              if (SHOW_POLICE_ENTRY) setCohort(null)
              runner.reset()
            }}
            className="w-full text-[11px] text-ink-faint hover:text-ink underline decoration-dotted underline-offset-2"
          >
            New session
          </button>
        </Overlay>
      )}
    </div>
  )
}
