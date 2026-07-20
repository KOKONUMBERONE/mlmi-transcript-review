import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import PlayerBar from '../components/PlayerBar'
import TranscriptView from '../components/TranscriptView'
import HistorySidebar from '../components/HistorySidebar'
import FocusPanel from '../components/FocusPanel'
import ChatPanel, { type ChatUiTurn } from '../components/ChatPanel'
import { CollapsedLeftRail, LeftTabStrip, type LeftTab } from '../components/LeftPanelTabs'
import OutlineModal from '../components/OutlineModal'
import OutlineStoryboard from '../components/OutlineStoryboard'
import CandidatePopup, { type PopupAnchor } from '../components/CandidatePopup'
import ShortcutLegend from '../components/ShortcutLegend'
import defaultTranscriptJson from '../data/defaultTranscript.json'
import { useAudio } from '../state/useAudio'
import { useKeyboardShortcuts } from '../state/useKeyboardShortcuts'
import { useFileDrop } from '../state/useFileDrop'
import type { EventLog } from '../state/useEventLog'
import { extensionForMime, useRecorder } from '../state/useRecorder'
import { validateTranscript } from '../utils/validateTranscript'
import { predictRisks, PredictError } from '../lib/predictApi'
import {
  runFocus,
  runFocusAi,
  mergeFocusResults,
  parseFocusInput,
  parseFocusQueries,
} from '../lib/focusApi'
import { runOutline } from '../lib/outlineApi'
import { runTriage } from '../lib/triageApi'
import { runAnomalies } from '../lib/anomalyApi'
import { runTimeline } from '../lib/timelineApi'
import TimelinePanel, { type TimelineItem } from '../components/TimelinePanel'
import TimelineStrip from '../components/TimelineStrip'
import ConflictPanel, { type ConflictItem } from '../components/ConflictPanel'
import { adaptAsrPipelineOutput, isAsrPipelineOutput } from '../lib/asrAdapter'
import defaultTriageJson from '../data/defaultTriage.json'
import { runChat, type ChatCitation } from '../lib/chatApi'
import { transcribeAudio } from '../lib/transcribeApi'
import { segmentRiskWithFocus } from '../lib/segmentRisk'
import { keptTokenPosition } from '../lib/retainRisk'
import { buildDisplayRiskMap, combinedSegmentRisk } from '../lib/displayRisk'
import type {
  Condition,
  EditMode,
  EditState,
  FocusResult,
  FocusSnippet,
  FocusWordHit,
  HighlightLayer,
  HistoryEntry,
  ModelName,
  AnomalyResult,
  OutlineChapter,
  OutlinePart,
  OutlineResult,
  TimelineResult,
  TriageResult,
  Risk,
  RiskDimension,
  SeekTrigger,
  Segment,
  SentenceSignal,
  Transcript,
  Word,
} from '../types'
import type { RiskRegime, WorkspaceConfig } from './config'
import { RISK_POLICY_BY_REGIME } from './config'
import { CONDITION_CONFIG } from './conditions'
import { useTheme } from '../hooks/useTheme'

// Bundled default case (case447). The transcript ships in src/data; the audio
// is served from public/ and fetched into a Blob on mount (same path uploads
// take). Cast through unknown because the JSON carries extra raw-Whisper fields
// (_whisper_prob, …) and a non-union model key ("Whisper (small)").
const defaultTranscript = defaultTranscriptJson as unknown as Transcript
// Served from public/ at the site root (Vite's default base is "/").
const DEFAULT_AUDIO_URL = '/interview_case447_5min.mp3'
const DEFAULT_AUDIO_NAME = 'interview_case447_5min.mp3'

const UNKNOWN_REVIEWER = 'Unknown reviewer'

