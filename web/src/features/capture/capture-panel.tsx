import { Square } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { CapturePhase } from "@/lib/types"
import { formatNumber } from "@/lib/format"

function RotationGuide() {
  const radius = 52
  const ticks = Array.from({ length: 10 }, (_, i) => i * 36)
  return (
    <svg viewBox="0 0 128 128" className="mx-auto size-28" role="img" aria-label="Guía de rotación de 360 grados">
      <circle cx="64" cy="64" r={radius} fill="none" stroke="var(--border)" strokeWidth="1.5" />
      {ticks.map((angle) => {
        const radians = ((angle - 90) * Math.PI) / 180
        const outer = angle % 72 === 0 ? radius - 6 : radius - 2
        const inner = angle % 72 === 0 ? radius - 14 : radius - 8
        const x1 = 64 + Math.cos(radians) * inner
        const y1 = 64 + Math.sin(radians) * inner
        const x2 = 64 + Math.cos(radians) * outer
        const y2 = 64 + Math.sin(radians) * outer
        const labelAngle = angle % 72 === 0 ? angle : null
        const lx = 64 + Math.cos(radians) * (radius + 12)
        const ly = 64 + Math.sin(radians) * (radius + 12)
        return (
          <g key={angle}>
            <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--foreground)" strokeWidth={angle % 72 === 0 ? 1.75 : 1} strokeOpacity={angle % 72 === 0 ? 0.7 : 0.3} />
            {labelAngle !== null && (
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground" fontSize="7">
                {labelAngle}°
              </text>
            )}
          </g>
        )
      })}
      <circle cx="64" cy="64" r="2.5" fill="var(--foreground)" fillOpacity="0.6" />
    </svg>
  )
}

interface CapturePanelProps {
  phase: CapturePhase
  captured: number
  total: number
  elapsedMs: number
  size: number
  disabled: boolean
  onStop: () => void
}

export function CapturePanel({ phase, captured, total, elapsedMs, size, disabled, onStop }: CapturePanelProps) {
  const progress = total > 0 ? (captured / total) * 100 : 0
  const remaining = Math.max(0, total - captured)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capturando</CardTitle>
        <CardDescription>Gira el objeto lentamente para cubrir los 360°.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <RotationGuide />

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>{phase === "finishing" ? "Guardando fotos…" : "Progreso"}</span>
            <span className="tabular-nums">{Math.round(progress)}%</span>
          </div>
          <Progress value={progress} />
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{formatNumber(captured)}</p>
            <p className="text-[11px] text-muted-foreground">Capturadas</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{formatNumber(remaining)}</p>
            <p className="text-[11px] text-muted-foreground">Restantes</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{size}px</p>
            <p className="text-[11px] text-muted-foreground">Resolución</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>Tiempo transcurrido</span>
          <span className="tabular-nums">{(elapsedMs / 1000).toFixed(1)} s</span>
        </div>

        <Button variant="destructive" className="w-full" size="lg" disabled={disabled} onClick={onStop}>
          <Square /> Detener y guardar
        </Button>

        <p className="text-center text-[11px] text-muted-foreground">
          {phase === "finishing" ? "Espera mientras se finaliza la sesión…" : "Las fotos se suben en tiempo real."}
        </p>
      </CardContent>
    </Card>
  )
}
