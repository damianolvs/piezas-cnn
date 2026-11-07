// ---------------------------------------------------------------------------
// Tipos de dominio compartidos. Espejo del contrato de la API Express (:3001)
// y del servicio FastAPI de inferencia (proxied por /api).
// ---------------------------------------------------------------------------

// --- Captura -----------------------------------------------------------------
export interface CaptureSettings {
  count: number
  durationMs: number
  size: number
  quality: number
  grayscale: boolean
}

export interface CameraInfo {
  deviceId: string
  label: string
}

export interface SessionFrame {
  index: number
  file: string
  timeMs: number | null
  bytes: number
}

export type SessionStatus = "recording" | "completed" | "partial"

export interface SessionMetadata {
  id: string
  label: string
  notes: string
  status: SessionStatus
  createdAt: string
  completedAt: string | null
  colorSpace: "grayscale" | "color"
  settings: CaptureSettings
  camera: CameraInfo
  frames: SessionFrame[]
  capturedCount: number
  uploadedCount: number
  failedCount: number
  totalBytes: number
  actualDurationMs: number | null
  userAgent: string
}

// --- Modelo / inferencia -----------------------------------------------------
export interface ModelInfo {
  classes: string[]
  class_to_idx: Record<string, number>
  input_size: number
  mean: number[]
  std: number[]
  widths: number[]
  best_epoch: number
  val_acc: number
  threshold: number
  params: number
  inferenceUrl?: string
}

export interface Prediction {
  class_name: string
  confidence: number
  unsure: boolean
  threshold: number
  probabilities: Record<string, number>
  latency_ms: number
}

// --- Datasets ----------------------------------------------------------------
export interface SplitCounts {
  [className: string]: number
}

export interface DatasetInfo {
  name: string
  splitCounts: {
    train: SplitCounts
    valid: SplitCounts
    test: SplitCounts
  }
  imageCount: number
  manifest: Record<string, unknown> | null
}

export interface DatasetBuildSummary {
  name: string
  sessions_total: number
  sessions_used: number
  quarantined: string[]
  images_copied: number
  splits: {
    train: SplitCounts
    valid: SplitCounts
    test: SplitCounts
  }
  per_class: Record<string, number>
}

// --- Entrenamiento -----------------------------------------------------------
export type TrainingStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export interface TrainingParams {
  dataset: string
  epochs: number
  lr: number
  batchSize: number
  seed: number
}

export interface TrainingJob {
  id: string
  dataset: string
  params: TrainingParams
  status: TrainingStatus
  epoch: number
  totalEpochs: number
  progress: number
  log: string[]
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

// --- Fases de captura ----------------------------------------------------------
export type CapturePhase =
  | "idle"
  | "countdown"
  | "preparing"
  | "capturing"
  | "finishing"
  | "done"
  | "error"

// --- Error de API --------------------------------------------------------------
export interface ApiError extends Error {
  status?: number
}

// --- Navegación de la app -------------------------------------------------------
export type ModuleKey = "capture" | "training" | "production"
