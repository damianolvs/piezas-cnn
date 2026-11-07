import { useState } from "react"
import { AppShell } from "@/components/app-shell"
import { CapturePage } from "@/features/capture/capture-page"
import { TrainingPage } from "@/features/training/training-page"
import { ProductionPage } from "@/features/production/production-page"
import { Toaster } from "@/components/ui/sonner"
import type { ModuleKey } from "@/lib/types"

export default function App() {
  const [moduleKey, setModuleKey] = useState<ModuleKey>("capture")

  return (
    <>
      <AppShell moduleKey={moduleKey} onNavigate={setModuleKey}>
        {moduleKey === "capture" && <CapturePage />}
        {moduleKey === "training" && <TrainingPage />}
        {moduleKey === "production" && <ProductionPage />}
      </AppShell>
      <Toaster />
    </>
  )
}
