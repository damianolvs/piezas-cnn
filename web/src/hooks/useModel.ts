import { useCallback, useEffect, useState } from "react"
import { getModel } from "../lib/api"
import type { ModelInfo } from "../lib/types"

interface UseModelResult {
  model: ModelInfo | null
  loading: boolean
  error: string | null
  available: boolean
  refresh: () => Promise<void>
}

export function useModel(): UseModelResult {
  const [model, setModel] = useState<ModelInfo | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const info = await getModel()
      setModel(info)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Servicio de inferencia no disponible")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return {
    model,
    loading,
    error,
    available: model !== null && !error,
    refresh,
  }
}
