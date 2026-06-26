import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import RegionsPlugin from 'wavesurfer.js/dist/plugins/regions.esm.js'
import { makeSilentWav } from '../utils/silentWav'
import type { Risk } from '../types'

export interface RiskMarker {
  segmentId: number
  start: number
  end: number
  risk: Risk
}

export interface AudioController {
  containerRef: React.RefObject<HTMLDivElement>
  isPlaying: boolean
  currentTime: number
  duration: number
  ready: boolean
  togglePlay: () => void
  setRate: (rate: number) => void
  seek: (seconds: number) => void
}

interface Options {
  onError?: (msg: string) => void
  riskMarkers?: RiskMarker[]
  onPlay?: (position: number) => void
  onPause?: (position: number) => void
  onWaveformSeek?: (from: number, to: number) => void
  onRegionClick?: (marker: RiskMarker, fromPosition: number) => void
}

const RISK_COLOR: Record<Risk, string> = {
  high: 'rgba(220, 38, 38, 0.22)',
  med: 'rgba(217, 119, 6, 0.18)',
  low: 'rgba(0, 0, 0, 0)',
}

export function useAudio(
  audioBlob: Blob | null,
  fallbackDuration: number,
  options: Options = {},
): AudioController {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [ready, setReady] = useState(false)

  const currentUrlRef = useRef<string | null>(null)
  // Mirror of currentTime in a ref so handlers reading "previous position"
  // see a fresh value without re-running effects on every timeupdate.
  const timeRef = useRef<number>(0)

  // Latest callbacks in a ref so we don't tear down wavesurfer on identity churn.
  const callbacksRef = useRef(options)
  callbacksRef.current = options

  // Mount once.
  useEffect(() => {
    if (!containerRef.current) return

    const regions = RegionsPlugin.create()
    regionsRef.current = regions

    const ws = WaveSurfer.create({
      container: containerRef.current,
      height: 24,
      waveColor: '#a09e99',
      progressColor: '#1a1917',
      cursorColor: '#dc2626',
      cursorWidth: 1,
      barWidth: 2,
      barGap: 1,
      barRadius: 1,
      normalize: false,
      interact: true,
      plugins: [regions],
    })

    wsRef.current = ws

    const updateTime = (t: number) => {
      timeRef.current = t
      setCurrentTime(t)
    }

    ws.on('ready', () => {
      setDuration(ws.getDuration())
      setReady(true)
    })
    ws.on('play', () => {
      setIsPlaying(true)
      callbacksRef.current.onPlay?.(timeRef.current)
    })
    ws.on('pause', () => {
      setIsPlaying(false)
      callbacksRef.current.onPause?.(timeRef.current)
    })
    ws.on('finish', () => {
      setIsPlaying(false)
      callbacksRef.current.onPause?.(timeRef.current)
    })
    ws.on('audioprocess', updateTime)
    ws.on('seeking', updateTime)
    ws.on('timeupdate', updateTime)
    ws.on('interaction', (newTime: number) => {
      // Fires when the user clicks the waveform itself (not regions, not our
      // programmatic seeks). We capture the position BEFORE the click using
      // timeRef, then let the seek complete.
      callbacksRef.current.onWaveformSeek?.(timeRef.current, newTime)
    })
    ws.on('error', (err) => {
      // A superseded load (new audio, re-mount, StrictMode double-invoke)
      // aborts the in-flight one — not a real failure, so don't surface it.
      const msg = err instanceof Error ? err.message : String(err)
      const aborted =
        (err instanceof Error && err.name === 'AbortError') || /abort/i.test(msg)
      if (aborted) return
      callbacksRef.current.onError?.(`Audio failed to load: ${msg}`)
    })

    regions.on('region-clicked', (region, e) => {
      e?.stopPropagation()
      const d = ws.getDuration()
      if (d > 0) {
        // Seek to the EXACT clicked position, not the segment start, so the
        // reviewer can start anywhere mid-segment. The risk regions sit on top
        // of the waveform and would otherwise swallow the click and snap to
        // region.start (wavesurfer's native click-to-seek never runs under a
        // region). Recover the real click ratio from the cursor x over the
        // waveform; fall back to region.start if the event is unavailable.
        const wrap = containerRef.current
        let ratio = region.start / d
        if (wrap && e) {
          const rect = wrap.getBoundingClientRect()
          if (rect.width > 0) ratio = (e.clientX - rect.left) / rect.width
        }
        ws.seekTo(Math.max(0, Math.min(ratio, 1)))
      }
      // Find the original marker by id so we can log segmentId + risk.
      const markers = callbacksRef.current.riskMarkers ?? []
      const marker = markers.find((m) => `risk-${m.segmentId}` === region.id)
      if (marker) callbacksRef.current.onRegionClick?.(marker, timeRef.current)
    })

    return () => {
      ws.destroy()
      wsRef.current = null
      regionsRef.current = null
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current)
        currentUrlRef.current = null
      }
    }
  }, [])

  // Load source: own the object URL lifecycle.
  useEffect(() => {
    const ws = wsRef.current
    if (!ws) return

    setReady(false)
    setIsPlaying(false)
    setCurrentTime(0)
    timeRef.current = 0

    const blob = audioBlob ?? makeSilentWav(fallbackDuration)
    const newUrl = URL.createObjectURL(blob)
    const prevUrl = currentUrlRef.current
    currentUrlRef.current = newUrl

    let cancelled = false

    ws.load(newUrl)
      .then(() => {
        if (cancelled) return
        if (prevUrl && prevUrl !== currentUrlRef.current) {
          URL.revokeObjectURL(prevUrl)
        }
      })
      .catch((err) => {
        if (cancelled) return
        // A superseded load (new audio, re-mount, or StrictMode double-invoke)
        // rejects the in-flight one with an abort — that is not a real failure,
        // so don't surface it as an error banner.
        const msg = err instanceof Error ? err.message : String(err)
        const aborted =
          (err instanceof Error && err.name === 'AbortError') || /abort/i.test(msg)
        if (aborted) return
        callbacksRef.current.onError?.(`Audio failed to load: ${msg}`)
        if (currentUrlRef.current === newUrl) {
          URL.revokeObjectURL(newUrl)
          currentUrlRef.current = prevUrl
        }
      })

    return () => {
      cancelled = true
      if (currentUrlRef.current !== newUrl) {
        URL.revokeObjectURL(newUrl)
      }
    }
  }, [audioBlob, fallbackDuration])

  // Sync risk markers with the regions plugin.
  const markers = options.riskMarkers
  useEffect(() => {
    const regions = regionsRef.current
    if (!regions || !ready) return

    regions.clearRegions()

    if (!markers) return
    for (const m of markers) {
      if (m.risk === 'low') continue
      const region = regions.addRegion({
        id: `risk-${m.segmentId}`,
        start: m.start,
        end: m.end,
        color: RISK_COLOR[m.risk],
        drag: false,
        resize: false,
      })
      if (region.element) {
        const label = m.risk === 'high' ? 'High-risk segment' : 'Medium-risk segment'
        region.element.title = `${label} (click to seek)`
        region.element.style.cursor = 'pointer'
        region.element.style.zIndex = '2'
        region.element.style.pointerEvents = 'auto'
      }
    }
  }, [markers, ready])

  return {
    containerRef,
    isPlaying,
    currentTime,
    duration,
    ready,
    togglePlay: () => wsRef.current?.playPause(),
    setRate: (rate) => wsRef.current?.setPlaybackRate(rate, true),
    seek: (seconds) => {
      const ws = wsRef.current
      if (!ws) return
      const d = ws.getDuration()
      if (d > 0) ws.seekTo(Math.max(0, Math.min(seconds / d, 1)))
    },
  }
}
