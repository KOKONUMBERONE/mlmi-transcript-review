import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import PlayerBar from '../components/PlayerBar'
import TranscriptView from '../components/TranscriptView'
import HistorySidebar from '../components/HistorySidebar'
import FocusPanel from '../components/FocusPanel'
import OutlineModal from '../components/OutlineModal'
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
import { transcribeAudio } from '../lib/transcribeApi'
import { segmentRiskWithFocus } from '../lib/segmentRisk'
import { buildDisplayRiskMap, combinedSegmentRisk } from '../lib/displayRisk'
import type {
  Condition,
  EditState,
  FocusResult,
  FocusSnippet,
  FocusWordHit,
  HighlightLayer,
  HistoryEntry,
  ModelName,
  OutlineChapter,
  OutlinePart,
  OutlineResult,
  Risk,
  RiskDimension,
  SeekTrigger,
  Segment,
  Transcript,
  Word,
} from '../types'
import type { RiskRegime, WorkspaceConfig } from './config'
import { RISK_POLICY_BY_REGIME } from './config'
import { CONDITION_CONFIG } from './conditions'

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
  difficulty: string
  stimulusId: string
  timeBudgetMs: number
  focusTerms?: string
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
  const [transcriptFilename, setTranscriptFilename] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioFilename, setAudioFilename] = useState<string | null>(null)
  // Object URL for the "Download recording" affordance. Owned here so we can
  // revoke it cleanly when a new recording arrives or the file changes.
  const [recordingDownloadUrl, setRecordingDownloadUrl] = useState<string | null>(null)
  // UI: collapsible side panels + shift-click range-verify anchor.
  const [focusCollapsed, setFocusCollapsed] = useState(false)
  const [auditCollapsed, setAuditCollapsed] = useState(false)
  const verifyAnchorRef = useRef<number | null>(null)
  // Track-changes view. Always on in the study (constant across C1–C4); the
  // full build defaults it on but lets the reviewer switch to a clean read.
  const [showChanges, setShowChanges] = useState(true)
  // The standing "AI-generated" notice can be dismissed (session-level — it
  // reappears on reload so the legal reminder is never permanently gone).
  const [warningDismissed, setWarningDismissed] = useState(false)

  const availableModels = useMemo(() => modelsOf(transcript), [transcript])
  const [model, setModel] = useState<ModelName>(availableModels[0])
  const [reviewer, setReviewer] = useState<string>('')
  const [participantId, setParticipantId] = useState<string>('')
  const [condition, setCondition] = useState<string>('')

  const [edits, setEdits] = useState<Record<string, EditState>>({})
  // #1 whole-sentence rewrites, keyed by segment id (supersede per-word edits).
  const [segmentTextEdits, setSegmentTextEdits] = useState<
    Record<number, { text: string; reason?: string }>
  >({})
  const [verified, setVerified] = useState<Record<number, boolean>>({})
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [popup, setPopup] = useState<PopupAnchor | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [speed, setSpeed] = useState<number>(1)

  // Which risk dimension drives word colouring. Default to the combined
  // signal — that's the one the 2x2 policy is designed for.
  const [dimension, setDimension] = useState<RiskDimension>('combined')
  const [predicting, setPredicting] = useState<boolean>(false)
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
  // Focus-only error (e.g. the AI pass when Ollama isn't running). Kept separate
  // from the global `errorMsg` banner so a missing local LLM degrades
  // gracefully: it surfaces *inside* the panel and never blocks lexical search
  // or the rest of the app.
  const [focusError, setFocusError] = useState<string | null>(null)

  // ---- Outline (long-transcript chapters) — local-LLM navigation overlay ----
  const [outlineResult, setOutlineResult] = useState<OutlineResult | null>(null)
  const [outlineRunning, setOutlineRunning] = useState<boolean>(false)
  const [outlineError, setOutlineError] = useState<string | null>(null)

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
  const activeHighlight: HighlightLayer = config.allowFreeDimension
    ? dimension
    : conditionCfg.highlight
  const focusEnabled = config.allowFreeDimension ? true : conditionCfg.focus
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
    setVerified({})
    setHistory([])
    setPopup(null)
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
    })
    events.log('trial_start', { time_budget_ms: trial.timeBudgetMs })
  }, [trial, events])
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
  // Waveform markers reflect the *active* risk dimension, so toggling the
  // toolbar switch repaints the audio strip too.
  const riskMarkers = useMemo(
    () =>
      transcript.segments.map((s) => ({
        segmentId: s.id,
        start: s.start,
        end: s.end,
        risk: segRisk(s),
      })),
    [transcript, segRisk],
  )

  const audio = useAudio(audioBlob, transcript.audioDuration, {
    onError: (msg) => setErrorMsg(msg),
    riskMarkers,
    onPlay: (position) => events.log('play', { audio_position: position }),
    onPause: (position) => events.log('pause', { audio_position: position }),
    onWaveformSeek: (from, to) =>
      events.log('seek', {
        from_position: from,
        to_position: to,
        trigger: 'waveform',
      }),
    onRegionClick: (marker, fromPos) =>
      events.log('seek', {
        from_position: fromPos,
        to_position: marker.start,
        trigger: 'marker',
        segment_id: marker.segmentId,
        segment_risk: marker.risk,
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

  // ---- Audit-trail logger ----
  const currentReviewer = (): string =>
    reviewer.trim() === '' ? UNKNOWN_REVIEWER : reviewer.trim()

  const logEntry = (entry: Omit<HistoryEntry, 'id' | 'timestamp' | 'reviewer'>) =>
    setHistory((prev) => [
      {
        id: nextEntryId(),
        timestamp: nowStamp(),
        reviewer: currentReviewer(),
        ...entry,
      },
      ...prev,
    ])

  // ---- Popup ----
  const openPopup = (segId: number, wordIdx: number, rect: DOMRect) => {
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
  }

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
    const key = `${popup.segId}-${popup.wordIdx}`
    const original = originalTextAt(popup.segId, popup.wordIdx)
    const previous = edits[key]
    const wasDeleted = previous?.deleted === true
    const fromDisplay = wasDeleted ? '(deleted)' : previous?.text ?? original

    if (!wasDeleted && newText === fromDisplay) {
      closePopup()
      return
    }

    // Heuristic: if newText matches a candidate at this word index in any
    // model, attribute via='candidate', else 'manual'.
    const segment = transcript.segments.find((s) => s.id === popup.segId)
    const candidates = new Set<string>()
    if (segment) {
      for (const m of availableModels) {
        const w = segment.words[m]?.[popup.wordIdx]
        if (w?.text) candidates.add(w.text)
      }
    }
    const via: 'candidate' | 'manual' = candidates.has(newText) ? 'candidate' : 'manual'
    // Which ASR model(s) produced the chosen candidate — a token-level "this
    // model was right" label for the consensus/combine analysis. undefined for
    // manual corrections.
    const chosenModel =
      via === 'candidate'
        ? availableModels
            .filter((m) => segment?.words[m]?.[popup.wordIdx]?.text === newText)
            .join('|') || undefined
        : undefined
    const origWord = segment?.words[model]?.[popup.wordIdx]

    setEdits((prev) => ({
      ...prev,
      [key]: { text: newText, deleted: false, reason },
    }))
    logEntry({
      kind: 'edit',
      segmentId: popup.segId,
      wordIndex: popup.wordIdx,
      from: fromDisplay,
      to: newText,
      reason,
    })

    events.log(wasDeleted ? 'word_restore' : 'edit_apply', {
      segment_id: popup.segId,
      word_index: popup.wordIdx,
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

    events.log('popup_close', {
      segment_id: popup.segId,
      word_index: popup.wordIdx,
    })
    setPopup(null)
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

  const focusHitFor = useCallback(
    (segId: number, wordIdx: number): FocusWordHit | undefined =>
      showFocus ? focusHitMap.get(`${segId}-${wordIdx}`) : undefined,
    [showFocus, focusHitMap],
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
    if (!config.allowFocusFreeInput) return
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

  // ---- Upload handlers ----

  // Shared "load this transcript into the app" path: validate, swap it in,
  // reset reviewer state, then annotate it via the importance classifier.
  // Used by manual JSON upload AND by auto-transcription of uploaded audio.
  const applyTranscript = useCallback(
    async (parsed: unknown, sourceName: string) => {
      const result = validateTranscript(parsed)
      if (!result.ok) {
        setErrorMsg(`${sourceName}: ${result.error}`)
        return
      }
      setTranscript(result.transcript)
      originalTranscriptRef.current = result.transcript
      setTranscriptFilename(sourceName)
      const pickedModel = modelsOf(result.transcript)[0]
      setModel(pickedModel)
      setEdits({})
      setSegmentTextEdits({})
      setVerified({})
      setHistory([])
      setPopup(null)
      // A new transcript invalidates any prior focus retrieval + outline.
      setFocusResult(null)
      setFocusActive(false)
      setOutlineResult(null)
      setOutlineError(null)
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
  const transcribeAndApply = useCallback(
    async (file: Blob) => {
      setTranscribing(true)
      try {
        const transcript = await transcribeAudio(file)
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
    [applyTranscript],
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
  const popupCurrentText = popup
    ? popupEdit?.text ?? popupSegment?.words[model]?.[popup.wordIdx]?.text ?? ''
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
        <span className="ml-auto text-[11px] text-brand-active/90 hidden sm:inline">
          AI-assisted · human-verified
        </span>
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
        dimension={dimension}
        onDimensionChange={handleDimensionChange}
        predicting={predicting}
        showRiskSelect={config.allowFreeDimension}
        allowRiskRegime={config.allowRiskRegimeToggle}
        riskRegime={riskRegime}
        onRiskRegimeChange={setRiskRegime}
        allowUpload={config.allowUpload}
        allowRecord={config.allowRecord}
        allowTranscribe={config.allowAutoTranscribe}
        canTranscribe={!!audioBlob}
        transcribing={transcribing}
        onTranscribe={handleTranscribe}
        allowOutline={config.allowOutline}
        onOpenOutline={handleOpenOutline}
        allowChangeToggle={config.allowChangeToggle}
        showChanges={showChanges}
        onToggleChanges={() => setShowChanges((v) => !v)}
      />

      {transcribing && (
        <div className="bg-focus-bg border-b border-focus/30 px-4 py-2 flex items-center gap-2">
          <svg className="animate-spin shrink-0" width="13" height="13" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <p className="text-xs text-focus">
            <span className="font-semibold uppercase tracking-wider mr-2">Transcribing</span>
            Running the ASR models on your audio — this can take a few minutes for
            long recordings. You can keep listening while it works.
          </p>
        </div>
      )}

      {errorMsg && (
        <div className="bg-risk-high-bg border-b border-risk-high/30 px-4 py-2 flex items-center justify-between gap-3">
          <p className="text-xs text-risk-high">
            <span className="font-semibold uppercase tracking-wider mr-2">Upload error</span>
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
            docked
            onToggleDock={() => setOutlineDocked(false)}
          />
        )}
        {focusEnabled && (
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
            collapsed={focusCollapsed}
            onToggleCollapse={() => setFocusCollapsed((v) => !v)}
            onSnippetClick={handleFocusSnippetClick}
          />
        )}
        <TranscriptView
          transcript={transcript}
          model={model}
          currentTime={audio.currentTime}
          edits={edits}
          verified={verified}
          dimension={activeHighlight}
          displayRiskMap={displayRiskMap}
          showViewControls={activeHighlight !== 'none'}
          focusActive={showFocus}
          focusSegmentIds={focusSegmentIds}
          focusHitFor={focusHitFor}
          onSeek={(t) => seekWithLog(t, 'segment')}
          onWordClick={openPopup}
          onToggleVerify={toggleVerify}
          onBulkVerify={verifyMany}
          segmentTextEdits={segmentTextEdits}
          onEditSentence={editSentence}
          onMergeNext={mergeWithNext}
          onChangeSpeaker={changeSpeaker}
          onFilterChange={(filter) => events.log('filter_change', { filter })}
          onSortChange={(sort) => events.log('sort_change', { sort })}
          onSegmentView={handleSegmentView}
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
          reviewer={reviewer}
          audioFilename={audioFilename}
          transcriptFilename={transcriptFilename}
          onExport={wrappedAuditExport}
          collapsed={auditCollapsed}
          onToggleCollapse={() => setAuditCollapsed((v) => !v)}
        />
      </div>

      {/* Page-bottom playback bar (reviewer + transport + speed). */}
      <PlayerBar
        audio={audio}
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        onSpeedChange={handleSpeedChange}
        onTogglePlay={togglePlayWithRewind}
      />

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

      {popup && popupSegment && (
        <CandidatePopup
          anchor={popup}
          segment={popupSegment}
          availableModels={availableModels}
          activeModel={model}
          currentText={popupCurrentText}
          isDeleted={popupIsDeleted}
          sameTokenCount={sameTokenCount}
          onApply={applyEdit}
          onApplyAll={applyEditAll}
          onDelete={deleteWord}
          onClose={closePopup}
          onSplit={() => splitSegment(popup.segId, popup.wordIdx)}
        />
      )}

      {config.allowOutline && outlineOpen && !outlineDocked && (
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
          docked={false}
          onToggleDock={() => setOutlineDocked(true)}
        />
      )}

      {dragActive && (
        <div className="fixed inset-0 z-50 pointer-events-none">
          <div className="absolute inset-2 border-2 border-dashed border-ink/30 rounded-lg bg-white/60 backdrop-blur-sm flex items-center justify-center">
            <div className="bg-white border border-border rounded-md shadow-lg px-4 py-3 text-center">
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
