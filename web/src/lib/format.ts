export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB"
  if (bytes < 1024) return `${Math.round(bytes)} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds) / 1000
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)} s`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = Math.round(totalSeconds % 60)
  return `${minutes} min ${String(seconds).padStart(2, "0")} s`
}

export function formatPercent(value: number, decimals = 0): string {
  if (!Number.isFinite(value)) return "—"
  return `${(value * 100).toFixed(decimals)}%`
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-MX").format(value)
}

export function formatLatency(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`
  return `${(milliseconds / 1000).toFixed(2)} s`
}
