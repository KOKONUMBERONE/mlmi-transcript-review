import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TopBar from './components/TopBar'
import TranscriptView from './components/TranscriptView'
import HistorySidebar from './components/HistorySidebar'
import CandidatePopup, { type PopupAnchor } from './components/CandidatePopup'
import ShortcutLegend from './components/ShortcutLegend'
import { mockTranscript as defaultTranscript } from './data/mockTranscript'
import { useAudio } from './state/useAudio'
import { useKeyboardShortcuts } from './state/useKeyboardShortcuts'
import { useFileDrop } from './state/useFileDrop'
import { useEventLog } from './state/useEventLog'
import { validateTranscript } from './utils/validateTranscript'
import type {
  EditState,
  HistoryEntry,
  ModelName,
  SeekTrigger,
  Transcript,
} from './types'

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

export default function App() {
  const [transcript, setTranscript] = useState<Transcript>(defaultTranscript)
  const [transcriptFilename, setTranscriptFilename] = useState<string | null>(null)
  const [audioFile, setAudioFile] = useState<File | null>(null)

  const availableModels = useMemo(() => modelsOf(transcript), [transcript])
  const [model, setModel] = useState<ModelName>(availableModels[0])
  const [reviewer, setReviewer] = useState<string>('')

  const [edits, setEdits] = useState<Record<string, EditState>>({})
  const [verified, setVerified] = useState<Record<number, boolean>>({})
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [popup, setPopup] = useState<PopupAnchor | null>(null)
  const [errorMsg, setErrorMsg] = useState<string | null>(null)
  const [speed, setSpeed] = useState<number>(1)

  // ---- Behavioural event log (ref-backed, no re-renders on log) ----
  const events = useEventLog()

  // Mirror reviewer/model into the event-log context so every event carries
  // the latest values without us threading them through every call site.
  useEffect(() => {
    events.setContext({ reviewer, model })
  }, [reviewer, model, events])

  // Emit session_start exactly once, after the first transcript is in place.
  const sessionStartedRef = useRef(false)
  useEffect(() => {
    if (sessionStartedRef.current) return
    sessionStartedRef.current = true
    events.log('session_start', {
      audio_duration: transcript.audioDuration,
      segment_count: transcript.segments.length,
      transcript_filename: transcriptFilename ?? '(bundled mock)',
    })
  }, [events, transcript, transcriptFilename])

  // ---- Audio with logging hooks ----
  const riskMarkers = useMemo(
    () =>
      transcript.segments.map((s) => ({
        segmentId: s.id,
        start: s.start,
        end: s.end,
        risk: s.paraRisk,
      })),
    [transcript],
  )

  const audio = useAudio(audioFile, transcript.audioDuration, {
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

  const originalTextAt = (segId: number, wordIdx: number): string => {
    const segment = transcript.segments.find((s) => s.id === segId)
    return segment?.words[model]?.[wordIdx]?.text ?? ''
  }

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

    events.log('word_delete', {
      segment_id: popup.segId,
      word_index: popup.wordIdx,
      word_text: displayedText,
      reason,
    })

    events.log('popup_close', {
      segment_id: popup.segId,
      word_index: popup.wordIdx,
    })
    setPopup(null)
  }

  const toggleVerify = useCallback(
    (segId: number) => {
      setVerified((prev) => {
        const next = !prev[segId]
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
        return { ...prev, [segId]: next }
      })
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewer, events],
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

  // ---- Upload handlers ----
  const handleAudioUpload = useCallback(
    (file: File) => {
      setErrorMsg(null)
      setAudioFile(file)
      events.log('audio_load', { audio_filename: file.name })
    },
    [events],
  )

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
        const result = validateTranscript(parsed)
        if (!result.ok) {
          setErrorMsg(`${file.name}: ${result.error}`)
          return
        }
        setTranscript(result.transcript)
        setTranscriptFilename(file.name)
        const next = modelsOf(result.transcript)
        setModel(next[0])
        setEdits({})
        setVerified({})
        setHistory([])
        setPopup(null)
        events.log('transcript_load', {
          transcript_filename: file.name,
          segment_count: result.transcript.segments.length,
          audio_duration: result.transcript.audioDuration,
        })
      } catch (e) {
        setErrorMsg(`${file.name}: ${(e as Error).message}`)
      }
    },
    [events],
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
    <div className="relative h-full flex flex-col bg-surface-muted">
      <TopBar
        model={model}
        availableModels={availableModels}
        onModelChange={handleModelChange}
        audio={audio}
        audioFilename={audioFile?.name ?? null}
        transcriptFilename={transcriptFilename}
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        onUploadAudio={handleAudioUpload}
        onUploadTranscript={handleTranscriptUpload}
        onSpeedChange={handleSpeedChange}
      />

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
        <TranscriptView
          transcript={transcript}
          model={model}
          currentTime={audio.currentTime}
          edits={edits}
          verified={verified}
          onSeek={(t) => seekWithLog(t, 'segment')}
          onWordClick={openPopup}
          onToggleVerify={toggleVerify}
          onFilterChange={(filter) => events.log('filter_change', { filter })}
          onSortChange={(sort) => events.log('sort_change', { sort })}
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
          audioFilename={audioFile?.name ?? null}
          transcriptFilename={transcriptFilename}
          onExport={wrappedAuditExport}
        />
      </div>

      <ShortcutLegend
        getEvents={events.getEvents}
        onExport={(kind, count) =>
          events.log('export', { export_kind: kind, segment_count: count })
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
