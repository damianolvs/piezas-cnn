import { useCallback, useEffect, useMemo, useState } from "react"
import { Boxes, FolderOpen, Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { NumberField } from "@/features/capture/number-field"
import { buildDataset, listDatasets, listSessions } from "@/lib/api"
import { formatBytes, formatNumber } from "@/lib/format"
import type { DatasetBuildSummary, DatasetInfo, SessionMetadata } from "@/lib/types"

export function DatasetBuilder() {
  const [sessions, setSessions] = useState<SessionMetadata[]>([])
  const [datasets, setDatasets] = useState<DatasetInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [name, setName] = useState("")
  const [validRatio, setValidRatio] = useState(0.15)
  const [testRatio, setTestRatio] = useState(0.15)
  const [seed, setSeed] = useState(0)
  const [force, setForce] = useState(false)
  const [building, setBuilding] = useState(false)
  const [summary, setSummary] = useState<DatasetBuildSummary | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [sessionsRes, datasetsRes] = await Promise.all([listSessions(), listDatasets()])
      setSessions(sessionsRes.sessions)
      setDatasets(datasetsRes.datasets)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo cargar los datos")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const completeSessions = useMemo(() => sessions.filter((s) => s.status !== "recording"), [sessions])
  const labelCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of completeSessions) {
      counts.set(session.label, (counts.get(session.label) ?? 0) + session.frames.length)
    }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])
  }, [completeSessions])

  const handleBuild = async () => {
    setBuilding(true)
    setSummary(null)
    try {
      const result = await buildDataset({ name, force, seed, validRatio, testRatio })
      setSummary(result.summary)
      toast.success(`Dataset "${result.summary.name}" creado con ${result.summary.images_copied} imágenes`)
      void load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "No se pudo construir el dataset")
    } finally {
      setBuilding(false)
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Construir dataset</CardTitle>
            <CardDescription>
              Agrupa las sesiones capturadas por etiqueta y las reparte en train/valid/test sin fuga.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dataset-name">Nombre del dataset</Label>
              <Input
                id="dataset-name"
                value={name}
                placeholder="ej. piezas-v1"
                onChange={(event) => setName(event.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))}
              />
              <p className="text-xs text-muted-foreground">Solo minúsculas, números y guiones.</p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <NumberField
                label="Validación"
                value={validRatio}
                min={0.05}
                max={0.4}
                step={0.05}
                suffix="%"
                onChange={(value) => setValidRatio(value)}
              />
              <NumberField
                label="Prueba"
                value={testRatio}
                min={0.05}
                max={0.4}
                step={0.05}
                suffix="%"
                onChange={(value) => setTestRatio(value)}
              />
              <NumberField label="Semilla" value={seed} min={0} max={9999} integer onChange={(value) => setSeed(value)} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
              <div className="leading-tight">
                <p className="text-sm">Sobrescribir</p>
                <p className="text-xs text-muted-foreground">Reemplazar el dataset si ya existe</p>
              </div>
              <Switch checked={force} onCheckedChange={setForce} aria-label="Sobrescribir dataset" />
            </div>

            <Button className="w-full" disabled={!name || building} onClick={handleBuild}>
              {building ? <Loader2 className="animate-spin" /> : <Boxes />}
              {building ? "Construyendo…" : "Construir dataset"}
            </Button>

            {summary && (
              <div className="space-y-2 rounded-lg bg-muted/50 p-3 text-xs">
                <p className="font-medium">Resumen de construcción</p>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-muted-foreground">
                  <span>Imágenes copiadas</span>
                  <span className="text-right font-medium text-foreground">{formatNumber(summary.images_copied)}</span>
                  <span>Sesiones usadas</span>
                  <span className="text-right font-medium text-foreground">
                    {summary.sessions_used}/{summary.sessions_total}
                  </span>
                  {summary.quarantined.length > 0 && (
                    <>
                      <span>En cuarentena</span>
                      <span className="text-right font-medium text-foreground">{summary.quarantined.length}</span>
                    </>
                  )}
                </div>
                {summary.quarantined.length > 0 && (
                  <p className="text-amber-600 dark:text-amber-400">
                    Etiquetas sin clasificar: {summary.quarantined.join(", ")}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              Sesiones capturadas
              <Button variant="ghost" size="icon-sm" onClick={() => void load()} aria-label="Actualizar">
                <RefreshCw />
              </Button>
            </CardTitle>
            <CardDescription>
              {completeSessions.length} sesión{completeSessions.length === 1 ? "" : "es"} ·{" "}
              {formatBytes(completeSessions.reduce((sum, s) => sum + s.totalBytes, 0))} en total
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Cargando…</p>
            ) : labelCounts.length === 0 ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <FolderOpen className="mx-auto mb-2 size-6" />
                <p>Aún no hay sesiones capturadas.</p>
                <p className="text-xs">Ve al módulo de Captura para generar tu primer dataset.</p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Etiqueta</TableHead>
                    <TableHead className="text-right">Fotos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {labelCounts.map(([label, count]) => (
                    <TableRow key={label}>
                      <TableCell className="font-medium">{label}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatNumber(count)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Datasets existentes</CardTitle>
            <CardDescription>Listos para entrenar.</CardDescription>
          </CardHeader>
          <CardContent>
            {datasets.length === 0 ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Ningún dataset construido todavía.</p>
            ) : (
              <ul className="space-y-2">
                {datasets.map((dataset) => (
                  <li key={dataset.name} className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2 text-sm">
                    <span className="font-medium">{dataset.name}</span>
                    <span className="text-xs text-muted-foreground">{formatNumber(dataset.imageCount)} imgs</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
