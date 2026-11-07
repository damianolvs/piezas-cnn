import cors from "cors"
import express, { type NextFunction, type Request, type Response } from "express"
import multer from "multer"
import fs from "node:fs/promises"
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// ---------------------------------------------------------------------------
// Rutas base. `server/src/index.ts` -> `server` -> raíz del repositorio.
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, "..", "..")
const DATASETS_DIR = path.resolve(ROOT, "datasets")
const DIST_DIR = path.resolve(ROOT, "web", "dist")
const PORT = Number(process.env.PORT) || 3001
const ID_RE = /^[a-z0-9][a-z0-9-]{0,120}$/

await fs.mkdir(DATASETS_DIR, { recursive: true })

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------
interface CaptureSettings {
  count: number
  durationMs: number
  size: number
  quality: number
  grayscale: boolean
}

interface SessionFrame {
  index: number
  file: string
  timeMs: number | null
  bytes: number
}

interface SessionMetadata {
  id: string
  label: string
  notes: string
  status: "recording" | "completed" | "partial"
  createdAt: string
  completedAt: string | null
  colorSpace: "grayscale" | "color"
  settings: CaptureSettings
  camera: { deviceId: string; label: string }
  frames: SessionFrame[]
  capturedCount: number
  uploadedCount: number
  failedCount: number
  totalBytes: number
  actualDurationMs: number | null
  userAgent: string
}

interface HttpError extends Error {
  status?: number
}

// ---------------------------------------------------------------------------
// App + middleware
// ---------------------------------------------------------------------------
const app = express()
app.disable("x-powered-by")
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }))
app.use(express.json({ limit: "1mb" }))

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype !== "image/jpeg") {
      cb(Object.assign(new Error("El archivo debe ser una imagen JPEG"), { status: 415 }))
      return
    }
    cb(null, true)
  },
})

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const sessionLocks = new Map<string, Promise<unknown>>()

function withSessionLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = (sessionLocks.get(id) ?? Promise.resolve()) as Promise<unknown>
  const run = previous.then(task, task)
  const guarded = run.catch(() => {})
  sessionLocks.set(id, guarded)
  return run.finally(() => {
    if (sessionLocks.get(id) === guarded) sessionLocks.delete(id)
  })
}

function httpError(status: number, message: string): never {
  throw Object.assign(new Error(message), { status })
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max))
}

function normalizeSettings(raw: unknown = {}): CaptureSettings {
  const value = (raw ?? {}) as Record<string, unknown>
  return {
    count: clampInt(value.count, 50, 1, 500),
    durationMs: clampInt(value.durationMs, 10_000, 1000, 300_000),
    size: clampInt(value.size, 224, 64, 1024),
    quality: Math.round(clampNumber(value.quality, 0.75, 0.3, 1) * 100) / 100,
    grayscale: value.grayscale !== false,
  }
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
  return slug || "sesion"
}

function timestamp(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0")
  return (
    [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())].join("") +
    "-" +
    [pad(date.getHours()), pad(date.getMinutes()), pad(date.getSeconds())].join("")
  )
}

async function uniqueSessionId(base: string): Promise<string> {
  for (let attempt = 1; attempt < 100; attempt += 1) {
    const id = attempt === 1 ? base : `${base}-${attempt}`
    try {
      await fs.access(path.join(DATASETS_DIR, id))
    } catch {
      return id
    }
  }
  throw httpError(409, "No se pudo generar un nombre de carpeta único")
}

function sessionDir(id: string): string {
  if (!ID_RE.test(id)) throw httpError(400, "Identificador de sesión inválido")
  const dir = path.resolve(DATASETS_DIR, id)
  if (!dir.startsWith(DATASETS_DIR + path.sep)) {
    throw httpError(400, "Ruta de sesión inválida")
  }
  return dir
}

async function readMetadata(dir: string): Promise<SessionMetadata> {
  try {
    const raw = await fs.readFile(path.join(dir, "metadata.json"), "utf8")
    return JSON.parse(raw) as SessionMetadata
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw httpError(404, "Sesión no encontrada")
    }
    throw error
  }
}

async function writeMetadata(dir: string, metadata: SessionMetadata): Promise<void> {
  const file = path.join(dir, "metadata.json")
  const temp = path.join(dir, "metadata.json.tmp")
  await fs.writeFile(temp, JSON.stringify(metadata, null, 2) + "\n")
  await fs.rename(temp, file)
}

// ---------------------------------------------------------------------------
// Rutas: salud
// ---------------------------------------------------------------------------
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "piezas-cnn",
    datasets: "datasets/",
    time: new Date().toISOString(),
  })
})

// ---------------------------------------------------------------------------
// Rutas: sesiones de captura
// ---------------------------------------------------------------------------
app.get("/api/sessions", async (_req, res) => {
  const entries = await fs.readdir(DATASETS_DIR, { withFileTypes: true })
  const sessions: SessionMetadata[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    try {
      sessions.push(await readMetadata(path.join(DATASETS_DIR, entry.name)))
    } catch {
      // las carpetas sin metadata.json se ignoran
    }
  }
  sessions.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
  res.json({ sessions })
})

