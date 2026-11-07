import { useCallback, useEffect, useRef, useState } from "react"

const STORAGE_KEY = "piezas-cnn.camera"
const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 1280 },
  height: { ideal: 720 },
  frameRate: { ideal: 30 },
}

export type CameraStatus = "idle" | "requesting" | "ready" | "error"

function describeError(error: DOMException | null | undefined): string {
  switch (error?.name) {
    case "NotAllowedError":
    case "SecurityError":
      return "Permiso de cámara denegado. Habilítalo en el navegador y vuelve a intentarlo."
    case "NotFoundError":
    case "DevicesNotFoundError":
      return "No se encontró ninguna cámara conectada."
    case "NotReadableError":
    case "TrackStartError":
      return "La cámara está en uso por otra aplicación."
    case "OverconstrainedError":
      return "La cámara seleccionada no está disponible."
    default:
      return error?.message ? `No se pudo abrir la cámara: ${error.message}` : "No se pudo abrir la cámara."
  }
}

export function useCamera() {
  const [stream, setStream] = useState<MediaStream | null>(null)
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [deviceId, setDeviceId] = useState("")
  const [status, setStatus] = useState<CameraStatus>("idle")
  const [error, setError] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const mountedRef = useRef(false)
  const requestIdRef = useRef(0)
  const activeIdRef = useRef("")

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const refreshDevices = useCallback(async (): Promise<MediaDeviceInfo[]> => {
    if (!navigator.mediaDevices?.enumerateDevices) return []
    try {
      const allDevices = await navigator.mediaDevices.enumerateDevices()
      const cameras = allDevices.filter((device) => device.kind === "videoinput")
      if (mountedRef.current) setDevices(cameras)
      return cameras
    } catch {
      return []
    }
  }, [])

  const open = useCallback(
    async (preferredId = ""): Promise<MediaStream | null> => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setStatus("error")
        setError("Este navegador no soporta acceso a la cámara. Usa Chrome, Edge o Safari actualizado.")
        return null
      }

      const requestId = requestIdRef.current + 1
      requestIdRef.current = requestId
      setStatus("requesting")
      setError(null)

      const attempt = (id: string) => {
        const videoConstraints: MediaTrackConstraints = { ...VIDEO_CONSTRAINTS }
        if (id) videoConstraints.deviceId = { exact: id }
        return navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints })
      }

      // Hasta 2 intentos: cámara preferida y, si falla por Overconstrained/
      // NotFound, reintento con la cámara por defecto.
      let id = preferredId
      for (let attemptNo = 0; attemptNo < 2; attemptNo += 1) {
        try {
          const nextStream = await attempt(id)
          if (!mountedRef.current || requestId !== requestIdRef.current) {
            nextStream.getTracks().forEach((track) => track.stop())
            return null
          }

          stopStream()
          streamRef.current = nextStream
          setStream(nextStream)

          const actualId = nextStream.getVideoTracks()[0]?.getSettings()?.deviceId || id
          activeIdRef.current = actualId
          setDeviceId(actualId)
          if (actualId) localStorage.setItem(STORAGE_KEY, actualId)

          setStatus("ready")
          void refreshDevices()
          return nextStream
        } catch (cameraError) {
          if (!mountedRef.current || requestId !== requestIdRef.current) return null
          const error = cameraError as DOMException
          const canRetryDefault =
            Boolean(id) && (error.name === "OverconstrainedError" || error.name === "NotFoundError")
          if (canRetryDefault) {
            localStorage.removeItem(STORAGE_KEY)
            activeIdRef.current = ""
            id = ""
            continue
          }
          stopStream()
          setStream(null)
          setStatus("error")
          setError(describeError(error))
          return null
        }
      }
      return null
    },
    [refreshDevices, stopStream],
  )

  useEffect(() => {
    mountedRef.current = true
    const preferredId = localStorage.getItem(STORAGE_KEY) ?? ""
    void open(preferredId)

    const handleDeviceChange = () => {
      void refreshDevices()
    }
    navigator.mediaDevices?.addEventListener?.("devicechange", handleDeviceChange)

    return () => {
      mountedRef.current = false
      requestIdRef.current += 1
      navigator.mediaDevices?.removeEventListener?.("devicechange", handleDeviceChange)
      stopStream()
    }
  }, [open, refreshDevices, stopStream])

  const selectCamera = useCallback(
    (id: string) => {
      if (!id || id === activeIdRef.current) return
      localStorage.setItem(STORAGE_KEY, id)
      activeIdRef.current = id
      setDeviceId(id)
      void open(id)
    },
    [open],
  )

  const retry = useCallback(() => {
    const preferred = activeIdRef.current || localStorage.getItem(STORAGE_KEY) || ""
    void open(preferred)
  }, [open])

  return {
    stream,
    devices,
    deviceId,
    status,
    error,
    selectCamera,
    retry,
    refreshDevices,
  }
}
