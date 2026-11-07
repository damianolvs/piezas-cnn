import type { CaptureSettings } from "./types"

// Convierte la imagen del canvas a escala de grises (luma) in-place.
function grayscaleInPlace(context: CanvasRenderingContext2D, size: number): void {
  const image = context.getImageData(0, 0, size, size)
  const data = image.data
  for (let i = 0; i < data.length; i += 4) {
    const luma = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114 + 500) / 1000
    const value = luma | 0
    data[i] = value
    data[i + 1] = value
    data[i + 2] = value
  }
  context.putImageData(image, 0, 0)
}

// Recorta el cuadrado central del video, lo escala a size×size, aplica grises
// opcional y devuelve un Blob JPEG. Reutiliza el canvas pasado para no crearlo
// en cada frame.
export function captureFrame(
  video: HTMLVideoElement,
  settings: Pick<CaptureSettings, "size" | "grayscale" | "quality">,
  canvas?: HTMLCanvasElement | null,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const sourceWidth = video.videoWidth
    const sourceHeight = video.videoHeight
    if (!sourceWidth || !sourceHeight) {
      resolve(null)
      return
    }

    const { size, grayscale, quality } = settings
    const side = Math.min(sourceWidth, sourceHeight)
    const sourceX = Math.round((sourceWidth - side) / 2)
    const sourceY = Math.round((sourceHeight - side) / 2)

    const target = canvas ?? document.createElement("canvas")
    if (target.width !== size || target.height !== size) {
      target.width = size
      target.height = size
    }
    const context = target.getContext("2d", { willReadFrequently: grayscale })
    if (!context) {
      resolve(null)
      return
    }

    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = "high"
    context.drawImage(video, sourceX, sourceY, side, side, 0, 0, size, size)

    if (grayscale) grayscaleInPlace(context, size)

    target.toBlob((blob) => resolve(blob), "image/jpeg", quality)
  })
}

// Crea un Blob a partir de un frame concreto del stream para la línea de
// producción (inferencia). Recorta el cuadrado central igual que el módulo de
// captura (las imágenes de entrenamiento son cuadradas) y NO aplica grises: el
// servicio de inferencia ya normaliza a gris.
export function snapshotFrame(
  video: HTMLVideoElement,
  canvas?: HTMLCanvasElement | null,
  size = 640,
): Promise<Blob | null> {
  return new Promise((resolve) => {
    const sourceWidth = video.videoWidth
    const sourceHeight = video.videoHeight
    if (!sourceWidth || !sourceHeight) {
      resolve(null)
      return
    }
    const side = Math.min(sourceWidth, sourceHeight)
    const sourceX = Math.round((sourceWidth - side) / 2)
    const sourceY = Math.round((sourceHeight - side) / 2)

    const target = canvas ?? document.createElement("canvas")
    if (target.width !== size || target.height !== size) {
      target.width = size
      target.height = size
    }
    const context = target.getContext("2d")
    if (!context) {
      resolve(null)
      return
    }
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = "high"
    context.drawImage(video, sourceX, sourceY, side, side, 0, 0, size, size)
    target.toBlob((blob) => resolve(blob), "image/jpeg", 0.92)
  })
}
