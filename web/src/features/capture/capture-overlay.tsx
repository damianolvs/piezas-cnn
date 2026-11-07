import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import type { CapturePhase } from "@/lib/types"

interface CaptureOverlayProps {
  phase: CapturePhase
  countdown: number | null
  captured: number
  total: number
}

export function CaptureOverlay({ phase, countdown, captured, total }: CaptureOverlayProps) {
  const [flash, setFlash] = useState(false)

  useEffect(() => {
    if (!captured) return undefined
    setFlash(true)
    const timeout = setTimeout(() => setFlash(false), 90)
    return () => clearTimeout(timeout)
  }, [captured])

  const progress = total > 0 ? Math.min(1, captured / total) : 0

  return (
    <div className="pointer-events-none absolute inset-0">
      {flash && <div className="absolute inset-0 bg-white/70" aria-hidden="true" />}

      {phase === "countdown" && (
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/40 text-white"
          role="status"
          aria-live="assertive"
        >
          <span key={countdown} className="animate-[countdown_1s_ease-out] text-7xl font-semibold tabular-nums">
            {countdown}
          </span>
          <p className="text-sm text-white/80">Prepárate para girar el objeto</p>
        </div>
      )}

      {phase === "preparing" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/40 text-white" role="status">
          <Loader2 className="size-5 animate-spin" />
          <p className="text-sm text-white/80">Creando carpeta de sesión…</p>
        </div>
      )}

      {(phase === "capturing" || phase === "finishing") && (
        <div className="absolute inset-x-0 bottom-0 flex flex-col gap-2 bg-gradient-to-t from-black/70 to-transparent p-4">
          <div className="flex items-center justify-between text-xs text-white">
            <span className="flex items-center gap-1.5">
              <span className="size-2 animate-pulse rounded-full bg-red-500" aria-hidden="true" />
              {phase === "capturing" ? "Grabando" : "Guardando"}
            </span>
            <strong className="tabular-nums">
              {captured} / {total}
            </strong>
          </div>
          <div className="h-1 w-full overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-white transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
    </div>
  )
}
