import { useState } from "react"
import { AlertCircle, CheckCircle2, Copy, FolderOpen, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import type { CaptureSummary } from "@/hooks/useCapture"
import { formatBytes, formatDuration, formatNumber } from "@/lib/format"

interface SessionSummaryProps {
  summary: CaptureSummary
  onReset: () => void
}

export function SessionSummary({ summary, onReset }: SessionSummaryProps) {
  const [copied, setCopied] = useState(false)
  const fps = summary.durationMs > 0 ? (summary.captured / (summary.durationMs / 1000)).toFixed(1) : "0"
  const avgBytes = summary.captured > 0 ? summary.bytes / summary.captured : 0
  const complete = summary.status === "completed"

  const copyFolder = async () => {
    try {
      await navigator.clipboard.writeText(summary.folder)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // clipboard no disponible
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {complete ? (
            <CheckCircle2 className="size-4 text-emerald-500" />
          ) : (
            <AlertCircle className="size-4 text-amber-500" />
          )}
          Sesión {complete ? "completada" : "parcial"}
        </CardTitle>
        <CardDescription>Las fotos quedaron guardadas en el dataset.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {summary.finishWarning && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-600 dark:text-amber-400">
            {summary.finishWarning}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2.5">
          <div className="flex min-w-0 items-center gap-2 text-xs">
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            <code className="truncate text-muted-foreground">{summary.folder}</code>
          </div>
          <Button variant="ghost" size="sm" onClick={copyFolder}>
            {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? "Copiado" : "Copiar"}
          </Button>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{formatNumber(summary.captured)}</p>
            <p className="text-[11px] text-muted-foreground">Guardadas</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{formatBytes(summary.bytes)}</p>
            <p className="text-[11px] text-muted-foreground">Peso total</p>
          </div>
          <div className="rounded-lg bg-muted/50 p-3 text-center">
            <p className="text-lg font-semibold tabular-nums">{formatDuration(summary.durationMs)}</p>
            <p className="text-[11px] text-muted-foreground">Duración</p>
          </div>
        </div>

        <Separator />

        <dl className="space-y-2 text-xs">
          {[
            ["Resolución", `${summary.settings.size}×${summary.settings.size} px`],
            ["Formato", summary.settings.grayscale ? "JPEG · escala de grises" : "JPEG · color"],
            ["Ritmo", `${fps} fps`],
            ["Peso medio", formatBytes(avgBytes)],
            ["Fallidas", `${summary.failed}`],
          ].map(([label, value]) => (
            <div key={label} className="flex items-center justify-between">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        <Button variant="outline" className="w-full" onClick={onReset}>
          <RotateCcw /> Nueva captura
        </Button>
      </CardContent>
    </Card>
  )
}