function nowStamp(): string {
  const d = new Date()
  const pad = (n: number) => n.toString().padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

let entryCounter = 0
const nextEntryId = () => `${Date.now()}-${++entryCounter}`

function modelsOf(transcript: Transcript): ModelName[] {
  const first = transcript.segments[0]
  return first ? (Object.keys(first.words) as ModelName[]) : []
}

// Segment-level paraRisk = max uncertainty across its words (recomputed after
// a structural split/merge).
const RISK_RANK: Record<Risk, number> = { low: 0, med: 1, high: 2 }
const RISK_BY_RANK: Risk[] = ['low', 'med', 'high']
function segMaxRisk(words: Word[] | undefined): Risk {
  let r = 0
  for (const w of words ?? []) {
    const k = RISK_RANK[w.risk]
    if (k > r) r = k
  }
  return RISK_BY_RANK[r]
}

// Trial context injected by the study trial runner (Phase 3). Drives the locked
// condition, resets review state per trial, and bounds the per-trial event clock.
export interface TrialContext {
  key: string
  block: number
  trialIndex: number
  condition: Condition
  task?: 't1' | 't2' | 't3' // study session (proofread / long recording / voice notes) — stamped into the log as task_type
  difficulty: string
  stimulusId: string
  timeBudgetMs: number
  focusTerms?: string
  // Frozen study clip for this trial (resolved from the STIMULI registry). When
  // present, the workspace loads them at trial start instead of the bundled
  // placeholder. Absent → keep using defaultTranscript (pre-curation behaviour).
  transcriptUrl?: string
  audioUrl?: string
  // Frozen focus result for the long F-Full clips. Study focus is FROZEN: when
  // present, running focus uses this instead of calling :8000 (which fails on
  // the deployed build). Resolved from STIMULI[id].focus.
  focusUrl?: string
}

export default function ReviewWorkspace({
  config,
  events,
  lockedCondition,
  trial,
  interactionLocked = false,
  participantOverride,
}: {
  config: WorkspaceConfig
  // Behavioural event log, created by the shell (AppFull/AppStudy) so it
  // survives across study trials and is reachable for export on the done screen.
  events: EventLog
  // Study build: the condition (C1–C4) selected by the experimenter / trial
  // runner. Locks the highlight layer + focus. Ignored by the full build.
  lockedCondition?: Condition
  // Study trial runner: per-trial context + whether the fixed-time window has
  // closed (interaction disabled).
  trial?: TrialContext
  interactionLocked?: boolean
  // Study: participant code from the experimenter setup (stamped on every event).
  participantOverride?: string
}) {
  const [transcript, setTranscript] = useState<Transcript>(defaultTranscript)
  // Pristine snapshot of the loaded transcript (raw pipeline output) so the
  // "Original (JSON)" export stays untouched by manual split/merge/sentence edits.
  const originalTranscriptRef = useRef<Transcript>(defaultTranscript)
  // Exact JSON the backend returned, BEFORE the ASR adapter — for the "Pipeline
  // raw (JSON)" export. For a normal backend this is just the transcript; for
  // the teammate pipeline it's the nested sentence/confidence format.
  const rawSourceRef = useRef<unknown>(defaultTranscript)
  const [transcriptFilename, setTranscriptFilename] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioFilename, setAudioFilename] = useState<string | null>(null)
  // Object URL for the "Download recording" affordance. Owned here so we can
  // revoke it cleanly when a new recording arrives or the file changes.
  const [recordingDownloadUrl, setRecordingDownloadUrl] = useState<string | null>(null)
  // UI: collapsible side panels + shift-click range-verify anchor.
  // Startup layout: the left Find/Assistant/Outline column starts collapsed
  // (opened on demand) while the right review/audit panel stays open, so the
  // initial focus is the transcript + its progress. EXCEPT in the timeline /
  // conflicts builds, whose paradigm lives in that column — there it starts
  // open on the version's own tab.
  const [focusCollapsed, setFocusCollapsed] = useState(
    !(config.timelineView || config.anomalyDetection),
  )
  const [auditCollapsed, setAuditCollapsed] = useState(false)
  // Left column tab (full build with allowChat): Find | Assistant (+ the
  // per-version Timeline / Conflicts tabs).
  const [leftTab, setLeftTab] = useState<LeftTab>(
    config.timelineView ? 'timeline' : config.anomalyDetection ? 'conflicts' : 'find',
  )
  // Assistant chat — ephemeral by design: in-memory only, cleared on transcript
  // change, never written to the audit trail or any export.
  const [chatMessages, setChatMessages] = useState<ChatUiTurn[]>([])
  const [chatThinking, setChatThinking] = useState(false)
  const [chatError, setChatError] = useState<string | null>(null)
  const chatRunIdRef = useRef(0)
  const verifyAnchorRef = useRef<number | null>(null)
  // Track-changes view. Always on in the study (constant across C1–C4); the
  // full build defaults it on but lets the reviewer switch to a clean read.
  const [showChanges, setShowChanges] = useState(true)
  // Light/dark theme (shared singleton store). The TopBar toggle is full-build
  // only; the study locks it via config.allowThemeToggle.
  const { theme, toggleTheme } = useTheme()
  // Stamp the active theme onto every logged event (both builds).
  useEffect(() => {
    events.setContext({ theme })
  }, [theme, events])
  // The standing "AI-generated" notice can be dismissed (session-level — it
  // reappears on reload so the legal reminder is never permanently gone).
  const [warningDismissed, setWarningDismissed] = useState(false)
  // The machine-generated-transcript notice shows briefly, then auto-dismisses
  // after 4s so it doesn't sit in the way (it reappears on reload). Manual
  // dismissal (the ✕) still works and cancels the timer.
  useEffect(() => {
    if (warningDismissed) return
    const t = setTimeout(() => setWarningDismissed(true), 4000)
    return () => clearTimeout(t)
  }, [warningDismissed])

  const availableModels = useMemo(() => modelsOf(transcript), [transcript])
  const [model, setModel] = useState<ModelName>(availableModels[0])
  const [reviewer, setReviewer] = useState<string>('')
  // Reviewer-name reminder: bumping this nonce flashes the name field red (see
  // TopBar). Fired from the audit-recording paths when no name is set. A ref
  // mirrors `reviewer` so the trigger stays a stable, dependency-free callback.
  const reviewerRef = useRef(reviewer)
  reviewerRef.current = reviewer
  const [nameFlashNonce, setNameFlashNonce] = useState(0)
  const flashNameIfMissing = useCallback(() => {
    if (reviewerRef.current.trim() === '') setNameFlashNonce((n) => n + 1)
  }, [])
  const [participantId, setParticipantId] = useState<string>('')
  const [condition, setCondition] = useState<string>('')

  const [edits, setEdits] = useState<Record<string, EditState>>({})
  // #1 whole-sentence rewrites, keyed by segment id (supersede per-word edits).
  const [segmentTextEdits, setSegmentTextEdits] = useState<
    Record<number, { text: string; reason?: string }>
  >({})
  const [verified, setVerified] = useState<Record<number, boolean>>({})
  // Progressive disclosure: which sentence is expanded to word-level risk
  // (accordion — at most one open). null = all collapsed. The ref lets the
  // playing segment auto-expand on a genuine playhead transition without
  // re-firing on every render (and StrictMode-safe).
  const [expandedSegmentId, setExpandedSegmentId] = useState<number | null>(null)
  const autoExpandedRef = useRef<number | null>(null)
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [popup, setPopup] = useState<PopupAnchor | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [speed, setSpeed] = useState<number>(1)

  // Which risk dimension drives word colouring. Default to the combined
  // signal — that's the one the 2x2 policy is designed for.
  const [dimension, setDimension] = useState<RiskDimension>('combined')
  // Classifier in-flight flag: still tracked around /predict calls, but no
  // longer surfaced in the UI (the transient "scoring…" indicator was removed).
  const [, setPredicting] = useState<boolean>(false)
  // True while the ASR service (:8001) is transcribing an uploaded/recorded
  // audio file. Drives a progress banner — transcription runs on CPU and is slow.
  const [transcribing, setTranscribing] = useState<boolean>(false)

  // ---- Outline sub-page: whether it's open, and whether it's docked to the
  // left as a side panel (vs. the centre modal). Docked lets the reviewer read
  // the outline and the transcript at the same time. ----
  const [outlineOpen, setOutlineOpen] = useState(false)
  const [outlineDocked, setOutlineDocked] = useState(false)

  // ---- Case focus (2b) — retrieval overlay on top of the default scoring ----
  // The "Find" box runs ONE unified search: lexical first (fast, deterministic)
  // then, in the full build, a local-LLM pass enriches/extends it in the
  // background (no Lexical/AI toggle — the engines collaborate).
  const [focusText, setFocusText] = useState<string>('')
  const [focusResult, setFocusResult] = useState<FocusResult | null>(null)
  const [focusActive, setFocusActive] = useState<boolean>(false)
  const [focusRunning, setFocusRunning] = useState<boolean>(false)
  // True while the background AI pass is still merging into the lexical result.
  const [aiEnriching, setAiEnriching] = useState<boolean>(false)
  // Guards the async AI merge: a stale run (user re-searched / cleared) must not
  // clobber the current result.
  const focusRunIdRef = useRef(0)
  // Study only: the frozen FocusResult for this trial's clip (from STIMULI.focus).
  // When set, running focus uses it directly — zero network to :8000.
  const frozenFocusRef = useRef<FocusResult | null>(null)
  // Focus-only error (e.g. the AI pass when Ollama isn't running). Kept separate
  // from the global `errorMsg` banner so a missing local LLM degrades
  // gracefully: it surfaces *inside* the panel and never blocks lexical search
  // or the rest of the app.
  const [focusError, setFocusError] = useState<string | null>(null)

  // ---- Outline (long-transcript chapters) — local-LLM navigation overlay ----
  const [outlineResult, setOutlineResult] = useState<OutlineResult | null>(null)
  const [outlineRunning, setOutlineRunning] = useState<boolean>(false)
  const [outlineError, setOutlineError] = useState<string | null>(null)

  // ---- Sentence triage (sentence build) — local-LLM importance overlay ------
  const [triageResult, setTriageResult] = useState<TriageResult | null>(null)
  const [triageRunning, setTriageRunning] = useState<boolean>(false)

  // Sentence-layer signal (launcher sentence versions): what the whole-sentence
  // tint encodes. Confidence is free (paraRisk is already in the transcript);
  // importance/both lazily fetch the triage ranking below on first use.
  const [sentenceSignal, setSentenceSignal] = useState<SentenceSignal>(config.sentenceSignal)
  const handleSentenceSignalChange = useCallback(
    (s: SentenceSignal) => {
      setSentenceSignal(s)
      events.log('filter_change', { filter: `sentence_signal:${s}` })
    },
    [events],
  )

  // Editing interaction mode (police feedback): 'assisted' (word-popup) vs
  // 'document' (click text and type). Runtime-switchable in the View menu.
  const [editMode, setEditMode] = useState<EditMode>(config.defaultEditMode)
  const handleEditModeChange = useCallback(
    (m: EditMode) => {
      setEditMode(m)
      events.log('filter_change', { filter: `edit_mode:${m}` })
    },
    [events],
  )

  // Triage runs when the paradigm needs it: always in the legacy sentence
  // build, lazily in the launcher sentence versions (only once the reviewer
  // switches the signal to Importance/Both — confidence alone never calls it).
  // The bundled demo case uses the BAKED result (zero backend, so a hosted
  // demo link works); any other transcript (upload / transcription) goes
  // through the live local service. A failure surfaces in the global error
  // banner; the transcript then simply renders unranked.
  const triageWanted =
    config.sentenceTriage ||
    (config.sentenceUncertainty &&
      (sentenceSignal === 'importance' || sentenceSignal === 'both'))
  useEffect(() => {
    if (!triageWanted) return
    setTriageResult(null)
    if (transcript === defaultTranscript) {
      const baked = defaultTriageJson as unknown as TriageResult
      setTriageResult(baked)
      events.log('triage_run', {
        segment_count: transcript.segments.length,
        triage_high: baked.segments.filter((s) => s.importance === 'high').length,
      })
      return
    }
    let cancelled = false
    setTriageRunning(true)
    runTriage(transcript, model)
      .then((result) => {
        if (cancelled) return
        setTriageResult(result)
        events.log('triage_run', {
          segment_count: transcript.segments.length,
          triage_high: result.segments.filter((s) => s.importance === 'high').length,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setErrorMsg(
          err instanceof PredictError
            ? err.message
            : `Sentence triage failed: ${(err as Error).message}`,
        )
      })
      .finally(() => {
        if (!cancelled) setTriageRunning(false)
      })
    return () => {
      cancelled = true
    }
  }, [triageWanted, transcript, model, events])

  // ---- Contradiction check (anomaly build) — local-LLM conflict pairs ------
  // Auto-runs like triage (the paradigm is meaningless without it); errors stay
  // panel-local so a dead Ollama never reads as a whole-app failure. The nonce
  // is the panel's Retry button.
  const [anomalyResult, setAnomalyResult] = useState<AnomalyResult | null>(null)
  const [anomalyRunning, setAnomalyRunning] = useState<boolean>(false)
  const [anomalyError, setAnomalyError] = useState<string | null>(null)
  const [anomalyNonce, setAnomalyNonce] = useState(0)
  useEffect(() => {
    if (!config.anomalyDetection) return
    setAnomalyResult(null)
    setAnomalyError(null)
    let cancelled = false
    setAnomalyRunning(true)
    runAnomalies(transcript, model)
      .then((result) => {
        if (cancelled) return
        setAnomalyResult(result)
        events.log('anomaly_run', {
          segment_count: transcript.segments.length,
          anomaly_count: result.conflicts.length,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setAnomalyError(
          err instanceof PredictError
            ? err.message
            : `Conflict check failed: ${(err as Error).message}`,
        )
      })
      .finally(() => {
        if (!cancelled) setAnomalyRunning(false)
      })
    return () => {
      cancelled = true
    }
  }, [config.anomalyDetection, transcript, model, events, anomalyNonce])

  // ---- Event timeline (timeline build) — local-LLM event list --------------
  const [timelineResult, setTimelineResult] = useState<TimelineResult | null>(null)
  const [timelineRunning, setTimelineRunning] = useState<boolean>(false)
  // Which timeline event is hovered (strip marker OR left-list row) — keyed by
  // the items array index, since event ids are segment ids and can repeat.
  const [hoveredEventIndex, setHoveredEventIndex] = useState<number | null>(null)
  // TimelineStrip open/closed (the strip "pops up" out of the player bar).
  // Collapsed by default — the reviewer opens it from the handle when wanted.
  const [timelineStripOpen, setTimelineStripOpen] = useState<boolean>(false)
  const [timelineError, setTimelineError] = useState<string | null>(null)
  const [timelineNonce, setTimelineNonce] = useState(0)
  useEffect(() => {
    if (!config.timelineView) return
    setTimelineResult(null)
    setTimelineError(null)
    let cancelled = false
    setTimelineRunning(true)
    runTimeline(transcript, model)
      .then((result) => {
        if (cancelled) return
        setTimelineResult(result)
        events.log('timeline_run', {
          segment_count: transcript.segments.length,
          timeline_count: result.events.length,
        })
      })
      .catch((err) => {
        if (cancelled) return
        setTimelineError(
          err instanceof PredictError
            ? err.message
            : `Timeline failed: ${(err as Error).message}`,
        )
      })
      .finally(() => {
        if (!cancelled) setTimelineRunning(false)
      })
    return () => {
      cancelled = true
    }
  }, [config.timelineView, transcript, model, events, timelineNonce])

  // Whole-sentence highlighter overlay. The tint SOURCE is a signal:
  //   confidence → upstream paraRisk (high/med), tooltip = ASR confidence
  //   importance → LLM triage (high sentences), tooltip = rank · reason
  //   both       → gated combine — the word-level deployment principle at
  //                sentence level: red only when likely mis-transcribed AND
  //                important; one signal alone shows amber; quiet otherwise.
  // The legacy sentence build is importance-only; the launcher sentence
  // versions follow the runtime selector. Conflict tints compose on top.
  const { sentenceTintMap, sentenceTintTitleMap } = useMemo(() => {
    const map = new Map<number, Risk>()
    const titles = new Map<number, string>()

    // Importance lookup from triage: id -> "#rank · reason".
    const importantNote = new Map<number, string>()
    if (triageResult) {
      for (const s of triageResult.segments) {
        if (s.importance === 'high') {
          const rank = s.rank != null ? `#${s.rank}` : ''
          importantNote.set(s.id, [rank, s.reason ?? ''].filter(Boolean).join(' · '))
        }
      }
    }

    const signal: SentenceSignal | null = config.sentenceTriage
      ? 'importance'
      : config.sentenceUncertainty
        ? sentenceSignal
        : null

    if (signal === 'importance') {
      for (const [sid, note] of importantNote) {
        map.set(sid, 'high')
        titles.set(sid, note || 'Marked important by the AI — re-listen first')
      }
    } else if (signal === 'confidence') {
      for (const s of transcript.segments) {
        if (s.paraRisk === 'high') {
          map.set(s.id, 'high')
          titles.set(s.id, 'Low ASR confidence — check this sentence against the audio')
        } else if (s.paraRisk === 'med') {
          map.set(s.id, 'med')
          titles.set(s.id, 'Some ASR uncertainty in this sentence')
        }
      }
    } else if (signal === 'both') {
      for (const s of transcript.segments) {
        const important = importantNote.has(s.id)
        let tint: Risk | null = null
        let title = ''
        if (important && s.paraRisk === 'high') {
          tint = 'high'
          title = 'Likely mis-transcribed AND important — check this first'
        } else if (important && s.paraRisk === 'med') {
          tint = 'med'
          title = 'Important, with some ASR uncertainty'
        } else if (!important && s.paraRisk === 'high') {
          tint = 'med'
          title = 'Low ASR confidence (content ranked less critical)'
        }
        if (tint) {
          const note = importantNote.get(s.id)
          map.set(s.id, tint)
          titles.set(s.id, note ? `${title} (${note})` : title)
        }
      }
    }

    // Conflict pairs compose on top (the complete version runs both): fill
    // untinted segments with amber and append to the tooltip either way.
    // AI-suggested only — wording stays hedged.
    if (config.anomalyDetection && anomalyResult) {
      for (const c of anomalyResult.conflicts) {
        const note = `Possible ${c.type} conflict — ${c.note} (see the Conflicts panel)`
        for (const sid of [c.a, c.b]) {
          if (!map.has(sid)) map.set(sid, 'med')
          titles.set(sid, titles.has(sid) ? `${titles.get(sid)} · ${note}` : note)
        }
      }
    }

    return { sentenceTintMap: map, sentenceTintTitleMap: titles }
  }, [
    config.sentenceTriage,
    config.sentenceUncertainty,
    config.anomalyDetection,
    sentenceSignal,
    triageResult,
    anomalyResult,
    transcript,
  ])
  const sentenceTintTitleFor = useCallback(
    (segId: number) => sentenceTintTitleMap.get(segId),
    [sentenceTintTitleMap],
  )
  const sentenceLayerActive =
    (config.sentenceTriage && !!triageResult) ||
    config.sentenceUncertainty ||
    (config.anomalyDetection && !!anomalyResult && anomalyResult.conflicts.length > 0)

  // Derive, from the retrieval result, the per-word marker lookup and the set
  // of segments that hold any hit. The hit shown on a word is the
  // highest-priority one (exact > alias > semantic, then score). Declared here
  // (before the audio markers memo) so the waveform can also reflect focus.
  const { focusHitMap, focusSegmentIds } = useMemo(() => {
    const map = new Map<string, FocusWordHit>()
    const segs = new Set<number>()
    const PRIORITY = { exact: 3, alias: 2, semantic: 1, llm: 1 } as const
    if (focusResult) {
      for (const term of focusResult.terms) {
        for (const s of term.snippets) {
          segs.add(s.segment_id)
          for (const idx of s.highlight_word_indices) {
            const key = `${s.segment_id}-${idx}`
            const hit: FocusWordHit = {
              focus_label: term.focus_label,
              match_type: s.match_type,
              match_detail: s.match_detail,
              focus_score: s.focus_score,
              llm_reason: s.llm_reason,
            }
            const prev = map.get(key)
            const better =
              !prev ||
              PRIORITY[hit.match_type] > PRIORITY[prev.match_type] ||
              (PRIORITY[hit.match_type] === PRIORITY[prev.match_type] &&
                hit.focus_score > prev.focus_score)
            if (better) map.set(key, hit)
          }
        }
      }
    }
    return { focusHitMap: map, focusSegmentIds: segs }
  }, [focusResult])

  // ---- Behavioural event log (lifted to the shell so it survives across study
  // trials; passed in via props.events) ----

  // Mirror identity + the effective condition into the event-log context so
  // every row carries the latest values without prop-drilling. In study the
  // condition is C1–C4 (trial/locked); in full it's the researcher free-text.
  const logCondition =
    config.mode === 'study'
      ? trial?.condition ?? lockedCondition ?? config.condition ?? 'C3'
      : condition
  const logParticipant = participantOverride ?? participantId
  useEffect(() => {
    events.setContext({
      reviewer,
      model,
      participantId: logParticipant,
      condition: logCondition,
    })
  }, [reviewer, model, logParticipant, logCondition, events])

  // Emit session_start exactly once, after the first transcript is in place.
  const sessionStartedRef = useRef(false)
  useEffect(() => {
    if (sessionStartedRef.current) return
    sessionStartedRef.current = true
    events.log('session_start', {
      audio_duration: transcript.audioDuration,
      segment_count: transcript.segments.length,
      transcript_filename: transcriptFilename ?? '(bundled case447)',
    })
  }, [events, transcript, transcriptFilename])

  // ---- Bundled default case: load its audio + annotate it, once on mount ----
  // The audio ships in public/ and is fetched into a Blob so it flows through
  // exactly like an uploaded file. Annotation runs the 2a classifier so the
  // combined/importance views work out of the box; if the local service is
  // down we leave the unannotated transcript (uncertainty view) without a
  // scary banner — startup stays clean, unlike a user-initiated upload.
  const defaultLoadedRef = useRef(false)
  useEffect(() => {
    if (defaultLoadedRef.current) return
    defaultLoadedRef.current = true
    if (!config.loadDefaultCase) return

    let cancelled = false
    fetch(DEFAULT_AUDIO_URL)
      .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`audio HTTP ${r.status}`))))
      .then((blob) => {
        if (cancelled) return
        setAudioBlob(blob)
        setAudioFilename(DEFAULT_AUDIO_NAME)
        events.log('audio_load', { audio_filename: DEFAULT_AUDIO_NAME })
      })
      .catch((e) => console.warn('Default audio not loaded:', (e as Error).message))

    if (config.livePredict) {
      setPredicting(true)
      predictRisks(defaultTranscript, modelsOf(defaultTranscript)[0])
        .then((annotated) => {
          if (!cancelled) {
            setTranscript(annotated)
            originalTranscriptRef.current = annotated
          }
        })
        .catch((e) => console.warn('Default transcript not annotated:', (e as Error).message))
        .finally(() => {
          if (!cancelled) setPredicting(false)
        })
    }

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- Active highlight layer + focus availability (C1–C4) ----
  // Full build: the reviewer's free RiskDimension toggle drives colouring.
  // Study build: the active condition locks the highlight layer and whether
  // case focus exists at all.
  const effectiveCondition: Condition =
    trial?.condition ?? lockedCondition ?? config.condition ?? 'C3'
  const conditionCfg = CONDITION_CONFIG[effectiveCondition]
  // Sentence-uncertainty version: segment risk / chips / filter follow the
  // upstream sentence confidence (`paraRisk` = the 'uncertainty' dimension);
  // word marks are suppressed separately via wordDimension below.
  const activeHighlight: HighlightLayer = config.sentenceUncertainty
    ? 'uncertainty'
    : config.allowFreeDimension
      ? dimension
      : conditionCfg.highlight
  // allowFind hides the whole left column (clean launcher versions); inside
  // that, the study's condition config still decides per-condition presence.
  const focusEnabled =
    config.allowFind && (config.allowFreeDimension ? true : conditionCfg.focus)
  // Focus only paints when it's enabled *and* a retrieval has actually run.
  const showFocus = focusEnabled && focusActive

  // Study build warns before leaving so a tab close can't silently drop a
  // recruited session (the event log is also backed up to localStorage).
  useEffect(() => {
    if (config.mode !== 'study') return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [config.mode])

  // ---- Trial runner integration (study) ----
  // On a new trial: reset review state, stamp the trial context + per-trial
  // clock, and mark trial_start. On time-up (interactionLocked): mark trial_end.
  const trialKeyRef = useRef<string | null>(null)
  const trialEndedRef = useRef(false)
  useEffect(() => {
    if (!trial || trialKeyRef.current === trial.key) return
    trialKeyRef.current = trial.key
    trialEndedRef.current = false
    setEdits({})
    // Whole-sentence rewrites live in a separate map keyed by numeric segment id.
    // Segment ids repeat across stimuli (every transcript numbers 0,1,2,…), so a
    // rewrite left here would re-render on the NEXT trial's same-id segment and
    // pollute its exported/uploaded data. Reset it like applyTranscript does.
    setSegmentTextEdits({})
    setVerified({})
    setHistory([])
    setPopup(null)
    setExpandedSegmentId(null)
    autoExpandedRef.current = null
    setFocusResult(null)
    setFocusActive(false)
    setFocusError(null)
    setFocusText(trial.focusTerms ?? '')
    setOutlineResult(null)
    setOutlineError(null)
    events.setTrial({
      block: trial.block,
      trialIndex: trial.trialIndex,
      condition: trial.condition,
      difficulty: trial.difficulty,
      stimulusId: trial.stimulusId,
      taskType: trial.task,
    })
    events.log('trial_start', { time_budget_ms: trial.timeBudgetMs })
  }, [trial, events])

  // Load this trial's frozen stimulus (transcript + audio). Separate effect,
  // keyed on the trial KEY (a primitive) with the standard cancel-on-cleanup
  // pattern — so it survives StrictMode's double-invoke (the reset effect above
  // early-returns on its second pass, which would otherwise cancel the fetch).
  // Each trial reloads a pristine transcript; an unregistered stimulus id (no
  // url) falls back to the bundled placeholder.
  useEffect(() => {
    if (!trial) return
    let cancelled = false
    if (trial.transcriptUrl) {
      fetch(trial.transcriptUrl)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`transcript HTTP ${r.status}`))))
        .then((json) => {
          if (cancelled) return
          const tr = json as Transcript
          setTranscript(tr)
          // Follow the stimulus' own model key (e.g. 'ASR ensemble') — without
          // this, `model` stays pinned to the default transcript's key and every
          // segment renders empty (words[model] === undefined).
          setModel(modelsOf(tr)[0])
          originalTranscriptRef.current = tr
          setTranscriptFilename(trial.stimulusId)
        })
        .catch((e) => console.warn('Stimulus transcript not loaded:', (e as Error).message))
    } else {
      setTranscript(defaultTranscript)
      setModel(modelsOf(defaultTranscript)[0])
      originalTranscriptRef.current = defaultTranscript
      setTranscriptFilename(null)
    }
    if (trial.audioUrl) {
      fetch(trial.audioUrl)
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`audio HTTP ${r.status}`))))
        .then((blob) => {
          if (cancelled) return
          setAudioBlob(blob)
          setAudioFilename(trial.stimulusId)
        })
        .catch((e) => console.warn('Stimulus audio not loaded:', (e as Error).message))
    }
    // Frozen focus result (F-Full clips). Loaded up front so running focus is
    // instant and never touches the network. Cleared for clips without one.
    if (trial.focusUrl) {
      fetch(trial.focusUrl)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`focus HTTP ${r.status}`))))
        .then((json) => {
          if (cancelled) return
          frozenFocusRef.current = json as FocusResult
        })
        .catch((e) => {
          if (!cancelled) frozenFocusRef.current = null
          console.warn('Frozen focus not loaded:', (e as Error).message)
        })
    } else {
      frozenFocusRef.current = null
    }
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trial?.key])
  useEffect(() => {
    if (!trial || !interactionLocked || trialEndedRef.current) return
    trialEndedRef.current = true
    events.log('trial_end', {})
  }, [interactionLocked, trial, events])

  // Display-time risk "operating point" (deployment quiet vs study dense, see
  // RiskPolicy). The full build can switch it at runtime to preview both without
  // opening the study build; the study build keeps its fixed regime.
  const [riskRegime, setRiskRegime] = useState<RiskRegime>(
    config.mode === 'study' ? 'study' : 'deployment',
  )
  const activeRiskPolicy = config.allowRiskRegimeToggle
    ? RISK_POLICY_BY_REGIME[riskRegime]
    : config.riskPolicy
  // Only transforms the combined dimension; null for the study / pass-through
  // policy → renders raw combined_risk (zero regression).
  const displayRiskMap = useMemo(
    () =>
      activeHighlight === 'combined'
        ? buildDisplayRiskMap(transcript, model, activeRiskPolicy)
        : null,
    [transcript, model, activeHighlight, activeRiskPolicy],
  )

  // Segment-level risk that honours the display policy, so the waveform markers
  // and the high-risk-remaining count agree with the coloured words.
  const segRisk = useCallback(
    (s: typeof transcript.segments[number]) => {
      const focused = showFocus && focusSegmentIds.has(s.id)
      return displayRiskMap
        ? combinedSegmentRisk(s, model, displayRiskMap, focused)
        : segmentRiskWithFocus(s, model, activeHighlight, focused)
    },
    [displayRiskMap, activeHighlight, model, showFocus, focusSegmentIds],
  )

  // ---- Audio with logging hooks ----
  // The waveform is a clean scrubber now (no risk-colour bands); click or drag
  // to seek, logged as one `seek` per gesture.
  const audio = useAudio(audioBlob, transcript.audioDuration, {
    onError: (msg) => setErrorMsg(msg),
    onPlay: (position) => events.log('play', { audio_position: position }),
    onPause: (position) => events.log('pause', { audio_position: position }),
    onWaveformSeek: (from, to) =>
      events.log('seek', {
        from_position: from,
        to_position: to,
        trigger: 'waveform',
      }),
  })

  // ---- Wrapped seek that records the trigger ----
  const seekWithLog = useCallback(
    (seconds: number, trigger: SeekTrigger) => {
      events.log('seek', {
        from_position: audio.currentTime,
        to_position: seconds,
        trigger,
      })
      audio.seek(seconds)
    },
    [audio, events],
  )

  // ---- Playback ergonomics (transcription-editor conventions) ----
  // Pressing play after a pause rewinds a couple of seconds so the reviewer
  // re-hears the lead-in instead of resuming cold mid-word.
  const togglePlayWithRewind = useCallback(() => {
    if (!audio.isPlaying && audio.currentTime > 0.2) {
      audio.seek(Math.max(0, audio.currentTime - 2))
    }
    audio.togglePlay()
  }, [audio])

  // Replay the segment the playhead is in from its start (key: R).
  const replayCurrentSegment = useCallback(() => {
    const t = audio.currentTime
    const seg =
      transcript.segments.find((s) => t >= s.start && t < s.end) ??
      [...transcript.segments].reverse().find((s) => s.start <= t) ??
      transcript.segments[0]
    if (!seg) return
    seekWithLog(seg.start, 'keyboard')
    if (!audio.isPlaying) audio.togglePlay()
  }, [audio, transcript, seekWithLog])

  // ---- Active segment + focus event ----
  const activeId = useMemo(() => {
    const seg = transcript.segments.find(
      (s) => audio.currentTime >= s.start && audio.currentTime < s.end,
    )
    return seg?.id ?? null
  }, [transcript, audio.currentTime])

  // Fire segment_focus each time the active segment changes (not on every
  // timeupdate). Use a ref to remember the previous active id.
  const lastFocusRef = useRef<number | null>(null)
  useEffect(() => {
    if (activeId === lastFocusRef.current) return
    lastFocusRef.current = activeId
    if (activeId == null) return
    const seg = transcript.segments.find((s) => s.id === activeId)
    if (!seg) return
    events.log('segment_focus', {
      segment_id: seg.id,
      segment_start: seg.start,
      segment_risk: seg.paraRisk,
    })
  }, [activeId, transcript, events])

  // Progressive disclosure: auto-expand the playing segment to word level. Fires
  // only on a genuine playhead transition (autoExpandedRef guards re-renders +
  // StrictMode); manual expand/collapse is respected in between (it doesn't move
  // the playhead). Accordion: setting one id collapses the rest.
  useEffect(() => {
    if (activeId == null) return
    if (autoExpandedRef.current === activeId) return
    autoExpandedRef.current = activeId
    setExpandedSegmentId(activeId)
    const seg = transcript.segments.find((s) => s.id === activeId)
    events.log('segment_expand', {
      segment_id: activeId,
      segment_start: seg?.start,
      segment_risk: seg ? segRisk(seg) : undefined,
      expand_trigger: 'auto',
    })
  }, [activeId, transcript, events, segRisk])

  // ---- Audit-trail logger ----
  const currentReviewer = (): string =>
    reviewer.trim() === '' ? UNKNOWN_REVIEWER : reviewer.trim()

  const logEntry = (entry: Omit<HistoryEntry, 'id' | 'timestamp' | 'reviewer'>) => {
    flashNameIfMissing()
    setHistory((prev) => [
      {
        id: nextEntryId(),
        timestamp: nowStamp(),
        reviewer: currentReviewer(),
        ...entry,
      },
      ...prev,
    ])
  }

  // ---- Popup ----
  // useCallback so the per-word onWordClick reference is stable — lets
  // React.memo(Word) skip words whose risk/active state didn't change as the
  // karaoke playhead ticks (otherwise every word re-renders ~every 50-250ms).
  const openPopup = useCallback((segId: number, wordIdx: number, rect: DOMRect) => {
    const segment = transcript.segments.find((s) => s.id === segId)
    const word = segment?.words[model]?.[wordIdx]
    events.log('word_click', {
      segment_id: segId,
      word_index: wordIdx,
      word_text: word?.text,
      word_risk: word?.risk,
      word_importance: word?.predicted_importance,
      word_combined_risk: word?.combined_risk,
      word_proba_high: word?.predicted_proba?.high,
    })
    events.log('popup_open', { segment_id: segId, word_index: wordIdx })
    setPopup({ segId, wordIdx, rect })
  }, [transcript, model, events])

  const closePopup = () => {
    if (popup) {
      events.log('popup_close', {
        segment_id: popup.segId,
        word_index: popup.wordIdx,
      })
    }
    setPopup(null)
  }

  const wordAt = (segId: number, wordIdx: number) => {
    const segment = transcript.segments.find((s) => s.id === segId)
    return segment?.words[model]?.[wordIdx]
  }

  const originalTextAt = (segId: number, wordIdx: number): string =>
    wordAt(segId, wordIdx)?.text ?? ''

  const applyEdit = (newText: string, reason?: string) => {
    if (!popup) return
    const { segId, wordIdx } = popup
    const segment = transcript.segments.find((s) => s.id === segId)
    const origWord = segment?.words[model]?.[wordIdx]

    // Attribution: if newText matches this word index in any model, it's a
    // 'candidate' pick, else a 'manual' correction. chosenModel = which model(s)
    // produced it (token-level "this model was right" label); undefined for manual.
    const candidates = new Set<string>()
    if (segment) {
      for (const m of availableModels) {
        const w = segment.words[m]?.[wordIdx]
        if (w?.text) candidates.add(w.text)
      }
    }
    const via: 'candidate' | 'manual' = candidates.has(newText) ? 'candidate' : 'manual'
    const chosenModel =
      via === 'candidate'
        ? availableModels
            .filter((m) => segment?.words[m]?.[wordIdx]?.text === newText)
            .join('|') || undefined
        : undefined

    // Shared audit trail + event, then close. `restore` only differs for the
    // per-word branch (a rewrite has no deleted-word state to restore).
    const logApply = (fromDisplay: string, restore: boolean) => {
      logEntry({ kind: 'edit', segmentId: segId, wordIndex: wordIdx, from: fromDisplay, to: newText, reason })
      events.log(restore ? 'word_restore' : 'edit_apply', {
        segment_id: segId,
        word_index: wordIdx,
        from_text: fromDisplay,
        to_text: newText,
        via,
        chosen_model: chosenModel,
        word_risk: origWord?.risk,
        word_importance: origWord?.predicted_importance,
        word_combined_risk: origWord?.combined_risk,
        word_proba_high: origWord?.predicted_proba?.high,
        reason,
      })
      events.log('popup_close', { segment_id: segId, word_index: wordIdx })
      setPopup(null)
    }

    // Rewritten segment: the per-word `edits` map is dead here — editSentence
    // cleared it and the textOverride render reads only the aligned override, so
    // writing edits[key] would silently vanish. Splice the correction into the
    // override string at the clicked (kept) token instead. Candidates are still
    // read from segment.words (never mutated), so per-model alternatives stay right.
    const override = segment ? segmentTextEdits[segId]?.text : undefined
    if (override != null && segment) {
      const words = segment.words[model] ?? []
      const cur = keptTokenPosition(override, words, segment.start, segment.end, wordIdx)
      // fromDisplay must be the CURRENTLY-DISPLAYED override token (e.g. "gun,"),
      // not the raw original — else the no-op guard / audit "from" are wrong.
      const fromDisplay = cur?.token ?? origWord?.text ?? ''
      if (!cur || newText === fromDisplay) {
        closePopup()
        return
      }
      const parts = cur.parts.slice()
      parts[cur.pos] = newText
      setSegmentTextEdits((prev) => ({ ...prev, [segId]: { text: parts.join(' ') } }))
      logApply(fromDisplay, false)
      return
    }

    // Normal (non-rewritten) segment: per-word edits map.
    const key = `${segId}-${wordIdx}`
    const original = originalTextAt(segId, wordIdx)
    const previous = edits[key]
    const wasDeleted = previous?.deleted === true
    const fromDisplay = wasDeleted ? '(deleted)' : previous?.text ?? original
    if (!wasDeleted && newText === fromDisplay) {
      closePopup()
      return
    }
    setEdits((prev) => ({ ...prev, [key]: { text: newText, deleted: false, reason } }))
    logApply(fromDisplay, wasDeleted)
  }

  // Batch correct-all: fix every token (active model) whose CURRENT displayed
  // text equals `fromText`, in one decision. Writes a single summary audit entry
  // + a single edit_apply event carrying the occurrence count (so a recurring
  // ASR error — e.g. a mis-heard name — is one human judgment, not N).
  const applyEditAll = (newText: string, reason: string | undefined, via: 'candidate' | 'manual') => {
    if (!popup) return
    const fromText =
      edits[`${popup.segId}-${popup.wordIdx}`]?.text ?? originalTextAt(popup.segId, popup.wordIdx)
    if (!fromText || newText === fromText) {
      closePopup()
      return
    }
    const hits: { segId: number; wordIdx: number }[] = []
    for (const s of transcript.segments) {
      // A rewritten segment renders from its override, NOT the edits map, so an
      // edit written here would be invisible now yet resurface if the segment is
      // later merged (which drops the override). Skip it — apply-all only touches
      // segments that actually display from words[model]/edits.
      if (segmentTextEdits[s.id] != null) continue
      const ws = s.words[model] ?? []
      ws.forEach((w, i) => {
        const e = edits[`${s.id}-${i}`]
        if (e?.deleted) return
        const cur = e?.text ?? w.text
        if (cur && cur === fromText) hits.push({ segId: s.id, wordIdx: i })
      })
    }
    if (hits.length === 0) {
      closePopup()
      return
    }
    setEdits((prev) => {
      const next = { ...prev }
      for (const h of hits) next[`${h.segId}-${h.wordIdx}`] = { text: newText, deleted: false, reason }
      return next
    })
    const segIds = [...new Set(hits.map((h) => h.segId))]
    logEntry({
      kind: 'edit',
      segmentId: hits[0].segId,
      segmentIds: segIds,
      from: fromText,
      to: newText,
      reason: reason ?? `applied to ${hits.length} occurrences`,
    })
    events.log('edit_apply', {
      segment_id: hits[0].segId,
      from_text: fromText,
      to_text: newText,
      via,
      occurrences: hits.length,
      reason,
    })
    events.log('popup_close', { segment_id: popup.segId, word_index: popup.wordIdx })
    setPopup(null)
  }

  const deleteWord = (reason?: string) => {
    if (!popup) return
    const segment = transcript.segments.find((s) => s.id === popup.segId)

    // Rewritten segment: no per-word edits map — splice the word OUT of the
    // override string. (A rewrite has no struck-through track-change / restore
    // path; the word is simply removed from the sentence.)
    const override = segment ? segmentTextEdits[popup.segId]?.text : undefined
    if (override != null && segment) {
      const words = segment.words[model] ?? []
      const cur = keptTokenPosition(override, words, segment.start, segment.end, popup.wordIdx)
      if (!cur) {
        closePopup()
        return
      }
      const parts = cur.parts.slice()
      parts.splice(cur.pos, 1)
      setSegmentTextEdits((prev) => ({ ...prev, [popup.segId]: { text: parts.join(' ') } }))
      const delWord = words[popup.wordIdx]
      logEntry({ kind: 'delete', segmentId: popup.segId, wordIndex: popup.wordIdx, from: cur.token, reason })
      events.log('word_delete', {
        segment_id: popup.segId,
        word_index: popup.wordIdx,
        word_text: cur.token,
        word_risk: delWord?.risk,
        word_importance: delWord?.predicted_importance,
        word_combined_risk: delWord?.combined_risk,
        word_proba_high: delWord?.predicted_proba?.high,
        reason,
      })
      events.log('popup_close', { segment_id: popup.segId, word_index: popup.wordIdx })
      setPopup(null)
      return
    }

    const key = `${popup.segId}-${popup.wordIdx}`
    const original = originalTextAt(popup.segId, popup.wordIdx)
    const previous = edits[key]
    if (previous?.deleted) {
      closePopup()
      return
    }
    const displayedText = previous?.text ?? original

    setEdits((prev) => ({
      ...prev,
      [key]: { text: displayedText, deleted: true, reason },
    }))
    logEntry({
      kind: 'delete',
      segmentId: popup.segId,
      wordIndex: popup.wordIdx,
      from: displayedText,
      reason,
    })

    const delWord = wordAt(popup.segId, popup.wordIdx)
    events.log('word_delete', {
      segment_id: popup.segId,
      word_index: popup.wordIdx,
      word_text: displayedText,
      word_risk: delWord?.risk,
      word_importance: delWord?.predicted_importance,
      word_combined_risk: delWord?.combined_risk,
      word_proba_high: delWord?.predicted_proba?.high,
      reason,
    })

    events.log('popup_close', {
      segment_id: popup.segId,
      word_index: popup.wordIdx,
    })
    setPopup(null)
  }

  // Bulk verify/unverify a set of segments in one go (used by "Verify all
  // shown" / "Clear all" and shift-click range). Writes one audit entry per
  // changed segment (chain-of-custody) sharing a timestamp, + one event each.
  // Bulk verify/unverify the given segments. Writes ONE summary audit entry
  // (segmentIds) so the trail doesn't balloon, plus a per-segment behavioural
  // event for analysis. Side effects are kept OUTSIDE the setVerified updater so
  // React StrictMode's double-invoked updater can't double-log.
  const verifyMany = useCallback(
    (segIds: number[], value: boolean) => {
      const changed = segIds.filter((id) => !!verified[id] !== value)
      if (changed.length === 0) return
      flashNameIfMissing()
      setVerified((prev) => {
        const next = { ...prev }
        for (const id of changed) next[id] = value
        return next
      })
      setHistory((h) => [
        {
          id: nextEntryId(),
          timestamp: nowStamp(),
          reviewer: currentReviewer(),
          kind: value ? 'verify' : 'unverify',
          segmentId: changed[0],
          segmentIds: changed,
        },
        ...h,
      ])
      for (const id of changed) events.log(value ? 'verify' : 'unverify', { segment_id: id })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [verified, reviewer, events],
  )

  const toggleVerify = useCallback(
    (segId: number, opts?: { range?: boolean }) => {
      const anchor = verifyAnchorRef.current
      // Shift-click verifies the range (transcript order) from the last anchor.
      if (opts?.range && anchor != null && anchor !== segId) {
        const ids = transcript.segments.map((s) => s.id)
        const a = ids.indexOf(anchor)
        const b = ids.indexOf(segId)
        if (a !== -1 && b !== -1) {
          const [lo, hi] = a < b ? [a, b] : [b, a]
          verifyMany(ids.slice(lo, hi + 1), true)
          verifyAnchorRef.current = segId
          return
        }
      }
      verifyAnchorRef.current = segId
      const next = !verified[segId]
      flashNameIfMissing()
      setVerified((prev) => ({ ...prev, [segId]: next }))
      setHistory((h) => [
        {
          id: nextEntryId(),
          timestamp: nowStamp(),
          reviewer: currentReviewer(),
          kind: next ? 'verify' : 'unverify',
          segmentId: segId,
        },
        ...h,
      ])
      events.log(next ? 'verify' : 'unverify', { segment_id: segId })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [verified, reviewer, events, transcript, verifyMany],
  )

  // ---- #1 whole-sentence edit ----
  const editSentence = (segId: number, text: string) => {
    const seg = transcript.segments.find((s) => s.id === segId)
    if (!seg) return
    const segWords = seg.words[model] ?? []
    const oldFull =
      segmentTextEdits[segId]?.text ??
      segWords
        .map((w, i) => {
          const e = edits[`${segId}-${i}`]
          if (e?.deleted) return ''
          return e ? e.text : w.text
        })
        .filter(Boolean)
        .join(' ')
    if (text === oldFull) return
    setSegmentTextEdits((prev) => ({ ...prev, [segId]: { text } }))
    // Clear per-word edits for this segment — the rewrite supersedes them.
    setEdits((prev) => {
      const next: Record<string, EditState> = {}
      for (const [k, v] of Object.entries(prev)) {
        if (!k.startsWith(`${segId}-`)) next[k] = v
      }
      return next
    })
    logEntry({ kind: 'edit', segmentId: segId, from: oldFull, to: text })
    events.log('edit_apply', { segment_id: segId, from_text: oldFull, to_text: text, via: 'manual' })
  }

  // ---- #2 structural edits (split / merge / change speaker) ----
  const splitSegment = (segId: number, wordIdx: number) => {
    const segs = transcript.segments
    const idx = segs.findIndex((s) => s.id === segId)
    if (idx === -1 || wordIdx <= 0) return
    const seg = segs[idx]
    const total = (seg.words[model] ?? []).length
    if (wordIdx >= total) return
    const newId = Math.max(...segs.map((s) => s.id)) + 1
    const boundary = seg.start + (wordIdx / total) * (seg.end - seg.start)
    const wordsA: Record<string, Word[]> = {}
    const wordsB: Record<string, Word[]> = {}
    for (const m of Object.keys(seg.words)) {
      wordsA[m] = (seg.words[m] ?? []).slice(0, wordIdx)
      wordsB[m] = (seg.words[m] ?? []).slice(wordIdx)
    }
    const segA: Segment = { ...seg, end: boundary, words: wordsA, paraRisk: segMaxRisk(wordsA[model]) }
    const segB: Segment = {
      id: newId,
      speaker: seg.speaker,
      start: boundary,
      end: seg.end,
      paraRisk: segMaxRisk(wordsB[model]),
      words: wordsB,
    }
    setTranscript({
      ...transcript,
      segments: [...segs.slice(0, idx), segA, segB, ...segs.slice(idx + 1)],
    })
    // Remap edits: A keeps indices < wordIdx; B reindexed under the new id.
    setEdits((prev) => {
      const next: Record<string, EditState> = {}
      for (const [k, v] of Object.entries(prev)) {
        const m = /^(\d+)-(\d+)$/.exec(k)
        if (!m || Number(m[1]) !== segId) {
          next[k] = v
          continue
        }
        const widx = Number(m[2])
        if (widx < wordIdx) next[`${segId}-${widx}`] = v
        else next[`${newId}-${widx - wordIdx}`] = v
      }
      return next
    })
    setVerified((prev) => ({ ...prev, [newId]: false }))
    setSegmentTextEdits((prev) => {
      const n = { ...prev }
      delete n[segId]
      return n
    })
    logEntry({ kind: 'split', segmentId: segId, to: `→ new seg ${newId}` })
    events.log('segment_split', { segment_id: segId })
    setPopup(null)
    setExpandedSegmentId(null)
    autoExpandedRef.current = null
  }

  const mergeWithNext = (segId: number) => {
    const segs = transcript.segments
    const idx = segs.findIndex((s) => s.id === segId)
    if (idx === -1 || idx >= segs.length - 1) return
    const a = segs[idx]
    const b = segs[idx + 1]
    const aLen = (a.words[model] ?? []).length
    const mergedWords: Record<string, Word[]> = {}
    for (const m of new Set([...Object.keys(a.words), ...Object.keys(b.words)])) {
      mergedWords[m] = [...(a.words[m] ?? []), ...(b.words[m] ?? [])]
    }
    const merged: Segment = { ...a, end: b.end, words: mergedWords, paraRisk: segMaxRisk(mergedWords[model]) }
    setTranscript({
      ...transcript,
      segments: [...segs.slice(0, idx), merged, ...segs.slice(idx + 2)],
    })
    // Remap edits: A's stay; B's `${b.id}-k` -> `${a.id}-(aLen+k)`.
    setEdits((prev) => {
      const next: Record<string, EditState> = {}
      for (const [k, v] of Object.entries(prev)) {
        const m = /^(\d+)-(\d+)$/.exec(k)
        if (m && Number(m[1]) === b.id) next[`${a.id}-${aLen + Number(m[2])}`] = v
        else next[k] = v
      }
      return next
    })
    setVerified((prev) => {
      const n = { ...prev }
      delete n[b.id]
      return n
    })
    setSegmentTextEdits((prev) => {
      const n = { ...prev }
      delete n[a.id]
      delete n[b.id]
      return n
    })
    logEntry({ kind: 'merge', segmentId: a.id, to: `+ seg ${b.id}` })
    events.log('segment_merge', { segment_id: a.id })
    setExpandedSegmentId(null)
    autoExpandedRef.current = null
  }

  const changeSpeaker = (segId: number, speaker: string) => {
    const seg = transcript.segments.find((s) => s.id === segId)
    if (!seg || seg.speaker === speaker) return
    const old = seg.speaker
    setTranscript({
      ...transcript,
      segments: transcript.segments.map((s) => (s.id === segId ? { ...s, speaker } : s)),
    })
    logEntry({ kind: 'speaker', segmentId: segId, from: old, to: speaker })
    events.log('speaker_change', { segment_id: segId, from_text: old, to_text: speaker })
  }

  // ---- Speed + model dropdowns ----
  const handleSpeedChange = (newSpeed: number) => {
    events.log('speed_change', { old_speed: speed, new_speed: newSpeed })
    setSpeed(newSpeed)
    audio.setRate(newSpeed)
  }

  const handleModelChange = (next: ModelName) => {
    events.log('model_switch', { from_model: model, to_model: next })
    setModel(next)
  }

  // Full build: reviewer freely switches the risk view. Study build: the Risk
  // dropdown is hidden, so this fires only if the manipulation is somehow
  // changed mid-trial — a contamination signal to filter on in analysis.
  const handleDimensionChange = (next: RiskDimension) => {
    events.log('dimension_change', { from_dimension: dimension, to_dimension: next })
    setDimension(next)
  }

  // Stable so TranscriptView's IntersectionObserver isn't rebuilt every render
  // (events.log is stable across renders; the events object identity is not).
  const handleSegmentView = useCallback(
    (segId: number, start: number, risk: Risk) =>
      events.log('segment_view', {
        segment_id: segId,
        segment_start: start,
        segment_risk: risk,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  // Debounced (in TranscriptView) hover-dwell signal — a lightweight attention
  // proxy that complements segment_view/segment_focus now that hovering reveals
  // word-level risk without a click.
  const handleSegmentHover = useCallback(
    (segId: number, start: number, risk: Risk) =>
      events.log('segment_hover', {
        segment_id: segId,
        segment_start: start,
        segment_risk: risk,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )

  const focusHitFor = useCallback(
    (segId: number, wordIdx: number): FocusWordHit | undefined =>
      showFocus ? focusHitMap.get(`${segId}-${wordIdx}`) : undefined,
    [showFocus, focusHitMap],
  )

  // Accordion toggle: clicking a sentence body expands it to word level (or
  // collapses it). At most one open at a time; logged for the study.
  const handleToggleExpand = useCallback(
    (segId: number) => {
      setExpandedSegmentId((prev) => {
        const next = prev === segId ? null : segId
        if (next != null) {
          const seg = transcript.segments.find((s) => s.id === segId)
          events.log('segment_expand', {
            segment_id: segId,
            segment_start: seg?.start,
            segment_risk: seg ? segRisk(seg) : undefined,
            expand_trigger: 'manual',
          })
        }
        return next
      })
    },
    [transcript, events, segRisk],
  )

  // Single-click a sentence → jump there + play it (transcript-editor style),
  // and pin it open. Pinning is set directly (not via the audio→activeId effect)
  // so the segment shows immediately even if audio is silent / not yet running.
  const playFromSegment = useCallback(
    (segId: number) => {
      const seg = transcript.segments.find((s) => s.id === segId)
      if (!seg) return
      setExpandedSegmentId(segId)
      autoExpandedRef.current = segId
      seekWithLog(seg.start, 'segment')
      if (!audio.isPlaying) audio.togglePlay()
    },
    [transcript, seekWithLog, audio],
  )

  // Play from a specific word's timestamp (the "▶ play from here" popup button).
  // No-op when the word has no start time (case447 / non-Whisper models).
  const playFromWord = useCallback(
    (segId: number, wordIdx: number) => {
      const seg = transcript.segments.find((s) => s.id === segId)
      const word = seg?.words[model]?.[wordIdx]
      if (!seg || word?.start == null) return
      setExpandedSegmentId(segId)
      autoExpandedRef.current = segId
      seekWithLog(word.start, 'word')
      if (!audio.isPlaying) audio.togglePlay()
    },
    [transcript, model, seekWithLog, audio],
  )

  // Unified "Find": lexical first (fast, deterministic) then, in the full
  // build, a local-LLM pass enriches/extends it in the background. The lexical
  // result paints immediately; the AI pass merges in when it returns (and only
  // if this is still the latest run). Study (allowFocusFreeInput=false) stays
  // lexical-only so the C4 manipulation is deterministic/frozen.
  const handleRunFocus = useCallback(async () => {
    const items = parseFocusInput(focusText)
    if (items.length === 0) {
      setFocusResult(null)
      setFocusActive(false)
      return
    }
    const runId = ++focusRunIdRef.current
    setFocusError(null)

    // Study build: focus is FROZEN. Use the pre-baked FocusResult shipped with
    // the clip instead of calling :8000 (which fails on the deployed build) — so
    // the C4 manipulation is deterministic and the study runs fully client-side.
    // A clip with no frozen file (e.g. the dormant general-task Full panel)
    // simply stays inactive rather than hitting the network.
    if (!config.allowFocusFreeInput) {
      const frozen = frozenFocusRef.current
      if (frozen) {
        setFocusResult(frozen)
        setFocusActive(true)
        const hits = frozen.terms.reduce((n, t) => n + t.snippets.length, 0)
        events.log('focus_apply', {
          focus_terms: items.map((i) => i.label).join(', '),
          focus_hits: hits,
          focus_mode: 'lexical',
        })
      }
      return
    }

    setFocusRunning(true)
    let lexical: FocusResult | null = null
    try {
      lexical = await runFocus(transcript, items, model)
      if (focusRunIdRef.current !== runId) return
      setFocusResult(lexical)
      setFocusActive(true)
      const hits = lexical.terms.reduce((n, t) => n + t.snippets.length, 0)
      events.log('focus_apply', {
        focus_terms: items.map((i) => i.label).join(', '),
        focus_hits: hits,
        focus_mode: 'merged',
      })
    } catch (err) {
      const msg =
        err instanceof PredictError
          ? err.message
          : `Focus retrieval failed: ${(err as Error).message}`
      setFocusError(msg)
      setFocusRunning(false)
      return
    }
    setFocusRunning(false)

    // Full build only: enrich with the local LLM in the background. A failure
    // here (Ollama down) only sets the panel error; the lexical hits stay.
    setAiEnriching(true)
    try {
      const ai = await runFocusAi(transcript, parseFocusQueries(focusText))
      if (focusRunIdRef.current !== runId) return
      const merged = mergeFocusResults(lexical, ai)
      setFocusResult(merged)
      const hits = merged.terms.reduce((n, t) => n + t.snippets.length, 0)
      events.log('focus_apply', { focus_hits: hits, focus_mode: 'merged' })
    } catch (err) {
      if (focusRunIdRef.current !== runId) return
      const msg =
        err instanceof PredictError
          ? err.message
          : `AI focus failed: ${(err as Error).message}`
      setFocusError(msg)
    } finally {
      if (focusRunIdRef.current === runId) setAiEnriching(false)
    }
  }, [focusText, transcript, model, events, config.allowFocusFreeInput])

  const handleClearFocus = useCallback(() => {
    focusRunIdRef.current++ // invalidate any in-flight AI merge
    setFocusActive(false)
    setFocusResult(null)
    setFocusError(null)
    setAiEnriching(false)
    events.log('focus_clear')
  }, [events])

  // Outline: ask the local LLM to chapter the whole transcript (cached/frozen
  // server-side). On-demand because it is expensive over long recordings.
  const handleRunOutline = useCallback(async () => {
    setOutlineError(null)
    setOutlineRunning(true)
    try {
      const result = await runOutline(transcript, model)
      setOutlineResult(result)
      const chapterCount = result.parts.reduce((n, p) => n + p.chapters.length, 0)
      events.log('outline_run', {
        part_count: result.parts.length,
        chapter_count: chapterCount,
      })
    } catch (err) {
      const msg =
        err instanceof PredictError
          ? err.message
          : `Outline failed: ${(err as Error).message}`
      setOutlineError(msg)
    } finally {
      setOutlineRunning(false)
    }
  }, [transcript, model, events])

  // Open the outline sub-page; generate on first open (cached afterwards).
  const handleOpenOutline = useCallback(() => {
    setOutlineOpen(true)
    events.log('outline_open')
    if (!outlineResult && !outlineRunning) handleRunOutline()
  }, [events, outlineResult, outlineRunning, handleRunOutline])

  // Jump to a Part / Chapter: seek, log, and (in modal mode) close so the
  // reviewer lands on that passage. When docked, the panel stays open so they
  // can keep navigating beside the transcript.
  const handlePartClick = useCallback(
    (part: OutlinePart) => {
      events.log('outline_part_click', {
        chapter_id: part.id,
        chapter_title: part.title,
        chapter_start: part.segment_start,
        chapter_end: part.segment_end,
        segment_id: part.start_id,
      })
      seekWithLog(part.segment_start, 'marker')
      if (!outlineDocked) setOutlineOpen(false)
    },
    [events, seekWithLog, outlineDocked],
  )

  const handleChapterClick = useCallback(
    (chapter: OutlineChapter) => {
      events.log('outline_chapter_click', {
        chapter_id: chapter.id,
        chapter_title: chapter.title,
        chapter_start: chapter.segment_start,
        chapter_end: chapter.segment_end,
        segment_id: chapter.start_id,
      })
      seekWithLog(chapter.segment_start, 'marker')
      if (!outlineDocked) setOutlineOpen(false)
    },
    [events, seekWithLog, outlineDocked],
  )

  const handleFocusSnippetClick = useCallback(
    (snippet: FocusSnippet, label: string) => {
      events.log('focus_snippet_click', {
        segment_id: snippet.segment_id,
        focus_label: label,
        focus_match_type: snippet.match_type,
        focus_match_detail: snippet.match_detail ?? undefined,
        focus_score: snippet.focus_score,
      })
      seekWithLog(snippet.segment_start, 'marker')
    },
    [events, seekWithLog],
  )

  // ----- Timeline / Conflicts panels (per-version builds) -------------------
  // Join each LLM citation to its segment (start time + text preview) so the
  // panels can seek and show context without re-deriving anything themselves.
  const timelineItems = useMemo<TimelineItem[]>(() => {
    if (!config.timelineView || !timelineResult) return []
    const byId = new Map(transcript.segments.map((s) => [s.id, s]))
    return timelineResult.events.map((e) => ({
      ...e,
      segment_start: byId.get(e.id)?.start ?? 0,
    }))
  }, [config.timelineView, timelineResult, transcript])

  // The strip's risk band consumes the SAME signal the transcript shows:
  // sentence versions → the sentence tint map verbatim; word-mark versions
  // (toolkit) → the per-segment display risk (segRisk), which also drives the
  // transcript head dots — strip and transcript can never disagree.
  const stripTintMap = useMemo(() => {
    if (!config.timelineView) return new Map<number, Risk>()
    if (sentenceLayerActive) return sentenceTintMap
    const m = new Map<number, Risk>()
    for (const s of transcript.segments) {
      const r = segRisk(s)
      if (r === 'high' || r === 'med') m.set(s.id, r)
    }
    return m
  }, [config.timelineView, sentenceLayerActive, sentenceTintMap, transcript, segRisk])

  const conflictItems = useMemo<ConflictItem[]>(() => {
    if (!config.anomalyDetection || !anomalyResult) return []
    const byId = new Map(transcript.segments.map((s) => [s.id, s]))
    const sideOf = (id: number) => {
      const seg = byId.get(id)
      if (!seg) return { start: 0, text: `segment ${id}` }
      const text = (seg.words[model] ?? []).map((w) => w.text).join(' ')
      return { start: seg.start, text }
    }
    return anomalyResult.conflicts.map((c) => {
      const a = sideOf(c.a)
      const b = sideOf(c.b)
      return { ...c, aStart: a.start, bStart: b.start, aText: a.text, bText: b.text }
    })
  }, [config.anomalyDetection, anomalyResult, transcript, model])

  const handleTimelineEventClick = useCallback(
    (item: TimelineItem, trigger: SeekTrigger = 'marker') => {
      events.log('timeline_event_click', {
        segment_id: item.id,
        segment_start: item.segment_start,
      })
      seekWithLog(item.segment_start, trigger)
    },
    [events, seekWithLog],
  )

  const handleConflictJump = useCallback(
    (segId: number, start: number, item: ConflictItem) => {
      events.log('anomaly_jump', {
        segment_id: segId,
        partner_id: segId === item.a ? item.b : item.a,
        anomaly_type: item.type,
      })
      seekWithLog(start, 'marker')
    },
    [events, seekWithLog],
  )

  // ----- Assistant chat (full build, config.allowChat) ---------------------
  // Content is NEVER logged — only metadata (turn index, lengths, counts).
  const handleChatSend = useCallback(
    async (text: string) => {
      const runId = ++chatRunIdRef.current
      const turn = chatMessages.filter((m) => m.role === 'user').length + 1
      const history = chatMessages.map((m) => ({ role: m.role, content: m.content }))
      setChatMessages((prev) => [...prev, { role: 'user', content: text }])
      setChatError(null)
      setChatThinking(true)
      events.log('chat_send', { chat_turn: turn, chat_chars: text.length })
      const t0 = performance.now()
      try {
        const res = await runChat(transcript, [...history, { role: 'user', content: text }])
        if (chatRunIdRef.current !== runId) return // cleared / superseded
        setChatMessages((prev) => [
          ...prev,
          { role: 'assistant', content: res.answer, citations: res.citations },
        ])
        events.log('chat_answer', {
          chat_turn: turn,
          chat_chars: res.answer.length,
          chat_citations: res.citations.length,
          chat_latency_ms: Math.round(performance.now() - t0),
        })
      } catch (err) {
        if (chatRunIdRef.current !== runId) return
        setChatError(
          err instanceof PredictError ? err.message : `Assistant failed: ${(err as Error).message}`,
        )
      } finally {
        if (chatRunIdRef.current === runId) setChatThinking(false)
      }
    },
    [chatMessages, transcript, events],
  )

  const handleChatCitationClick = useCallback(
    (c: ChatCitation) => {
      events.log('chat_citation_click', {
        segment_id: c.id,
        segment_start: c.segment_start,
      })
      seekWithLog(c.segment_start, 'marker')
    },
    [events, seekWithLog],
  )

  const handleChatClear = useCallback(() => {
    chatRunIdRef.current++ // invalidate any in-flight request
    events.log('chat_clear', {
      chat_turn: chatMessages.filter((m) => m.role === 'user').length,
    })
    setChatMessages([])
    setChatError(null)
    setChatThinking(false)
  }, [events, chatMessages])

  // ---- Upload handlers ----

  // Shared "load this transcript into the app" path: validate, swap it in,
  // reset reviewer state, then annotate it via the importance classifier.
  // Used by manual JSON upload AND by auto-transcription of uploaded audio.
  const applyTranscript = useCallback(
    async (parsed: unknown, sourceName: string) => {
      // Teammate ASR pipeline JSON (nested sentences + sentence confidence) is
      // adapted to our flat Transcript before validation; a normal Transcript
      // passes straight through (guard is false).
      const input = isAsrPipelineOutput(parsed) ? adaptAsrPipelineOutput(parsed) : parsed
      const result = validateTranscript(input)
      if (!result.ok) {
        setErrorMsg(`${sourceName}: ${result.error}`)
        return
      }
      setTranscript(result.transcript)
      originalTranscriptRef.current = result.transcript
      // Keep the untouched backend JSON (pre-adapter) for the raw export.
      rawSourceRef.current = parsed
      setTranscriptFilename(sourceName)
      const pickedModel = modelsOf(result.transcript)[0]
      setModel(pickedModel)
      setEdits({})
      setSegmentTextEdits({})
      setVerified({})
      setHistory([])
      setPopup(null)
      setExpandedSegmentId(null)
      autoExpandedRef.current = null
      // A new transcript invalidates any prior focus retrieval + outline +
      // triage ranking + assistant conversation (their citations point into
      // the old transcript). The triage/anomaly/timeline effects re-fetch for
      // the new transcript on their own when their paradigm needs them.
      setFocusResult(null)
      setFocusActive(false)
      setOutlineResult(null)
      setOutlineError(null)
      setTriageResult(null)
      chatRunIdRef.current++
      setChatMessages([])
      setChatError(null)
      setChatThinking(false)
      events.log('transcript_load', {
        transcript_filename: sourceName,
        segment_count: result.transcript.segments.length,
        audio_duration: result.transcript.audioDuration,
      })

      // Fire off importance prediction. If the local service is down we surface
      // a clear error but leave the unannotated transcript loaded so the
      // reviewer can still work in `uncertainty` view.
      if (config.livePredict) {
        setPredicting(true)
        try {
          const annotated = await predictRisks(result.transcript, pickedModel)
          setTranscript(annotated)
          originalTranscriptRef.current = annotated
        } catch (err) {
          const msg =
            err instanceof PredictError
              ? err.message
              : `Prediction failed: ${(err as Error).message}`
          setErrorMsg(msg)
        } finally {
          setPredicting(false)
        }
      }
    },
    [events, config],
  )

  // Auto-transcribe an audio file via the ASR service (:8001), then load the
  // resulting transcript. If the service is off, the audio still loaded for
  // playback above and we surface a clear, non-fatal message — nothing breaks.
  // `numSpeakers` is the reviewer-set diarisation hint (TopBar "Speakers" box);
  // null = automatic detection.
  const [numSpeakers, setNumSpeakers] = useState<number | null>(null)
  const transcribeAndApply = useCallback(
    async (file: Blob) => {
      setTranscribing(true)
      try {
        const transcript = await transcribeAudio(file, numSpeakers)
        const name = file instanceof File ? file.name : 'recording'
        await applyTranscript(transcript, `${name} (auto-transcribed)`)
      } catch (err) {
        const msg =
          err instanceof PredictError
            ? err.message
            : `Transcription failed: ${(err as Error).message}`
        setErrorMsg(msg)
      } finally {
        setTranscribing(false)
      }
    },
    [applyTranscript, numSpeakers],
  )

  // Run the ASR models on the currently-loaded audio. Explicit (not on upload)
  // so a saved transcript can be paired with its audio without re-transcribing.
  const handleTranscribe = useCallback(() => {
    if (!audioBlob || transcribing) return
    const file =
      audioBlob instanceof File
        ? audioBlob
        : new File([audioBlob], audioFilename ?? 'recording')
    void transcribeAndApply(file)
  }, [audioBlob, audioFilename, transcribing, transcribeAndApply])

  const handleAudioUpload = useCallback(
    (file: File) => {
      setErrorMsg(null)
      setAudioBlob(file)
      setAudioFilename(file.name)
      setRecordingDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return null
      })
      events.log('audio_load', { audio_filename: file.name })
      // Audio is loaded for playback only — running the ASR models is a
      // separate, explicit "Transcribe" action.
    },
    [events],
  )

  const recorder = useRecorder({ onError: (msg) => setErrorMsg(msg) })

  const handleRecordToggle = useCallback(async () => {
    if (recorder.isRecording) {
      const result = await recorder.stop()
      if (!result) return
      const { blob, mimeType } = result
      const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
      const ext = extensionForMime(mimeType)
      const name = `recording-${ts}.${ext}`
      setErrorMsg(null)
      setAudioBlob(blob)
      setAudioFilename(name)
      setRecordingDownloadUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev)
        return URL.createObjectURL(blob)
      })
      events.log('audio_load', { audio_filename: name })
      // Loaded for playback; use the Transcribe button to run the ASR models.
    } else {
      setErrorMsg(null)
      await recorder.start()
    }
  }, [recorder, events])

  // Revoke the recording download URL on unmount.
  useEffect(() => {
    return () => {
      if (recordingDownloadUrl) URL.revokeObjectURL(recordingDownloadUrl)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleTranscriptUpload = useCallback(
    async (file: File) => {
      setErrorMsg(null)
      try {
        const text = await file.text()
        let parsed: unknown
        try {
          parsed = JSON.parse(text)
        } catch {
          setErrorMsg(`${file.name}: invalid JSON.`)
          return
        }
        await applyTranscript(parsed, file.name)
      } catch (e) {
        setErrorMsg(`${file.name}: ${(e as Error).message}`)
      }
    },
    [applyTranscript],
  )

  const dragActive = useFileDrop({
    onAudio: handleAudioUpload,
    onJson: handleTranscriptUpload,
    onError: (msg) => setErrorMsg(msg),
  })

  // ---- Keyboard shortcuts (seek calls go through seekWithLog → 'keyboard') ----
  useKeyboardShortcuts({
    transcript,
    currentTime: audio.currentTime,
    togglePlay: togglePlayWithRewind,
    seek: (t) => seekWithLog(t, 'keyboard'),
    toggleVerify,
    replaySegment: replayCurrentSegment,
  })

  // ---- Wrapped exporter to log every download ----
  const wrappedAuditExport = (kind: string, count: number) => {
    events.log('export', { export_kind: kind, segment_count: count })
  }

  // ---- Derived values ----
  const popupSegment = popup
    ? transcript.segments.find((s) => s.id === popup.segId)
    : null

  const popupEdit = popup ? edits[`${popup.segId}-${popup.wordIdx}`] : undefined
  // For a rewritten segment the popup word is displayed from the override string
  // (edits is empty), so read the current text from that override token — else
  // the no-op guard and the "current" highlight in the popup are wrong.
  const popupOverride = popup ? segmentTextEdits[popup.segId]?.text : undefined
  const popupCurrentText = popup
    ? popupOverride != null && popupSegment
      ? keptTokenPosition(
          popupOverride,
          popupSegment.words[model] ?? [],
          popupSegment.start,
          popupSegment.end,
          popup.wordIdx,
        )?.token ?? popupSegment.words[model]?.[popup.wordIdx]?.text ?? ''
      : popupEdit?.text ?? popupSegment?.words[model]?.[popup.wordIdx]?.text ?? ''
    : ''
  const popupIsDeleted = popupEdit?.deleted === true

  // How many tokens (active model) currently display the same text as the popup
  // word — drives the "apply to all N" affordance for batch correction.
  const sameTokenCount = useMemo(() => {
    if (!popup || !popupCurrentText || popupIsDeleted) return 0
    let n = 0
    for (const s of transcript.segments) {
      const ws = s.words[model] ?? []
      ws.forEach((w, i) => {
        const e = edits[`${s.id}-${i}`]
        if (e?.deleted) return
        if ((e?.text ?? w.text) === popupCurrentText) n += 1
      })
    }
    return n
  }, [popup, popupCurrentText, popupIsDeleted, transcript, model, edits])

  const verifiedCount = Object.values(verified).filter(Boolean).length
  const totalSegments = transcript.segments.length

  // How many high-risk segments are still unverified — the reviewer's "how much
  // dangerous stuff is left" signal. null when no risk layer is shown (C1).
  const highRiskRemaining = useMemo<number | null>(() => {
    if (activeHighlight === 'none') return null
    return transcript.segments.reduce((n, s) => {
      return segRisk(s) === 'high' && !verified[s.id] ? n + 1 : n
    }, 0)
  }, [transcript, segRisk, activeHighlight, verified])

  // Latest edit per segment (reviewer + hh:mm) for the "edited · who · time"
  // tag. History is newest-first, so the first hit per segment is the latest.
  const editInfo = useMemo(() => {
    const map: Record<number, { reviewer: string; time: string }> = {}
    for (const h of history) {
      if (h.segmentId == null || map[h.segmentId]) continue
      if (h.kind === 'verify' || h.kind === 'unverify') continue
      map[h.segmentId] = { reviewer: h.reviewer, time: h.timestamp.slice(0, 5) }
    }
    return map
  }, [history])

  return (
    <div
      className={`relative h-full flex flex-col bg-surface${
        interactionLocked ? ' pointer-events-none select-none opacity-60' : ''
      }`}
    >
      {/* Echo-style brand banner (no police logo). */}
      <div className="flex items-center gap-3 px-5 h-9 bg-brand text-white shrink-0">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
          <path d="M4 2.5h6l2.5 2.5v8.5H4z" strokeLinejoin="round" />
          <path d="M9.5 2.5V5h2.5M6 8h4M6 10.5h4" strokeLinecap="round" />
        </svg>
        <span className="text-[13px] font-semibold tracking-wide">Transcript review</span>
        {config.mode === 'study' && (
          <span className="text-[11px] bg-white/15 border border-white/25 rounded-full px-2.5 py-0.5 font-medium">
            Condition {effectiveCondition}
          </span>
        )}
        {/* Persistent Help — jumps to the reviewer guide. Replaces the old
            "AI-assisted · human-verified" tagline so a single main page still
            has an always-visible way into the manual. */}
        <a
          href="/guide.html"
          target="_blank"
          rel="noopener noreferrer"
          title="Help — open the reviewer guide"
          aria-label="Help — open the reviewer guide"
          className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-white/85 hover:text-white transition-colors"
        >
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            <circle cx="8" cy="8" r="6.5" />
            <path d="M6.2 6.2a1.9 1.9 0 1 1 2.4 1.85c-.55.27-.72.56-.72 1.05M8 11.4v.01" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span className="hidden sm:inline">Help</span>
        </a>
      </div>

      <TopBar
        model={model}
        availableModels={availableModels}
        onModelChange={handleModelChange}
        audioFilename={audioFilename}
        transcriptFilename={transcriptFilename}
        onUploadAudio={handleAudioUpload}
        onUploadTranscript={handleTranscriptUpload}
        recording={recorder.isRecording}
        recordingElapsedMs={recorder.elapsedMs}
        recordingSupported={recorder.supported}
        onToggleRecord={handleRecordToggle}
        recordingDownloadUrl={recordingDownloadUrl}
        recordingDownloadName={
          recordingDownloadUrl && audioFilename ? audioFilename : null
        }
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        nameFlash={nameFlashNonce}
        allowRiskRegime={config.allowRiskRegimeToggle}
        riskRegime={riskRegime}
        onRiskRegimeChange={setRiskRegime}
        allowUpload={config.allowUpload}
        allowRecord={config.allowRecord}
        allowTranscribe={config.allowAutoTranscribe}
        canTranscribe={!!audioBlob}
        transcribing={transcribing}
        onTranscribe={handleTranscribe}
        // Rough time model for the progress bar (no real signal from the ASR
        // service): local 4-model ensemble runs ≈6× realtime + ~25s overhead
        // (measured: ~50s audio → ~4.5min; ~2min → ~12–18min).
        transcribeEstimateSec={25 + 6 * (audio.duration > 0 ? audio.duration : 60)}
        numSpeakers={numSpeakers}
        onNumSpeakersChange={setNumSpeakers}
        allowChangeToggle={config.allowChangeToggle}
        showChanges={showChanges}
        onToggleChanges={() => setShowChanges((v) => !v)}
        allowThemeToggle={config.allowThemeToggle}
        theme={theme}
        onToggleTheme={toggleTheme}
        triageRunning={triageRunning}
      />

      {transcribing && (
        <div className="bg-focus-bg border-b border-focus/30 px-4 py-2 flex items-center gap-2">
          <svg className="animate-spin shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <p className="text-xs text-focus">
            <span className="font-semibold mr-2">Transcribing</span>
            Running the ASR models on your audio — this can take a few minutes for
            long recordings. You can keep listening while it works.
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="bg-risk-high-bg border-b border-risk-high/30 px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-risk-high">
            <span className="font-semibold mr-2">Upload error</span>
            {errorMsg}
          </p>
          <button
            onClick={() => setErrorMsg(null)}
            className="text-risk-high hover:text-ink text-xs font-mono"
            aria-label="Dismiss error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Standing reminder that the transcript is machine-generated. Dismissible
          (reappears on reload, so the legal notice is never permanently gone). */}
      {!warningDismissed && (
        <div className="bg-warning-bg border-l-4 border-warning-border pl-4 pr-2 py-1.5 shrink-0 flex items-start gap-2">
          <p className="text-[11px] text-warning leading-snug flex-1">
            <span className="font-semibold">AI-generated transcript.</span> Check it
            carefully before relying on it — it isn't evidential until a person has
            reviewed and confirmed it.
          </p>
          <button
            onClick={() => setWarningDismissed(true)}
            aria-label="Dismiss notice"
            title="Dismiss"
            className="shrink-0 text-warning/70 hover:text-warning p-0.5 rounded hover:bg-warning-border/10"
          >
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        {config.allowOutline && outlineOpen && outlineDocked && (
          <OutlineModal
            result={outlineResult}
            running={outlineRunning}
            error={outlineError}
            audioDuration={transcript.audioDuration}
            currentTime={audio.currentTime}
            onRegenerate={handleRunOutline}
            onClose={() => setOutlineOpen(false)}
            onPartClick={handlePartClick}
            onChapterClick={handleChapterClick}
            onToggleDock={() => setOutlineDocked(false)}
          />
        )}
        {/* Left column: Find (both builds) + Assistant tab (full build only).
            One shared collapse flag; the collapsed rail carries both labels
            when the assistant exists, else FocusPanel's own rail runs. */}
        {focusEnabled &&
          (config.allowChat && focusCollapsed ? (
            <CollapsedLeftRail
              findHits={
                focusActive && focusResult
                  ? focusResult.terms.reduce((n, t) => n + t.snippets.length, 0)
                  : null
              }
              onExpand={(tab) => {
                setLeftTab(tab)
                setFocusCollapsed(false)
              }}
              onOpenOutline={config.allowOutline ? handleOpenOutline : undefined}
              showTimeline={config.timelineView}
              showConflicts={config.anomalyDetection}
              conflictCount={anomalyResult ? anomalyResult.conflicts.length : null}
            />
          ) : config.allowChat && leftTab === 'chat' ? (
            <ChatPanel
              messages={chatMessages}
              thinking={chatThinking}
              error={chatError}
              onSend={handleChatSend}
              onClear={handleChatClear}
              onCitationClick={handleChatCitationClick}
              tabStrip={
                <LeftTabStrip
                  active="chat"
                  onSelect={setLeftTab}
                  onOpenOutline={config.allowOutline ? handleOpenOutline : undefined}
                  showTimeline={config.timelineView}
                  showConflicts={config.anomalyDetection}
                />
              }
              onToggleCollapse={() => setFocusCollapsed(true)}
            />
          ) : config.timelineView && leftTab === 'timeline' ? (
            <TimelinePanel
              items={timelineItems}
              running={timelineRunning}
              error={timelineError}
              onEventClick={handleTimelineEventClick}
              onRetry={() => setTimelineNonce((n) => n + 1)}
              onToggleCollapse={() => setFocusCollapsed(true)}
              hoveredIndex={hoveredEventIndex}
              onEventHover={setHoveredEventIndex}
              activeSegmentId={activeId}
              tabStrip={
                <LeftTabStrip
                  active="timeline"
                  onSelect={setLeftTab}
                  onOpenOutline={config.allowOutline ? handleOpenOutline : undefined}
                  showTimeline={config.timelineView}
                  showConflicts={config.anomalyDetection}
                />
              }
            />
          ) : config.anomalyDetection && leftTab === 'conflicts' ? (
            <ConflictPanel
              items={conflictItems}
              running={anomalyRunning}
              error={anomalyError}
              onJump={handleConflictJump}
              onRetry={() => setAnomalyNonce((n) => n + 1)}
              onToggleCollapse={() => setFocusCollapsed(true)}
              tabStrip={
                <LeftTabStrip
                  active="conflicts"
                  onSelect={setLeftTab}
                  onOpenOutline={config.allowOutline ? handleOpenOutline : undefined}
                  showTimeline={config.timelineView}
                  showConflicts={config.anomalyDetection}
                />
              }
            />
          ) : (
            <FocusPanel
              text={focusText}
              onTextChange={setFocusText}
              onRun={handleRunFocus}
              onClear={handleClearFocus}
              running={focusRunning}
              aiEnriching={aiEnriching}
              active={focusActive}
              result={focusResult}
              error={focusError}
              readOnly={!config.allowFocusFreeInput}
              collapsed={config.allowChat ? false : focusCollapsed}
              onToggleCollapse={() => setFocusCollapsed((v) => !v)}
              onSnippetClick={handleFocusSnippetClick}
              tabStrip={
                config.allowChat ? (
                  <LeftTabStrip
                    active="find"
                    onSelect={setLeftTab}
                    onOpenOutline={config.allowOutline ? handleOpenOutline : undefined}
                    showTimeline={config.timelineView}
                    showConflicts={config.anomalyDetection}
                  />
                ) : undefined
              }
            />
          ))}
        <TranscriptView
          transcript={transcript}
          model={model}
          currentTime={audio.currentTime}
          edits={edits}
          verified={verified}
          dimension={activeHighlight}
          displayRiskMap={displayRiskMap}
          expandedSegmentId={expandedSegmentId}
          onToggleExpand={handleToggleExpand}
          onPlaySegment={playFromSegment}
          collapsedHighUnderline={config.collapsedHighUnderline}
          showViewControls={activeHighlight !== 'none'}
          focusActive={showFocus}
          focusSegmentIds={focusSegmentIds}
          focusHitFor={focusHitFor}
          sentenceTintMap={sentenceLayerActive ? sentenceTintMap : undefined}
          sentenceTintTitleFor={sentenceLayerActive ? sentenceTintTitleFor : undefined}
          // Pure sentence version (sentence tint is the only in-text signal):
          // the "Show" control re-tints instead of hiding segments.
          sentenceHighlightControl={config.sentenceUncertainty && !config.wordMarks}
          keepRiskDot={config.anomalyDetection}
          wordDimension={config.wordMarks ? undefined : 'none'}
          sentenceSignal={
            config.sentenceUncertainty && config.allowSentenceSignalToggle
              ? sentenceSignal
              : undefined
          }
          onSentenceSignalChange={
            config.sentenceUncertainty && config.allowSentenceSignalToggle
              ? handleSentenceSignalChange
              : undefined
          }
          wordDimensionValue={
            config.allowFreeDimension && config.wordMarks ? dimension : undefined
          }
          onWordDimensionChange={
            config.allowFreeDimension && config.wordMarks ? handleDimensionChange : undefined
          }
          sentenceSignalBusy={triageRunning}
          onSeek={(t) => seekWithLog(t, 'segment')}
          onWordClick={openPopup}
          onToggleVerify={toggleVerify}
          onBulkVerify={verifyMany}
          segmentTextEdits={segmentTextEdits}
          onEditSentence={editSentence}
          onMergeNext={mergeWithNext}
          onChangeSpeaker={changeSpeaker}
          editMode={editMode}
          onEditModeChange={config.allowEditModeToggle ? handleEditModeChange : undefined}
          onFilterChange={(filter) => events.log('filter_change', { filter })}
          showHighlightLevel={config.allowHighlightLevelToggle}
          onHighlightLevelChange={(level) =>
            events.log('filter_change', { filter: `highlights:${level}` })
          }
          defaultHighlightLevel={config.defaultHighlightLevel}
          defaultRevealAll={config.defaultRevealAll}
          showRevealAll={config.allowRevealAllToggle}
          onRevealAllChange={(revealAll) =>
            events.log('filter_change', { filter: `marks:${revealAll ? 'always' : 'hover'}` })
          }
          onSegmentView={handleSegmentView}
          onSegmentHover={handleSegmentHover}
          showChanges={showChanges}
          editInfo={editInfo}
        />
        <HistorySidebar
          history={history}
          verified={verified}
          verifiedCount={verifiedCount}
          totalSegments={totalSegments}
          highRiskRemaining={highRiskRemaining}
          transcript={transcript}
          model={model}
          edits={edits}
          segmentTextEdits={segmentTextEdits}
          sourceTranscript={originalTranscriptRef.current}
          rawSource={rawSourceRef.current}
          reviewer={reviewer}
          audioFilename={audioFilename}
          transcriptFilename={transcriptFilename}
          onExport={wrappedAuditExport}
          collapsed={auditCollapsed}
          onToggleCollapse={() => setAuditCollapsed((v) => !v)}
        />
      </div>

      {/* Full-width time-proportional timeline strip (timeline build only):
          event markers + risk heat band + verified progress + playhead. */}
      {config.timelineView && (
        <TimelineStrip
          segments={transcript.segments}
          duration={audio.duration > 0 ? audio.duration : transcript.audioDuration}
          currentTime={audio.currentTime}
          items={timelineItems}
          running={timelineRunning}
          tintMap={stripTintMap}
          verified={verified}
          activeSegmentId={activeId}
          hoveredEventIndex={hoveredEventIndex}
          onEventHover={setHoveredEventIndex}
          onEventClick={(item) => handleTimelineEventClick(item, 'timeline')}
          onTrackSeek={(s) => seekWithLog(s, 'timeline')}
          open={timelineStripOpen}
          onToggle={() => setTimelineStripOpen((v) => !v)}
        />
      )}

      {/* Page-bottom playback bar (reviewer + transport + speed). The keyboard-
          shortcuts / researcher panel sits at the far right, after Speed. */}
      <PlayerBar
        audio={audio}
        onSpeedChange={handleSpeedChange}
        onTogglePlay={togglePlayWithRewind}
        onSkip={(delta) =>
          seekWithLog(Math.max(0, Math.min(audio.duration, audio.currentTime + delta)), 'keyboard')
        }
        trailing={
          <ShortcutLegend
            getEvents={events.getEvents}
            onExport={(kind, count) =>
              events.log('export', { export_kind: kind, segment_count: count })
            }
            participantId={participantId}
            condition={condition}
            onParticipantChange={setParticipantId}
            onConditionChange={setCondition}
          />
        }
      />

      {popup && popupSegment && (
        <CandidatePopup
          anchor={popup}
          segment={popupSegment}
          availableModels={availableModels}
          activeModel={model}
          currentText={popupCurrentText}
          isDeleted={popupIsDeleted}
          // Apply-to-all and Split both operate on the edits map / transcript
          // segments and would desync a textOverride, so they're disabled for a
          // rewritten segment's words (candidate / manual / delete still work).
          sameTokenCount={popupOverride != null ? 0 : sameTokenCount}
          onApply={applyEdit}
          onApplyAll={applyEditAll}
          onDelete={deleteWord}
          onClose={closePopup}
          onSplit={popupOverride != null ? undefined : () => splitSegment(popup.segId, popup.wordIdx)}
          onPlayFromWord={(s, w) => {
            playFromWord(s, w)
            closePopup()
          }}
        />
      )}

      {config.allowOutline && outlineOpen && !outlineDocked && (
        <OutlineStoryboard
          result={outlineResult}
          running={outlineRunning}
          error={outlineError}
          audioDuration={transcript.audioDuration}
          currentTime={audio.currentTime}
          onRegenerate={handleRunOutline}
          onClose={() => setOutlineOpen(false)}
          onPartClick={handlePartClick}
          onChapterClick={handleChapterClick}
          onDock={() => setOutlineDocked(true)}
        />
      )}

      {dragActive && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div className="absolute inset-2 border-2 border-dashed border-ink/30 rounded-lg bg-surface/60 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-surface border border-border rounded-md shadow-lg px-4 py-3 text-center">
              <p className="text-xs text-ink font-medium mb-0.5">Drop file to load</p>
              <p className="text-[11px] text-ink-faint">
                Audio (.wav / .mp3 / .m4a) or transcript (.json)
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
