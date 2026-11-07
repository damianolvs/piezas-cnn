import { useEffect, type ReactNode } from "react"
import { Loader2, RefreshCw, VideoOff } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { CameraStatus } from "@/hooks/useCamera"

interface CameraPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>
  stream: MediaStream | null
  status: CameraStatus
  error: string | null
  onRetry: () => void
  children?: ReactNode
}

export function CameraPreview({ videoRef, stream, status, error, onRetry, children }: CameraPreviewProps) {
  useEffect(() => {
    const video = videoRef.current
    if (!video) return undefined

    video.srcObject = stream ?? null
    if (!stream) {
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
  }, [stream, videoRef])

  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black ring-1 ring-border">
      <video ref={videoRef} className="size-full object-cover" autoPlay playsInline muted />

      {status === "ready" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <div className="rounded-lg border border-dashed border-white/20 px-3 py-1 text-[11px] text-white/50">
            zona de captura
          </div>
        </div>
      )}

      {status === "requesting" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/80 text-sm text-muted-foreground">
          <Loader2 className="size-5 animate-spin" />
          <p>Conectando cámara…</p>
        </div>
      )}

      {status === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center">
          <VideoOff className="size-5 text-muted-foreground" />
          <p className="max-w-sm text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw /> Reintentar
          </Button>
        </div>
      )}

      {children}
    </div>
  )
}
