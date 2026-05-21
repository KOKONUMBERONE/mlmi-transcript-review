import { useCallback, useMemo, useState } from 'react'
import TopBar from './components/TopBar'
import TranscriptView from './components/TranscriptView'
import HistorySidebar from './components/HistorySidebar'
import CandidatePopup, { type PopupAnchor } from './components/CandidatePopup'
import ShortcutLegend from './components/ShortcutLegend'
import { mockTranscript as defaultTranscript } from './data/mockTranscript'
import { useAudio } from './state/useAudio'
import { useKeyboardShortcuts } from './state/useKeyboardShortcuts'
import { useFileDrop } from './state/useFileDrop'
import { validateTranscript } from './utils/validateTranscript'
import type { EditState, HistoryEntry, ModelName, Transcript } from './types'

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
  })

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

  const openPopup = (segId: number, wordIdx: number, rect: DOMRect) =>
    setPopup({ segId, wordIdx, rect })

  const closePopup = () => setPopup(null)

  const originalTextAt = (segId: number, wordIdx: number): string => {
    const segment = transcript.segments.find((s) => s.id === segId)
    return segment?.words[model]?.[wordIdx]?.text ?? ''
  }

  // Apply an edit OR a restoration. Both flow through here because picking
  // a candidate on a deleted word is just an edit that also clears `deleted`.
  const applyEdit = (newText: string, reason?: string) => {
    if (!popup) return
    const key = `${popup.segId}-${popup.wordIdx}`
    const original = originalTextAt(popup.segId, popup.wordIdx)
    const previous = edits[key]
    const fromDisplay = previous?.deleted
      ? '(deleted)'
      : previous?.text ?? original

    if (!previous?.deleted && newText === fromDisplay) {
      setPopup(null)
      return
    }

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
    setPopup(null)
  }

  const deleteWord = (reason?: string) => {
    if (!popup) return
    const key = `${popup.segId}-${popup.wordIdx}`
    const original = originalTextAt(popup.segId, popup.wordIdx)
    const previous = edits[key]
    if (previous?.deleted) {
      setPopup(null)
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
        return { ...prev, [segId]: next }
      })
    },
    // currentReviewer reads from the latest reviewer state via closure — but
    // we want the freshest value, so include reviewer in deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reviewer],
  )

  // ---- Upload handlers ----

  const handleAudioUpload = useCallback((file: File) => {
    setErrorMsg(null)
    setAudioFile(file)
  }, [])

  const handleTranscriptUpload = useCallback(async (file: File) => {
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
    } catch (e) {
      setErrorMsg(`${file.name}: ${(e as Error).message}`)
    }
  }, [])

  const dragActive = useFileDrop({
    onAudio: handleAudioUpload,
    onJson: handleTranscriptUpload,
    onError: (msg) => setErrorMsg(msg),
  })

  useKeyboardShortcuts({
    transcript,
    currentTime: audio.currentTime,
    togglePlay: audio.togglePlay,
    seek: audio.seek,
    toggleVerify,
  })

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
        onModelChange={setModel}
        audio={audio}
        audioFilename={audioFile?.name ?? null}
        transcriptFilename={transcriptFilename}
        reviewer={reviewer}
        onReviewerChange={setReviewer}
        onUploadAudio={handleAudioUpload}
        onUploadTranscript={handleTranscriptUpload}
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
          onSeek={audio.seek}
          onWordClick={openPopup}
          onToggleVerify={toggleVerify}
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
        />
      </div>

      <ShortcutLegend />

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
