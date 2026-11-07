// Gestor de jobs de entrenamiento: ejecuta `python src/train.py` como proceso hijo,
// captura stdout/stderr, parsea el progreso (líneas "ep N | ...") y lo expone vía EventEmitter
// para servirlo por SSE. Concurrencia limitada (1 job a la vez) para evitar OOM en CPU/GPU.
import { randomUUID } from "node:crypto"
import { spawn, type ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import path from "node:path"

export type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled"

export interface TrainParams {
  dataset: string
  epochs: number
  lr: number
  batchSize: number
  seed: number
}

export interface TrainingJob {
  id: string
  dataset: string
  params: TrainParams
  status: JobStatus
  epoch: number
  totalEpochs: number
  progress: number // 0..1
  log: string[]
  startedAt: string | null
  finishedAt: string | null
  error: string | null
}

const MAX_CONCURRENT = 1
const LOG_TAIL = 200

export class TrainingJobManager {
  private jobs = new Map<string, TrainingJob>()
  private queue: string[] = []
  private running = 0
  private children = new Map<string, ChildProcess>()
  private events = new EventEmitter()
  private python: string
  private root: string

  constructor(root: string, python = path.join(root, ".venv", "bin", "python")) {
    this.root = root
    this.python = python
  }

  list(): TrainingJob[] {
    return [...this.jobs.values()].sort((a, b) => (a.startedAt ?? a.id) < (b.startedAt ?? b.id) ? 1 : -1)
  }

  get(id: string): TrainingJob | undefined {
    return this.jobs.get(id)
  }

  create(params: TrainParams): TrainingJob {
    const id = randomUUID().slice(0, 8)
    const job: TrainingJob = {
      id,
      dataset: params.dataset,
      params,
      status: "queued",
      epoch: 0,
      totalEpochs: params.epochs,
      progress: 0,
      log: [],
      startedAt: null,
      finishedAt: null,
      error: null,
    }
    this.jobs.set(id, job)
    this.queue.push(id)
    this.events.emit(id, job)
    this._pump()
    return job
  }

  cancel(id: string): boolean {
    const job = this.jobs.get(id)
    if (!job) return false
    if (job.status === "running") {
      this.children.get(id)?.kill("SIGTERM")
    } else if (job.status === "queued") {
      this.queue = this.queue.filter((q) => q !== id)
      job.status = "cancelled"
      job.finishedAt = new Date().toISOString()
      this._emit(id)
    }
    return true
  }

  subscribe(id: string, listener: (job: TrainingJob) => void): () => void {
    this.events.on(id, listener)
    return () => this.events.off(id, listener)
  }

  shutdown(): void {
    for (const child of this.children.values()) child.kill("SIGTERM")
  }

  private _pump(): void {
    while (this.running < MAX_CONCURRENT && this.queue.length > 0) {
      const id = this.queue.shift()!
      const job = this.jobs.get(id)
      if (!job) continue
      this._spawn(job)
    }
  }

  private _spawn(job: TrainingJob): void {
    this.running += 1
    job.status = "running"
    job.startedAt = new Date().toISOString()
    this._emit(job.id)

    const datasetPath = path.join(this.root, "data", job.params.dataset)
    const args = [
      path.join(this.root, "src", "train.py"),
      "--dataset", datasetPath,
      "--epochs", String(job.params.epochs),
      "--lr", String(job.params.lr),
      "--batch-size", String(job.params.batchSize),
      "--seed", String(job.params.seed),
    ]
    this._log(job, `$ ${this.python} ${args.map((a) => (a.includes(" ") ? `"${a}"` : a)).join(" ")}`)

    let child: ChildProcess
    try {
      child = spawn(this.python, args, {
        cwd: this.root,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      })
    } catch (error) {
      job.status = "failed"
      job.error = String(error)
      job.finishedAt = new Date().toISOString()
      this.running -= 1
      this._emit(job.id)
      this._pump()
      return
    }

    this.children.set(job.id, child)

    const parseEpoch = (line: string): number | null => {
      const match = line.match(/\bep\s+(\d+)\s*\|/)
      return match ? Number(match[1]) : null
    }

    child.stdout?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (!line.trim()) continue
        this._log(job, line)
        const epoch = parseEpoch(line)
        if (epoch !== null) {
          job.epoch = epoch
          job.progress = Math.min(1, epoch / job.totalEpochs)
          this._emit(job.id)
        }
      }
    })
    child.stderr?.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) this._log(job, line)
      }
    })

    child.on("error", (error) => {
      job.status = "failed"
      job.error = error.message
      job.finishedAt = new Date().toISOString()
      this._log(job, `ERROR: ${error.message}`)
      this.children.delete(job.id)
      this.running -= 1
      this._emit(job.id)
      this._pump()
    })

    child.on("close", (code, signal) => {
      this.children.delete(job.id)
      this.running -= 1
      if (job.status === "cancelled") {
        // ya marcado por cancel()
      } else if (code === 0) {
        job.status = "completed"
        job.progress = 1
        job.epoch = job.totalEpochs
      } else {
        job.status = "failed"
        job.error = signal ? `Terminado por señal ${signal}` : `Proceso terminó con código ${code}`
      }
      job.finishedAt = new Date().toISOString()
      this._emit(job.id)
      this._pump()
    })
  }

  private _log(job: TrainingJob, line: string): void {
    job.log.push(line)
    if (job.log.length > LOG_TAIL) job.log.splice(0, job.log.length - LOG_TAIL)
  }

  private _emit(id: string): void {
    const job = this.jobs.get(id)
    if (job) this.events.emit(id, job)
  }
}

export function datasetExists(root: string, name: string): boolean {
  const base = path.join(root, "data", name)
  return existsSync(path.join(base, "train")) && existsSync(path.join(base, "valid")) && existsSync(path.join(base, "test"))
}
