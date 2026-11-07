import { useEffect, useRef, useState } from "react"
import { toast } from "sonner"
import { useCamera } from "@/hooks/useCamera"
import { useCapture } from "@/hooks/useCapture"
import { CameraPreview } from "./camera-preview"
import { CaptureOverlay } from "./capture-overlay"
import { CapturePanel } from "./capture-panel"
import { SettingsPanel } from "./settings-panel"
import { SessionSummary } from "./session-summary"
import type { CameraInfo, CaptureSettings } from "@/lib/types"

const SETTINGS_KEY = "piezas-cnn.settings"
const MUTED_KEY = "piezas-cnn.muted"

const DEFAULT_SETTINGS: CaptureSettings = {
  count: 50,
  durationMs: 10_000,
  size: 224,
  quality: 0.75,
  grayscale: true,
}

function loadSettings(): CaptureSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw) as Partial<CaptureSettings>
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

function loadBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key)
    return raw === null ? fallback : raw === "true"
  } catch {
    return fallback
  }
}

export function CapturePage() {
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const camera = useCamera()
  const capture = useCapture({ videoRef, canvasRef })

  const [label, setLabel] = useState("")
  const [notes, setNotes] = useState("")
  const [muted, setMuted] = useState(() => loadBool(MUTED_KEY, false))
  const [settings, setSettings] = useState<CaptureSettings>(loadSettings)

  useEffect(() => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
  }, [settings])

  useEffect(() => {
    localStorage.setItem(MUTED_KEY, String(muted))
  }, [muted])

  const { phase } = capture
  const busy = phase === "countdown" || phase === "preparing" || phase === "capturing" || phase === "finishing"
  const showCapturePanel = phase === "preparing" || phase === "capturing" || phase === "finishing"
  const canStart = camera.status === "ready" && label.trim().length > 0 && !busy

  const updateSetting = <K extends keyof CaptureSettings>(key: K, value: CaptureSettings[K]) => {
    setSettings((previous) => ({ ...previous, [key]: value }))
  }

  const handleStart = () => {
    const cameraInfo: CameraInfo = {
      deviceId: camera.deviceId,
      label: camera.devices.find((device) => device.deviceId === camera.deviceId)?.label ?? "",
    }
    void capture.start({ label: label.trim(), notes: notes.trim(), settings, muted, camera: cameraInfo })
  }

  const handleReset = () => {
    capture.reset()
    setLabel("")
    setNotes("")
  }

  useEffect(() => {
    if (capture.error) toast.error(capture.error)
  }, [capture.error])

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-3">
        <CameraPreview
          videoRef={videoRef}
          stream={camera.stream}
          status={camera.status}
          error={camera.error}
          onRetry={camera.retry}
        >
          <CaptureOverlay phase={phase} countdown={capture.countdown} captured={capture.captured} total={capture.total} />
        </CameraPreview>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {settings.size}×{settings.size} px · {settings.grayscale ? "grises" : "color"} · calidad{" "}
            {Math.round(settings.quality * 100)}%
          </span>
          <span>{camera.devices.length} cámara{camera.devices.length === 1 ? "" : "s"}</span>
        </div>
      </div>

      <div>
        {phase === "done" && capture.summary ? (
          <SessionSummary summary={capture.summary} onReset={handleReset} />
        ) : showCapturePanel ? (
          <CapturePanel
            phase={phase}
            captured={capture.captured}
            total={capture.total}
            elapsedMs={capture.elapsedMs}
            size={settings.size}
            disabled={phase === "finishing" || phase === "preparing"}
            onStop={capture.stop}
          />
        ) : (
          <SettingsPanel
            label={label}
            notes={notes}
            settings={settings}
            muted={muted}
            devices={camera.devices.map((device) => ({ deviceId: device.deviceId, label: device.label }))}
            deviceId={camera.deviceId}
            disabled={busy}
            canStart={canStart}
            onLabelChange={setLabel}
            onNotesChange={setNotes}
            onSettingsChange={updateSetting}
            onMutedChange={setMuted}
            onDeviceChange={camera.selectCamera}
            onRefreshDevices={() => void camera.refreshDevices()}
            onStart={handleStart}
          />
        )}
      </div>
    </div>
  )
}
