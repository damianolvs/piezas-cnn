import { useCallback, useEffect, useRef, useState } from "react"
import { captureFrame } from "../lib/image"
import { createSession, finishSession, uploadFrame } from "../lib/api"
import { beepCountdown, beepGo, shutter, unlockAudio } from "../lib/audio"
import type { CameraInfo, CapturePhase, CaptureSettings } from "../lib/types"

const sleep = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds))

// Semáforo simple para limitar la concurrencia de subidas.
function createLimiter(limit: number) {
  let active = 0
  const queue: (() => void)[] = []
  return function run<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const exec = () => {
        active += 1
        task()
          .then(resolve, reject)
          .finally(() => {
            active -= 1
            queue.shift()?.()
          })
      }
      if (active < limit) exec()
      else queue.push(exec)
    })
  }
}

export interface CaptureConfig {
  label: string
  notes: string
  settings: CaptureSettings
  muted: boolean
  camera: CameraInfo
}

export interface CaptureSummary {
  id: string
  folder: string
  label: string
  status: "completed" | "partial"
  captured: number
  uploaded: number
  failed: number
  bytes: number
  durationMs: number
  settings: CaptureSettings
  finishedAt: string
  finishWarning?: string
}

export function useCapture({ videoRef, canvasRef }: { videoRef: React.RefObject<HTMLVideoElement | null>; canvasRef?: React.RefObject<HTMLCanvasElement | null> }) {
  const [phase, setPhase] = useState<CapturePhase>("idle")
  const [countdown, setCountdown] = useState<number | null>(null)
  const [captured, setCaptured] = useState(0)
  const [total, setTotal] = useState(0)
  const [elapsedMs, setElapsedMs] = useState(0)
  const [summary, setSummary] = useState<CaptureSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const cancelRef = useRef(false)
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const uploadedBytesRef = useRef(0)
  const uploadedCountRef = useRef(0)
  const failedCountRef = useRef(0)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      cancelRef.current = true
      if (tickerRef.current) clearInterval(tickerRef.current)
    }
  }, [])

  const start = useCallback(
    async (config: CaptureConfig) => {
      if (busyRef.current) return

      const video = videoRef.current
      if (!video || !video.videoWidth || !video.videoHeight) {
        setError("La cámara todavía no está lista. Espera la vista previa e inténtalo de nuevo.")
        setPhase("error")
        return
      }

      busyRef.current = true
      cancelRef.current = false
      uploadedBytesRef.current = 0
      uploadedCountRef.current = 0
      failedCountRef.current = 0
      setError(null)
      setSummary(null)
      setCaptured(0)
      setElapsedMs(0)
      setTotal(config.settings.count)

      let sessionId: string | null = null
      let folder: string | null = null
      let capturedCount = 0
      let startedAt = 0
      const uploads: Promise<void>[] = []
      const limitUpload = createLimiter(4)

      try {
        unlockAudio()
        setPhase("countdown")
        for (let n = 3; n >= 1; n -= 1) {
          if (cancelRef.current) break
          setCountdown(n)
          if (!config.muted) beepCountdown(n)
          await sleep(1000)
        }
        setCountdown(null)

        if (cancelRef.current) {
          if (mountedRef.current) setPhase("idle")
          return
        }
        if (!config.muted) beepGo()

        setPhase("preparing")
        const created = await createSession({
          label: config.label,
          notes: config.notes,
          settings: config.settings,
          camera: config.camera,
        })
        sessionId = created.session.id
        folder = created.folder

        // Si el usuario canceló mientras se creaba la sesión, ciérrala limpia.
        if (cancelRef.current) {
          await finishSession(sessionId, {
            status: "partial",
            actualDurationMs: 0,
            failedCount: 0,
          }).catch(() => {})
          if (mountedRef.current) setPhase("idle")
          return
        }

        setPhase("capturing")
        const { count, durationMs } = config.settings
        const interval = durationMs / count
        startedAt = performance.now()

        tickerRef.current = setInterval(() => {
          if (!mountedRef.current) return
          setElapsedMs(Math.min(durationMs, performance.now() - startedAt))
        }, 100)

        for (let index = 0; index < count; index += 1) {
          if (cancelRef.current) break

          // Si la pestaña queda en segundo plano, pausa el bucle hasta volver.
          if (document.hidden) await sleep(50)

          const target = startedAt + index * interval
          const wait = target - performance.now()
          if (wait > 0) await sleep(wait)
          if (cancelRef.current) break

          const blob = await captureFrame(video, config.settings, canvasRef?.current)
          if (!blob) {
            failedCountRef.current += 1
            continue
          }

          capturedCount += 1
          if (mountedRef.current) setCaptured(capturedCount)

          const timeMs = Math.round(performance.now() - startedAt)
          uploads.push(
            limitUpload(async () => {
              try {
                try {
                  await uploadFrame(sessionId!, { blob, index, timeMs })
                } catch {
                  await sleep(250)
                  await uploadFrame(sessionId!, { blob, index, timeMs })
                }
                uploadedCountRef.current += 1
                uploadedBytesRef.current += blob.size
              } catch {
                failedCountRef.current += 1
              }
            }),
          )

          if (!config.muted) shutter(index)
        }

        if (tickerRef.current) clearInterval(tickerRef.current)
        tickerRef.current = null
        if (mountedRef.current) {
          setElapsedMs(Math.min(durationMs, performance.now() - startedAt))
        }

        setPhase("finishing")
        await Promise.allSettled(uploads)

        const actualDurationMs = Math.round(performance.now() - startedAt)
        const complete = !cancelRef.current && capturedCount === count && failedCountRef.current === 0

        // Cierra la sesión; reintenta una vez si falla para no dejar metadata en
        // estado "recording" de forma silenciosa.
        let finished = null
        let finishWarning: string | undefined
        try {
          finished = await finishSession(sessionId!, {
            status: complete ? "completed" : "partial",
            actualDurationMs,
            failedCount: failedCountRef.current,
          })
        } catch {
          try {
            await sleep(500)
            finished = await finishSession(sessionId!, {
              status: complete ? "completed" : "partial",
              actualDurationMs,
              failedCount: failedCountRef.current,
            })
          } catch {
            finishWarning = "No se pudo cerrar la metadata de la sesión; se reintentará al guardar."
          }
        }

        if (!mountedRef.current) return

        setSummary({
          id: sessionId!,
          folder: folder!,
          label: config.label,
          status: complete ? "completed" : "partial",
          captured: capturedCount,
          uploaded: uploadedCountRef.current,
          failed: failedCountRef.current,
          bytes: uploadedBytesRef.current,
          durationMs: actualDurationMs,
          settings: config.settings,
          finishedAt: finished?.session?.completedAt ?? new Date().toISOString(),
          finishWarning,
        })
        setPhase("done")
      } catch (captureError) {
        if (tickerRef.current) clearInterval(tickerRef.current)
        tickerRef.current = null
        if (!mountedRef.current) return

        if (sessionId) {
          await finishSession(sessionId, {
            status: "partial",
            actualDurationMs: startedAt ? Math.round(performance.now() - startedAt) : 0,
            failedCount: failedCountRef.current,
          }).catch(() => {})
        }

        setError(captureError instanceof Error ? captureError.message : "Ocurrió un error durante la captura")
        setPhase("error")
      } finally {
        busyRef.current = false
      }
    },
    [videoRef, canvasRef],
  )

  const stop = useCallback(() => {
    cancelRef.current = true
  }, [])

  const reset = useCallback(() => {
    if (busyRef.current) return
    setPhase("idle")
    setCountdown(null)
    setCaptured(0)
    setTotal(0)
    setElapsedMs(0)
    setSummary(null)
    setError(null)
  }, [])

  return {
    phase,
    countdown,
    captured,
    total,
    elapsedMs,
    summary,
    error,
    start,
    stop,
    reset,
  }
}
