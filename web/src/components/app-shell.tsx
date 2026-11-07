import type { ReactNode } from "react"
import { BrainCircuit, Camera, Factory, ScanLine } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ModuleKey } from "@/lib/types"
import { useModel } from "@/hooks/useModel"

interface NavItem {
  key: ModuleKey
  label: string
  description: string
  icon: typeof Camera
}

const NAV: NavItem[] = [
  { key: "capture", label: "Captura", description: "Capturar dataset", icon: Camera },
  { key: "training", label: "Entrenamiento", description: "Entrenar el modelo", icon: BrainCircuit },
  { key: "production", label: "Producción", description: "Clasificar en vivo", icon: Factory },
]

const NAV_META: Record<ModuleKey, { title: string; subtitle: string }> = {
  capture: { title: "Captura de fotos", subtitle: "Genera sesiones de dataset etiquetadas" },
  training: { title: "Entrenamiento", subtitle: "Ensambla el dataset y entrena la CNN" },
  production: { title: "Línea de producción", subtitle: "Clasifica piezas en tiempo real" },
}

export function AppShell({
  moduleKey,
  onNavigate,
  children,
}: {
  moduleKey: ModuleKey
  onNavigate: (key: ModuleKey) => void
  children: ReactNode
}) {
  const { model, available, loading } = useModel()
  const meta = NAV_META[moduleKey]

  return (
    <div className="flex min-h-svh bg-background text-foreground">
      {/* Sidebar */}
      <aside className="sticky top-0 hidden h-svh w-60 shrink-0 flex-col border-r border-border bg-sidebar lg:flex">
        <div className="flex h-14 items-center gap-2.5 border-b border-border px-5">
          <span className="flex size-7 items-center justify-center rounded-md bg-foreground text-background">
            <ScanLine className="size-4" strokeWidth={2.25} />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-semibold tracking-tight">Piezas CNN</p>
            <p className="text-[11px] text-muted-foreground">Clasificador de piezas</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV.map((item) => {
            const Icon = item.icon
            const active = item.key === moduleKey
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => onNavigate(item.key)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-accent-foreground",
                )}
              >
                <Icon className="size-4 shrink-0" strokeWidth={2} />
                <span className="flex flex-col leading-tight">
                  <span>{item.label}</span>
                  <span className={cn("text-[11px]", active ? "text-muted-foreground" : "text-muted-foreground/70")}>
                    {item.description}
                  </span>
                </span>
              </button>
            )
          })}
        </nav>

        <div className="border-t border-border p-4">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "size-2 rounded-full",
                available ? "bg-emerald-500" : loading ? "bg-amber-400" : "bg-red-500",
              )}
              aria-hidden="true"
            />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-medium">
                {loading ? "Consultando modelo…" : available ? "Modelo listo" : "Modelo sin conexión"}
              </p>
              {model && (
                <p className="truncate text-[11px] text-muted-foreground">
                  {model.classes.length} clases · umbral {Math.round(model.threshold * 100)}%
                </p>
              )}
            </div>
          </div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b border-border px-6">
          <div>
            <h1 className="text-sm font-semibold tracking-tight">{meta.title}</h1>
            <p className="text-xs text-muted-foreground">{meta.subtitle}</p>
          </div>
        </header>
        <main className="flex-1 p-6">{children}</main>
      </div>
    </div>
  )
}