app.post("/api/sessions", async (req, res) => {
  const body = (req.body ?? {}) as Record<string, unknown>
  const label = String(body.label ?? "").trim()
  if (!label) throw httpError(400, "La etiqueta del objeto es obligatoria")
  if (label.length > 80) throw httpError(400, "La etiqueta no puede superar 80 caracteres")

  const notes = String(body.notes ?? "").trim().slice(0, 1000)
  const settings = normalizeSettings(body.settings)
  const cameraRaw = (body.camera ?? {}) as Record<string, unknown>
  const camera = {
    deviceId: String(cameraRaw.deviceId ?? "").slice(0, 200),
    label: String(cameraRaw.label ?? "").slice(0, 200),
  }

  const id = await uniqueSessionId(`${slugify(label)}-${timestamp()}`)
  const dir = sessionDir(id)
  await fs.mkdir(dir, { recursive: false })

  const metadata: SessionMetadata = {
    id,
    label,
    notes,
    status: "recording",
    createdAt: new Date().toISOString(),
    completedAt: null,
    colorSpace: settings.grayscale ? "grayscale" : "color",
    settings,
    camera,
    frames: [],
    capturedCount: 0,
    uploadedCount: 0,
    failedCount: 0,
    totalBytes: 0,
    actualDurationMs: null,
    userAgent: String(req.get("user-agent") ?? "").slice(0, 300),
  }

  await writeMetadata(dir, metadata)
  res.status(201).json({ session: metadata, folder: `datasets/${id}` })
})

app.post("/api/sessions/:id/frames", upload.single("frame"), async (req, res) => {
  const id = String(req.params.id)
  const dir = sessionDir(id)
  if (!req.file) throw httpError(400, "Falta la imagen de la foto")

  const index = Number(req.body.index)
  const timeMs = Number(req.body.timeMs)
  if (!Number.isInteger(index) || index < 0 || index > 9999) {
    throw httpError(400, "Índice de foto inválido")
  }

  const filename = `frame_${String(index).padStart(3, "0")}.jpg`

  const metadata = await withSessionLock(id, async () => {
    const current = await readMetadata(dir)
    await fs.writeFile(path.join(dir, filename), req.file!.buffer)

    current.frames = current.frames.filter((frame) => frame.index !== index)
    current.frames.push({
      index,
      file: filename,
      timeMs: Number.isFinite(timeMs) ? Math.max(0, Math.round(timeMs)) : null,
      bytes: req.file!.size,
    })
    current.frames.sort((a, b) => a.index - b.index)
    current.capturedCount = current.frames.length
    current.totalBytes = current.frames.reduce((sum, frame) => sum + frame.bytes, 0)
    current.uploadedCount = current.frames.length

    await writeMetadata(dir, current)
    return current
  })

  res.json({ ok: true, capturedCount: metadata.capturedCount, bytes: req.file.size })
})

app.patch("/api/sessions/:id", async (req, res) => {
  const id = String(req.params.id)
  const dir = sessionDir(id)
  const body = (req.body ?? {}) as Record<string, unknown>
  const status = body.status === "completed" ? "completed" : "partial"

  const metadata = await withSessionLock(id, async () => {
    const current = await readMetadata(dir)
    current.status = status
    current.completedAt = new Date().toISOString()
    current.uploadedCount = current.frames.length
    if (Number.isFinite(Number(body.actualDurationMs))) {
      current.actualDurationMs = Math.max(0, Math.round(Number(body.actualDurationMs)))
    }
    if (Number.isFinite(Number(body.failedCount))) {
      current.failedCount = Math.max(0, Math.round(Number(body.failedCount)))
    }
    await writeMetadata(dir, current)
    return current
  })

  res.json({ session: metadata })
})

// ---------------------------------------------------------------------------
// Frontend construido (producción)
// ---------------------------------------------------------------------------
if (existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.use((req, res, next) => {
    if (req.method !== "GET" || req.path.startsWith("/api")) return next()
    res.sendFile(path.join(DIST_DIR, "index.html"), (error) => {
      if (error) next(error)
    })
  })
}

// ---------------------------------------------------------------------------
// Manejo de errores
// ---------------------------------------------------------------------------
app.use((err: HttpError, _req: Request, res: Response, _next: NextFunction) => {
  if (res.headersSent) return
  if (err instanceof multer.MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400
    const message =
      err.code === "LIMIT_FILE_SIZE" ? "La foto supera el límite de 2 MB" : `Error al recibir la foto: ${err.code}`
    res.status(status).json({ error: message })
    return
  }
  const status = Number(err.status) || 500
  if (status >= 500) console.error(err)
  res.status(status).json({ error: err.message || "Error interno del servidor" })
})

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`API de Piezas CNN en http://localhost:${PORT}`)
  console.log(`Datasets: ${DATASETS_DIR}`)
  if (!existsSync(DIST_DIR)) {
    console.log("Modo desarrollo: abre http://localhost:5173 (pnpm dev)")
  }
})
