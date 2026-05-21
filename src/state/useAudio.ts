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

  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError

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

    ws.on('ready', () => {
      setDuration(ws.getDuration())
      setReady(true)
    })
    ws.on('play', () => setIsPlaying(true))
    ws.on('pause', () => setIsPlaying(false))
    ws.on('finish', () => setIsPlaying(false))
    ws.on('audioprocess', (t) => setCurrentTime(t))
    ws.on('seeking', (t) => setCurrentTime(t))
    ws.on('timeupdate', (t) => setCurrentTime(t))
    ws.on('error', (err) => {
      onErrorRef.current?.(
        `Audio failed to load: ${err instanceof Error ? err.message : String(err)}`,
      )
    })

    // Clicking a region seeks to its start. The regions plugin emits
    // 'region-clicked' separately from wavesurfer's own click-to-seek, so we
    // also need to stop the event from propagating to avoid a double-seek.
    regions.on('region-clicked', (region, e) => {
      e?.stopPropagation()
      const d = ws.getDuration()
      if (d > 0) ws.seekTo(Math.max(0, Math.min(region.start / d, 1)))
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
        onErrorRef.current?.(
          `Audio failed to load: ${err instanceof Error ? err.message : String(err)}`,
        )
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
  // Re-runs whenever the source markers change OR when a new audio file becomes
  // ready (regions are cleared on every load, so they must be re-added).
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
        // Keep risk regions visually subordinate to the cursor and progress.
        region.element.style.zIndex = '2'
        region.element.style.pointerEvents = 'auto'
      }
    }

    return () => {
      // Don't clearRegions on cleanup — the next run does it. Clearing here
      // would also fire during fast-refresh in dev with no replacement.
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
