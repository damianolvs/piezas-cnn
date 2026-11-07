import { useCallback, useEffect, useRef, useState } from "react"
import { Camera as CameraIcon, CircleDot, Loader2, ScanLine, VideoOff } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { useCamera } from "@/hooks/useCamera"
import { useModel } from "@/hooks/useModel"
import { predict } from "@/lib/api"
import { snapshotFrame } from "@/lib/image"
import { formatLatency, formatPercent } from "@/lib/format"
import type { Prediction } from "@/lib/types"
import { cn } from "@/lib/utils"

type Mode = "continuous" | "snapshot"

function classTone(className: string): "good" | "scrap" | "neutral" {
  const name = className.toLowerCase()
  if (name.includes("good") || name.includes("buen") || name.includes("complet")) return "good"
  if (name.includes("scrap") || name.includes("mala") || name.includes("rota") || name.includes("defect")) return "scrap"
  return "neutral"
}

function ClassBadge({ className }: { className: string }) {
  const tone = classTone(className)
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-semibold",
        tone === "good" && "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        tone === "scrap" && "bg-amber-500/15 text-amber-600 dark:text-amber-400",
        tone === "neutral" && "bg-sky-500/15 text-sky-600 dark:text-sky-400",
      )}
    >
      <CircleDot className="size-3.5" />
      {className}
    </span>
  )
}

export function ProductionPage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camera = useCamera()
  const { model, available, error: modelError } = useModel()

  const [mode, setMode] = useState<Mode>("continuous")
  const [prediction, setPrediction] = useState<Prediction | null>(null)
  const [predicting, setPredicting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inFlightRef = useRef(false)

  // Asigna el stream al <video> en cuanto la cámara está lista. Antes se usaba
  // onLoadedMetadata, que nunca llega a dispararse porque el video no tiene
  // fuente hasta que ese mismo handler asigna srcObject.
  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined
    video.srcObject = camera.stream ?? null
    if (!camera.stream) {
      return () => {
        video.srcObject = null
      }
    }
    const play = () => {
      video.play().catch(() => {})
    }
    if (video.readyState >= 2) play()
    else video.addEventListener("loadedmetadata", play, { once: true })
    return () => {
      video.removeEventListener("loadedmetadata", play)
      video.srcObject = null
    }
  }, [camera.stream, videoRef])

  const runPrediction = useCallback(async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth || inFlightRef.current) return
    inFlightRef.current = true
    setPredicting(true)
    try {
      const blob = await snapshotFrame(video, canvasRef.current)
      if (!blob) return
      const result = await predict(blob)
      setPrediction(result)
      setError(null)
    } catch (predictionError) {
      setError(predictionError instanceof Error ? predictionError.message : "Error de inferencia")
    } finally {
      inFlightRef.current = false
      setPredicting(false)
    }
  }, [])

  useEffect(() => {
    if (mode !== "continuous" || camera.status !== "ready") return undefined
    const timer = setInterval(() => {
      void runPrediction()
    }, 600)
    return () => clearInterval(timer)
  }, [mode, camera.status, runPrediction])

  const sortedProbabilities = prediction
    ? Object.entries(prediction.probabilities).sort((a, b) => b[1] - a[1])
    : []

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-3">
        <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
          <video
            ref={videoRef}
            className="size-full object-cover"
            autoPlay
            playsInline
            muted
          />

          {camera.status === "requesting" && (
            <div className="absolute inset-0 flex items-center justify-center gap-2 bg-background/80 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Conectando cámara…
            </div>
          )}

          {camera.status === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
              <VideoOff className="size-5 text-muted-foreground" />
              <p className="max-w-sm text-sm text-muted-foreground">{camera.error}</p>
              <Button variant="outline" size="sm" onClick={camera.retry}>
                Reintentar
              </Button>
            </div>
          )}

          {prediction && camera.status === "ready" && (
            <div className="absolute left-3 top-3 flex flex-col items-start gap-1">
              <ClassBadge className={prediction.class_name} />
              {prediction.unsure && (
                <span className="rounded-full bg-background/80 px-2 py-0.5 text-xs font-medium text-amber-500">
                  No seguro
                </span>
              )}
            </div>
          )}

          {camera.status === "ready" && (
            <div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-full bg-background/70 px-2.5 py-1 text-xs text-muted-foreground backdrop-blur">
              {predicting ? <Loader2 className="size-3 animate-spin" /> : <ScanLine className="size-3" />}
              {predicting ? "Clasificando…" : prediction ? `${formatLatency(prediction.latency_ms)}` : "Listo"}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="inline-flex rounded-lg border border-border p-0.5">
            <button
              type="button"
              onClick={() => setMode("continuous")}
              aria-pressed={mode === "continuous"}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                mode === "continuous" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              En vivo
            </button>
            <button
              type="button"
              onClick={() => setMode("snapshot")}
              aria-pressed={mode === "snapshot"}
              className={cn(
                "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                mode === "snapshot" ? "bg-foreground text-background" : "text-muted-foreground hover:text-foreground",
              )}
            >
              Instantánea
            </button>
          </div>

          {mode === "snapshot" && (
            <Button variant="outline" onClick={() => void runPrediction()} disabled={camera.status !== "ready" || predicting}>
              <CameraIcon /> Clasificar
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Resultado</CardTitle>
            <CardDescription>
              {available
                ? `Umbral de confianza: ${Math.round((model?.threshold ?? 0.6) * 100)}%`
                : "Modelo no disponible"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!available && (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
                {modelError ?? "El servicio de inferencia no responde. Verifica que esté corriendo (pnpm dev:ml)."}
              </div>
            )}

            {error && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                {error}
              </div>
            )}

            {!prediction && !error && (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {mode === "continuous" ? "Clasificando automáticamente…" : "Pulsa «Clasificar» para una foto única."}
              </p>
            )}

            {prediction && (
              <>
                <div className="flex items-center justify-between">
                  <ClassBadge className={prediction.class_name} />
                  <span className="text-2xl font-semibold tabular-nums">{formatPercent(prediction.confidence, 1)}</span>
                </div>

                <div className="space-y-2">
                  {sortedProbabilities.map(([className, probability]) => (
                    <div key={className} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{className}</span>
                        <span className="tabular-nums">{formatPercent(probability, 1)}</span>
                      </div>
                      <Progress value={probability * 100} />
                    </div>
                  ))}
                </div>

                <p className="text-center text-xs text-muted-foreground">
                  Latencia: {formatLatency(prediction.latency_ms)}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        {model && (
          <Card>
            <CardHeader>
              <CardTitle>Modelo cargado</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {model.classes.map((className) => (
                  <Badge key={className} variant="secondary">
                    {className}
                  </Badge>
                ))}
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                Época {model.best_epoch} · valid acc {formatPercent(model.val_acc, 1)} · {model.params.toLocaleString()} params
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
