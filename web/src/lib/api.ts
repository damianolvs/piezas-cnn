import type {
  ApiError,
  DatasetBuildSummary,
  DatasetInfo,
  ModelInfo,
  Prediction,
  SessionMetadata,
  TrainingJob,
  TrainingParams,
} from "./types"

// ---------------------------------------------------------------------------
// Cliente HTTP tipado. Todas las rutas son relativas a /api (proxy de Vite en
// dev; servidas por Express en producción).
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000

function apiError(status: number, message: string): ApiError {
  const error = new Error(message) as ApiError
  error.status = status
  return error
}

async function readResponse<T>(response: Response): Promise<T> {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok) {
    const message =
      (payload as { error?: string } | null)?.error ??
      (payload as { detail?: string } | null)?.detail ??
      `Error del servidor (${response.status})`
    throw apiError(response.status, message)
  }
  return payload as T
}

async function request<T>(url: string, init: RequestInit = {}, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    return await readResponse<T>(response)
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw apiError(504, "El servidor tardó demasiado en responder")
    }
    if (error instanceof TypeError) {
      throw apiError(0, "No se pudo conectar con el servidor")
    }
    throw error
  } finally {
    clearTimeout(timer)
  }
}

// --- Salud --------------------------------------------------------------------
export function health() {
  return request<{ ok: boolean; service: string; datasets: string; time: string }>("/api/health")
}

// --- Sesiones de captura --------------------------------------------------------
export function listSessions() {
  return request<{ sessions: SessionMetadata[] }>("/api/sessions")
}

export function createSession(payload: {
  label: string
  notes: string
  settings: unknown
  camera: { deviceId: string; label: string }
}) {
  return request<{ session: SessionMetadata; folder: string }>("/api/sessions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

export function uploadFrame(
  sessionId: string,
  payload: { blob: Blob; index: number; timeMs: number },
) {
  const form = new FormData()
  form.append("frame", payload.blob, `frame_${String(payload.index).padStart(3, "0")}.jpg`)
  form.append("index", String(payload.index))
  form.append("timeMs", String(Math.round(payload.timeMs)))

  return request<{ ok: boolean; capturedCount: number; bytes: number }>(
    `/api/sessions/${encodeURIComponent(sessionId)}/frames`,
    { method: "POST", body: form },
    60_000,
  )
}

export function finishSession(
  sessionId: string,
  payload: { status: "completed" | "partial"; actualDurationMs: number; failedCount: number },
) {
  return request<{ session: SessionMetadata }>(`/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

// --- Modelo / inferencia ----------------------------------------------------------
export function getModel() {
  return request<ModelInfo>("/api/model")
}

export function predict(blob: Blob) {
  const form = new FormData()
  form.append("file", blob, "frame.jpg")
  return request<Prediction>("/api/predict", { method: "POST", body: form }, 30_000)
}

// --- Datasets -----------------------------------------------------------------------
export function listDatasets() {
  return request<{ datasets: DatasetInfo[] }>("/api/datasets")
}

export function getDataset(name: string) {
  return request<{ dataset: DatasetInfo }>(`/api/datasets/${encodeURIComponent(name)}`)
}

export function buildDataset(payload: {
  name: string
  force?: boolean
  seed?: number
  validRatio?: number
  testRatio?: number
}) {
  return request<{ ok: boolean; summary: DatasetBuildSummary }>("/api/datasets/build", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  })
}

// --- Entrenamiento ---------------------------------------------------------------------
export function listTrainingJobs() {
  return request<{ jobs: TrainingJob[] }>("/api/training")
}

export function getTrainingJob(id: string) {
  return request<{ job: TrainingJob }>(`/api/training/${encodeURIComponent(id)}`)
}

export function startTraining(params: TrainingParams) {
  return request<{ job: TrainingJob }>("/api/training", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  })
}

export function cancelTraining(id: string) {
  return request<{ ok: boolean }>(`/api/training/${encodeURIComponent(id)}/cancel`, {
    method: "POST",
  })
}

// Stream de progreso por SSE. `onEvent` recibe el job actualizado; `onDone` se
// llama al terminar el stream. Devuelve una función de cancelación.
export function streamTrainingEvents(
  id: string,
  onEvent: (job: TrainingJob) => void,
  onDone: () => void,
): () => void {
  const controller = new AbortController()
  let closed = false

  const finish = () => {
    if (closed) return
    closed = true
    onDone()
  }

  void (async () => {
    try {
      const response = await fetch(`/api/training/${encodeURIComponent(id)}/events`, {
        signal: controller.signal,
      })
      if (!response.ok || !response.body) {
        finish()
        return
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })

        const parts = buffer.split("\n\n")
        buffer = parts.pop() ?? ""

        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "))
          if (!line) continue
          const data = line.slice("data: ".length).trim()
          if (data === "[done]") {
            finish()
            return
          }
          try {
            onEvent(JSON.parse(data) as TrainingJob)
          } catch {
            // ignorar payloads malformados
          }
        }
      }
      finish()
    } catch {
      finish()
    }
  })()

  return () => {
    controller.abort()
    finish()
  }
}
