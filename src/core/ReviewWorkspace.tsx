import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopBar from '../components/TopBar'
import TranscriptView from '../components/TranscriptView'
import HistorySidebar from '../components/HistorySidebar'
import FocusPanel from '../components/FocusPanel'
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
import { runFocus, runFocusAi, parseFocusInput, parseFocusQueries } from '../lib/focusApi'
import { transcribeAudio } from '../lib/transcribeApi'
import { segmentRiskWithFocus } from '../lib/segmentRisk'
import type {
  Condition,
  EditState,
  FocusMode,
  FocusResult,
  FocusSnippet,
  FocusWordHit,
  HighlightLayer,
  HistoryEntry,
  ModelName,
  Risk,
  RiskDimension,
  SeekTrigger,
  Transcript,
} from '../types'
import type { WorkspaceConfig } from './config'
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
  const [transcriptFilename, setTranscriptFilename] = useState<string | null>(null)
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null)
  const [audioFilename, setAudioFilename] = useState<string | null>(null)
  // Object URL for the "Download recording" affordance. Owned here so we can
  // revoke it cleanly when a new recording arrives or the file changes.
  const [recordingDownloadUrl, setRecordingDownloadUrl] = useState<string | null>(null)
  // UI: collapsible side panels.
  const [focusCollapsed, setFocusCollapsed] = useState(false)
  const [auditCollapsed, setAuditCollapsed] = useState(false)

  const availableModels = useMemo(() => modelsOf(transcript), [transcript])
  const [model, setModel] = useState<ModelName>(availableModels[0])
  const [reviewer, setReviewer] = useState<string>('')
  const [participantId, setParticipantId] = useState<string>('')
  const [condition, setCondition] = useState<string>('')

  const [edits, setEdits] = useState<Record<string, EditState>>({})
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

  // ---- Case focus (2b) — retrieval overlay on top of the default scoring ----
  const [focusText, setFocusText] = useState<string>('')
  const [focusMode, setFocusMode] = useState<FocusMode>('lexical')
  const [focusResult, setFocusResult] = useState<FocusResult | null>(null)
  const [focusActive, setFocusActive] = useState<boolean>(false)
  const [focusRunning, setFocusRunning] = useState<boolean>(false)
  // Focus-only error (e.g. AI mode with Ollama not running). Kept separate from
  // the global `errorMsg` banner so a missing local LLM degrades gracefully:
  // it surfaces *inside* the Focus panel and never blocks lexical search or the
  // rest of the app.
  const [focusError, setFocusError] = useState<string | null>(null)

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
          if (!cancelled) setTranscript(annotated)
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

  // ---- Audio with logging hooks ----
  // Waveform markers reflect the *active* risk dimension, so toggling the
  // toolbar switch repaints the audio strip too.
  const riskMarkers = useMemo(
    () =>
      transcript.segments.map((s) => ({
        segmentId: s.id,
        start: s.start,
        end: s.end,
        risk: segmentRiskWithFocus(
          s,
          model,
          activeHighlight,
          showFocus && focusSegmentIds.has(s.id),
        ),
      })),
    [transcript, model, activeHighlight, showFocus, focusSegmentIds],
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
    (segId: number) => {
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
    [verified, reviewer, events],
  )

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

  const handleRunFocus = useCallback(async () => {
    // Lexical = structured items (label + aliases); AI = free-text queries.
    const labels =
      focusMode === 'ai'
        ? parseFocusQueries(focusText)
        : parseFocusInput(focusText).map((i) => i.label)
    if (labels.length === 0) {
      setFocusResult(null)
      setFocusActive(false)
      return
    }
    setFocusError(null)
    setFocusRunning(true)
    try {
      const result =
        focusMode === 'ai'
          ? await runFocusAi(transcript, parseFocusQueries(focusText))
          : await runFocus(transcript, parseFocusInput(focusText), model)
      setFocusResult(result)
      setFocusActive(true)
      const hits = result.terms.reduce((n, t) => n + t.snippets.length, 0)
      events.log('focus_apply', {
        focus_terms: labels.join(', '),
        focus_hits: hits,
        focus_mode: focusMode,
      })
    } catch (err) {
      const msg =
        err instanceof PredictError
          ? err.message
          : `Focus retrieval failed: ${(err as Error).message}`
      setFocusError(msg)
    } finally {
      setFocusRunning(false)
    }
  }, [focusMode, focusText, transcript, model, events])

  const handleClearFocus = useCallback(() => {
    setFocusActive(false)
    setFocusResult(null)
    setFocusError(null)
    events.log('focus_clear')
  }, [events])

  // Switching engine (lexical <-> ai) clears any stale error so the panel
  // doesn't keep showing an "Ollama not running" note after you fall back to
  // the lexical engine.
  const handleFocusModeChange = useCallback((m: FocusMode) => {
    setFocusMode(m)
    setFocusError(null)
  }, [])

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
      setTranscriptFilename(sourceName)
      const pickedModel = modelsOf(result.transcript)[0]
      setModel(pickedModel)
      setEdits({})
      setVerified({})
      setHistory([])
      setPopup(null)
      // A new transcript invalidates any prior focus retrieval.
      setFocusResult(null)
      setFocusActive(false)
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
    togglePlay: audio.togglePlay,
    seek: (t) => seekWithLog(t, 'keyboard'),
    toggleVerify,
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

  const verifiedCount = Object.values(verified).filter(Boolean).length
  const totalSegments = transcript.segments.length

  return (
    <div
      className={`relative h-full flex flex-col bg-surface-muted${
        interactionLocked ? ' pointer-events-none select-none opacity-60' : ''
      }`}
    >
      <TopBar
        model={model}
        availableModels={availableModels}
        onModelChange={handleModelChange}
        audio={audio}
        audioFilename={audioFilename}
        transcriptFilename={transcriptFilename}
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        onUploadAudio={handleAudioUpload}
        onUploadTranscript={handleTranscriptUpload}
        onSpeedChange={handleSpeedChange}
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
        allowUpload={config.allowUpload}
        allowRecord={config.allowRecord}
        allowTranscribe={config.allowAutoTranscribe}
        canTranscribe={!!audioBlob}
        transcribing={transcribing}
        onTranscribe={handleTranscribe}
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

      <div className="flex-1 flex overflow-hidden">
        {focusEnabled && (
          <FocusPanel
            text={focusText}
            onTextChange={setFocusText}
            mode={focusMode}
            onModeChange={handleFocusModeChange}
            onRun={handleRunFocus}
            onClear={handleClearFocus}
            running={focusRunning}
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
          showViewControls={activeHighlight !== 'none'}
          focusActive={showFocus}
          focusSegmentIds={focusSegmentIds}
          focusHitFor={focusHitFor}
          onSeek={(t) => seekWithLog(t, 'segment')}
          onWordClick={openPopup}
          onToggleVerify={toggleVerify}
          onBulkVerify={verifyMany}
          onFilterChange={(filter) => events.log('filter_change', { filter })}
          onSortChange={(sort) => events.log('sort_change', { sort })}
          onSegmentView={handleSegmentView}
        />
        <HistorySidebar
          history={history}
          verified={verified}
          verifiedCount={verifiedCount}
          totalSegments={totalSegments}
          transcript={transcript}
          model={model}
          edits={edits}
          reviewer={reviewer}
          audioFilename={audioFilename}
          transcriptFilename={transcriptFilename}
          onExport={wrappedAuditExport}
          collapsed={auditCollapsed}
          onToggleCollapse={() => setAuditCollapsed((v) => !v)}
        />
      </div>

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
          onApply={applyEdit}
          onDelete={deleteWord}
          onClose={closePopup}
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
