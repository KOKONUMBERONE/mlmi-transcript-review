import { useEffect, useRef, useState } from 'react'
import WaveSurfer from 'wavesurfer.js'
import { makeSilentWav } from '../utils/silentWav'

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
}

export function useAudio(
  audioBlob: Blob | null,
  fallbackDuration: number,
  options: Options = {},
): AudioController {
  const containerRef = useRef<HTMLDivElement>(null)
  const wsRef = useRef<WaveSurfer | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [ready, setReady] = useState(false)

  // Track the URL currently in use by wavesurfer, so we can revoke it
  // exactly when it's no longer needed.
  const currentUrlRef = useRef<string | null>(null)

  // Keep callback in a ref so we don't have to re-run effects on identity change.
  const onErrorRef = useRef(options.onError)
  onErrorRef.current = options.onError

  // Mount once.
  useEffect(() => {
    if (!containerRef.current) return

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

    return () => {
      ws.destroy()
      wsRef.current = null
      // Final cleanup: revoke any URL still attached.
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current)
        currentUrlRef.current = null
      }
    }
  }, [])

  // Load source: own the object URL lifecycle.
  // - Create a new URL for the new blob.
  // - After ws.load() resolves (new audio decoded), revoke the previous URL.
  // - If we unmount mid-load, the cleanup below revokes the in-flight URL.
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
        // Failed load — drop the new URL too so nothing leaks.
        if (currentUrlRef.current === newUrl) {
          URL.revokeObjectURL(newUrl)
          currentUrlRef.current = prevUrl
        }
      })

    return () => {
      cancelled = true
      // If a newer load has superseded this one, revoke this URL now.
      if (currentUrlRef.current !== newUrl) {
        URL.revokeObjectURL(newUrl)
      }
    }
  }, [audioBlob, fallbackDuration])

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
