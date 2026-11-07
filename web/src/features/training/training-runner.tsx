import { useCallback, useEffect, useMemo, useState } from "react"
import { Loader2, Play, RefreshCw, Square, Terminal } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { NumberField } from "@/features/capture/number-field"
import { cancelTraining, listDatasets, listTrainingJobs, startTraining, streamTrainingEvents } from "@/lib/api"
import type { DatasetInfo, TrainingJob, TrainingStatus } from "@/lib/types"
import { cn } from "@/lib/utils"

const STATUS_VARIANT: Record<TrainingStatus, "default" | "secondary" | "outline" | "destructive"> = {
  queued: "secondary",
  running: "default",
  completed: "outline",
  failed: "destructive",
  cancelled: "outline",
}

const STATUS_LABEL: Record<TrainingStatus, string> = {
  queued: "En cola",
  running: "Entrenando",
  completed: "Completado",
  failed: "Falló",
  cancelled: "Cancelado",
}

export function TrainingRunner() {
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [jobs, setJobs] = useState<TrainingJob[]>([])
  const [selectedDataset, setSelectedDataset] = useState("")
  const [epochs, setEpochs] = useState(200)
  const [lr, setLr] = useState(0.002)
  const [batchSize, setBatchSize] = useState(8)
  const [seed, setSeed] = useState(0)
  const [submitting, setSubmitting] = useState(false)

  const load = useCallback(async () => {
    try {
      const [datasetsRes, jobsRes] = await Promise.all([listDatasets(), listTrainingJobs()])
      setDatasets(datasetsRes.datasets)
      setJobs(jobsRes.jobs)
      setSelectedDataset((previous) => previous || datasetsRes.datasets[0]?.name || "")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar el entrenamiento")
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const activeJob = useMemo(() => jobs.find((job) => job.status === "running" || job.status === "queued"), [jobs])

  useEffect(() => {
    if (!activeJob) return undefined
    const stop = streamTrainingEvents(
      activeJob.id,
      (updated) => {
        setJobs((previous) => previous.map((job) => (job.id === updated.id ? updated : job)))
      },
      () => {
        void load()
      },
    )
    return stop
  }, [activeJob?.id, load])

  const handleStart = async () => {
    if (!selectedDataset) {
      toast.error("Selecciona un dataset para entrenar")
      return
    }
    setSubmitting(true)
    try {
      const { job } = await startTraining({ dataset: selectedDataset, epochs, lr, batchSize, seed })
      toast.success("Entrenamiento encolado")
      setJobs((previous) => [job, ...previous])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo iniciar el entrenamiento")
    } finally {
      setSubmitting(false)
    }
  }

  const handleCancel = async (id: string) => {
    try {
      await cancelTraining(id)
      toast.success("Cancelando entrenamiento…")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cancelar")
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Entrenar modelo</CardTitle>
            <CardDescription>Lanza un entrenamiento de la CNN sobre un dataset preparado.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dataset-select">Dataset</Label>
              <select
                id="dataset-select"
                value={selectedDataset}
                onChange={(event) => setSelectedDataset(event.target.value)}
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
              >
                {datasets.length === 0 ? (
                  <option value="">No hay datasets disponibles</option>
                ) : (
                  datasets.map((dataset) => (
                    <option key={dataset.name} value={dataset.name}>
                      {dataset.name} ({dataset.imageCount} imgs)
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Épocas" value={epochs} min={1} max={2000} integer onChange={setEpochs} />
              <NumberField label="Tamaño de lote" value={batchSize} min={1} max={128} integer onChange={setBatchSize} />
              <NumberField label="Learning rate" value={lr} min={0.00001} max={0.1} step={0.0005} onChange={setLr} />
              <NumberField label="Semilla" value={seed} min={0} max={9999} integer onChange={setSeed} />
            </div>

            <Button className="w-full" size="lg" disabled={!selectedDataset || submitting || Boolean(activeJob)} onClick={handleStart}>
              {submitting ? <Loader2 className="animate-spin" /> : <Play />}
              {submitting ? "Encolando…" : "Iniciar entrenamiento"}
            </Button>

            {activeJob && (
              <p className="text-center text-[11px] text-muted-foreground">
                Solo se permite un entrenamiento a la vez.
              </p>
            )}
          </CardContent>
        </Card>

        {datasets.length === 0 && (
          <Card>
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              No hay datasets listos. Construye uno en la pestaña <strong>Preparar dataset</strong>.
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            Trabajos de entrenamiento
            <Button variant="ghost" size="icon-sm" onClick={() => void load()} aria-label="Actualizar trabajos">
              <RefreshCw />
            </Button>
          </CardTitle>
          <CardDescription>Progreso en vivo y log del proceso de entrenamiento.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {jobs.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              <Terminal className="mx-auto mb-2 size-6" />
              <p>Aún no hay entrenamientos.</p>
            </div>
          ) : (
            <ul className="space-y-2">
              {jobs.map((job) => (
                <li key={job.id} className="rounded-lg border border-border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">{job.dataset}</span>
                        <Badge variant={STATUS_VARIANT[job.status]}>{STATUS_LABEL[job.status]}</Badge>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">
                        {job.params.epochs} épocas · lr {job.params.lr} · lote {job.params.batchSize}
                      </p>
                    </div>
                    {job.status === "running" && (
                      <Button variant="ghost" size="icon-sm" onClick={() => handleCancel(job.id)} aria-label="Cancelar entrenamiento">
                        <Square />
                      </Button>
                    )}
                  </div>

                  {(job.status === "running" || job.status === "queued") && (
                    <div className="mt-2 space-y-1.5">
                      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                        <span>
                          {job.status === "running" ? `Época ${job.epoch}/${job.totalEpochs}` : "Esperando turno…"}
                        </span>
                        <span className="tabular-nums">{Math.round(job.progress * 100)}%</span>
                      </div>
                      <Progress value={job.progress * 100} />
                    </div>
                  )}

                  {job.error && <p className="mt-2 text-xs text-destructive">{job.error}</p>}

                  {job.log.length > 0 && (
                    <ScrollArea className="mt-2 h-24 rounded-md bg-muted/50 p-2 font-mono text-[11px] leading-relaxed">
                      {job.log.map((line, index) => (
                        <p key={index} className={cn("whitespace-pre-wrap", line.includes("error") || line.includes("Error") ? "text-destructive" : "text-muted-foreground")}>
                          {line}
                        </p>
                      ))}
                    </ScrollArea>
                  )}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
