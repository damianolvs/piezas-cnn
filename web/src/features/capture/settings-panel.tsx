import { Camera, Play, RefreshCw, Volume2, VolumeX } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { NumberField } from "./number-field"
import { formatBytes } from "@/lib/format"
import type { CaptureSettings, CameraInfo } from "@/lib/types"

interface SettingsPanelProps {
  label: string
  notes: string
  settings: CaptureSettings
  muted: boolean
  devices: CameraInfo[]
  deviceId: string
  disabled: boolean
  canStart: boolean
  onLabelChange: (value: string) => void
  onNotesChange: (value: string) => void
  onSettingsChange: <K extends keyof CaptureSettings>(key: K, value: CaptureSettings[K]) => void
  onMutedChange: (value: boolean) => void
  onDeviceChange: (deviceId: string) => void
  onRefreshDevices: () => void
  onStart: () => void
}

export function SettingsPanel({
  label,
  notes,
  settings,
  muted,
  devices,
  deviceId,
  disabled,
  canStart,
  onLabelChange,
  onNotesChange,
  onSettingsChange,
  onMutedChange,
  onDeviceChange,
  onRefreshDevices,
  onStart,
}: SettingsPanelProps) {
  const { count, durationMs, size, quality, grayscale } = settings
  const durationSeconds = durationMs / 1000
  const fps = durationMs > 0 ? Math.round((count / durationMs) * 1000 * 10) / 10 : 0
  const estimatedBytes = count * 8 * 1024

  return (
    <Card>
      <CardHeader>
        <CardTitle>Configuración de captura</CardTitle>
        <CardDescription>Define la etiqueta del objeto y los parámetros de la sesión.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="label">
              Etiqueta del objeto <span className="text-destructive">*</span>
            </Label>
            <Input
              id="label"
              value={label}
              maxLength={80}
              placeholder="Ej. pieza-buena, scrap, banda-vacía…"
              disabled={disabled}
              onChange={(event) => onLabelChange(event.target.value)}
            />
            <p className="text-[11px] text-muted-foreground">
              La etiqueta se usa para clasificar la sesión al ensamblar el dataset.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="notes">Notas (opcional)</Label>
            <Textarea
              id="notes"
              value={notes}
              maxLength={1000}
              placeholder="Condiciones de luz, tipo de pieza, comentarios…"
              disabled={disabled}
              onChange={(event) => onNotesChange(event.target.value)}
              className="min-h-16"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="camera">Cámara</Label>
            <div className="flex gap-2">
              <select
                id="camera"
                value={deviceId}
                disabled={disabled || devices.length === 0}
                onChange={(event) => onDeviceChange(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {devices.length === 0 ? (
                  <option value="">Buscando cámaras…</option>
                ) : (
                  devices.map((device) => (
                    <option key={device.deviceId} value={device.deviceId}>
                      {device.label || `Cámara ${device.deviceId.slice(0, 8)}`}
                    </option>
                  ))
                )}
              </select>
              <Button
                variant="outline"
                size="icon"
                aria-label="Actualizar lista de cámaras"
                onClick={onRefreshDevices}
                disabled={disabled}
              >
                <RefreshCw />
              </Button>
            </div>
          </div>
        </div>

        <Separator />

        <div className="grid grid-cols-2 gap-3">
          <NumberField
            label="Fotos"
            value={count}
            min={1}
            max={200}
            integer
            suffix="img"
            disabled={disabled}
            onChange={(value) => onSettingsChange("count", value)}
          />
          <NumberField
            label="Duración"
            value={durationSeconds}
            min={2}
            max={120}
            step={0.5}
            suffix="s"
            disabled={disabled}
            onChange={(value) => onSettingsChange("durationMs", Math.round(value * 1000))}
          />
          <NumberField
            label="Tamaño"
            value={size}
            min={128}
            max={512}
            step={16}
            integer
            suffix="px"
            disabled={disabled}
            onChange={(value) => onSettingsChange("size", value)}
          />
          <NumberField
            label="Calidad"
            value={quality}
            min={0.5}
            max={0.95}
            step={0.05}
            disabled={disabled}
            onChange={(value) => onSettingsChange("quality", value)}
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Camera className="size-4 text-muted-foreground" />
            <div className="leading-tight">
              <p className="text-sm">Escala de grises</p>
              <p className="text-[11px] text-muted-foreground">El modelo se entrena sobre imágenes en gris</p>
            </div>
          </div>
          <Switch
            checked={grayscale}
            disabled={disabled}
            onCheckedChange={(value) => onSettingsChange("grayscale", value)}
            aria-label="Escala de grises"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            {muted ? <VolumeX className="size-4 text-muted-foreground" /> : <Volume2 className="size-4 text-muted-foreground" />}
            <div className="leading-tight">
              <p className="text-sm">Sonido</p>
              <p className="text-[11px] text-muted-foreground">Beeps de cuenta regresiva y disparo</p>
            </div>
          </div>
          <Switch
            checked={!muted}
            disabled={disabled}
            onCheckedChange={(value) => onMutedChange(!value)}
            aria-label="Sonido de captura"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground">
          <span>
            {fps} fps · {size}×{size} px
          </span>
          <span>≈ {formatBytes(estimatedBytes)}</span>
        </div>

        <Button className="w-full" size="lg" disabled={!canStart} onClick={onStart}>
          <Play /> Iniciar captura
        </Button>
      </CardContent>
    </Card>
  )
}
