// Rutas ML: proxy a FastAPI (inferencia), gestión de datasets ensamblados y jobs de entrenamiento.
import { execFile } from "node:child_process"
import { promisify } from "node:util"
import fs from "node:fs/promises"
import path from "node:path"
import { Router, type Response } from "express"
import multer from "multer"
import { datasetExists, type TrainParams, type TrainingJobManager } from "./jobs.js"

const execFileAsync = promisify(execFile)

const FASTAPI_URL = process.env.FASTAPI_URL || "http://127.0.0.1:8000"
const SPLITS = ["train", "valid", "test"] as const

interface Deps {
  root: string
  jobs: TrainingJobManager
}

const predictUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)) cb(null, true)
    else cb(Object.assign(new Error("Se espera una imagen (JPEG/PNG)"), { status: 415 }))
  },
})

async function scanDataset(root: string, name: string) {
  const base = path.join(root, "data", name)
  const splitCounts: Record<string, Record<string, number>> = {}
  let imageCount = 0
  for (const split of SPLITS) {
    const splitDir = path.join(base, split)
    const entries = await fs.readdir(splitDir, { withFileTypes: true }).catch(() => [])
    const perClass: Record<string, number> = {}
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const files = (await fs.readdir(path.join(splitDir, entry.name)).catch(() => [])).filter(
        (f) => f.toLowerCase().endsWith(".jpg"),
      )
      perClass[entry.name] = files.length
      imageCount += files.length
    }
    splitCounts[split] = perClass
  }
  let manifest: unknown = null
  try {
    manifest = JSON.parse(await fs.readFile(path.join(base, "split_manifest.json"), "utf8"))
  } catch {
    manifest = null
  }
  return { name, splitCounts, imageCount, manifest }
}

async function forwardToFastAPI(url: string, init?: RequestInit): Promise<Response> {
  // Intenta alcanzar FastAPI; mapea fallos de conexión a 503 y respeta el código del upstream.
  let upstream: globalThis.Response
  try {
    upstream = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) })
  } catch {
    throw Object.assign(new Error("El servicio de inferencia (FastAPI) no responde"), { status: 503 })
  }
  const body = (await upstream.json().catch(() => ({ error: "Respuesta no JSON del servicio de inferencia" }))) as Record<
    string,
    unknown
  >
  if (!upstream.ok) {
    const detail = String(body.detail ?? body.error ?? `Inferencia falló (${upstream.status})`)
    throw Object.assign(new Error(detail), {
      status: upstream.status >= 500 ? 502 : upstream.status,
    })
  }
  return body as unknown as Response
}

export function createMlRouter({ root, jobs }: Deps): Router {
  const router = Router()

  // ---- Modelo ---------------------------------------------------------------
  router.get("/model", async (_req, res) => {
    const info = await forwardToFastAPI(`${FASTAPI_URL}/model`)
    res.json({ ...info, inferenceUrl: FASTAPI_URL })
  })

  // ---- Inferencia -----------------------------------------------------------
  router.post("/predict", predictUpload.single("file"), async (req, res) => {
    if (!req.file) throw Object.assign(new Error("Falta la imagen"), { status: 400 })
    const form = new FormData()
    form.append("file", new Blob([req.file.buffer], { type: req.file.mimetype }), req.file.originalname)
    const result = await forwardToFastAPI(`${FASTAPI_URL}/predict`, { method: "POST", body: form })
    res.json(result)
  })

  // ---- Datasets ensamblados -------------------------------------------------
  router.get("/datasets", async (_req, res) => {
    const dataDir = path.join(root, "data")
    const entries = await fs.readdir(dataDir, { withFileTypes: true }).catch(() => [])
    const datasets = []
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (datasetExists(root, entry.name)) datasets.push(await scanDataset(root, entry.name))
    }
    res.json({ datasets })
  })

  router.get("/datasets/:name", async (req, res) => {
    const name = String(req.params.name)
    if (!datasetExists(root, name)) throw Object.assign(new Error("Dataset no encontrado"), { status: 404 })
    res.json({ dataset: await scanDataset(root, name) })
  })

  router.post("/datasets/build", async (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const name = String(body.name ?? "").trim()
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(name)) {
      throw Object.assign(new Error("Nombre de dataset inválido (solo minúsculas, números y guiones)"), { status: 400 })
    }
    const script = path.join(root, "src", "dataset_builder.py")
    const args = ["--name", name, "--json"]
    if (body.force === true) args.push("--force")
    if (body.seed !== undefined) args.push("--seed", String(body.seed))
    if (body.validRatio !== undefined) args.push("--valid-ratio", String(body.validRatio))
    if (body.testRatio !== undefined) args.push("--test-ratio", String(body.testRatio))

    try {
      const { stdout } = await execFileAsync(path.join(root, ".venv", "bin", "python"), [script, ...args], {
        cwd: root,
      })
      const summary = JSON.parse(stdout.trim().split("\n").pop() ?? "{}")
      res.json({ ok: true, summary })
    } catch (error) {
      const err = error as { code?: number; stderr?: string; stdout?: string }
      const message = err.stderr?.trim().split("\n").pop() || err.stdout?.trim().split("\n").pop() || String(error)
      throw Object.assign(new Error(message), { status: 400 })
    }
  })

  // ---- Jobs de entrenamiento ------------------------------------------------
  router.get("/training", (_req, res) => {
    res.json({ jobs: jobs.list() })
  })

  router.post("/training", (req, res) => {
    const body = (req.body ?? {}) as Record<string, unknown>
    const dataset = String(body.dataset ?? "").trim()
    if (!datasetExists(root, dataset)) {
      throw Object.assign(new Error("El dataset no existe o está incompleto. Constrúyelo primero."), { status: 400 })
    }
    const params: TrainParams = {
      dataset,
      epochs: clampInt(body.epochs, 200, 1, 2000),
      lr: clampNumber(body.lr, 2e-3, 1e-6, 1e-1),
      batchSize: clampInt(body.batchSize, 8, 1, 128),
      seed: clampInt(body.seed, 0, 0, 2 ** 31 - 1),
    }
    const job = jobs.create(params)
    res.status(202).json({ job })
  })

  router.get("/training/:id", (req, res) => {
    const job = jobs.get(String(req.params.id))
    if (!job) throw Object.assign(new Error("Job no encontrado"), { status: 404 })
    res.json({ job })
  })

  router.post("/training/:id/cancel", (req, res) => {
    const ok = jobs.cancel(String(req.params.id))
    if (!ok) throw Object.assign(new Error("Job no encontrado"), { status: 404 })
    res.json({ ok: true })
  })

  router.get("/training/:id/events", (req, res) => {
    const id = String(req.params.id)
    const job = jobs.get(id)
    if (!job) throw Object.assign(new Error("Job no encontrado"), { status: 404 })

    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    })
    res.write(`data: ${JSON.stringify({ job })}\n\n`)

    const unsubscribe = jobs.subscribe(id, (updated) => {
      res.write(`data: ${JSON.stringify({ job: updated })}\n\n`)
      if (updated.status === "completed" || updated.status === "failed" || updated.status === "cancelled") {
        res.write("data: [done]\n\n")
        res.end()
      }
    })

    req.on("close", () => {
      unsubscribe()
      res.end()
    })
  })

  return router
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max))
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}
