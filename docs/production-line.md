# Línea de producción

El módulo **Producción** clasifica piezas contra `models/model.pt` usando la cámara.

## Modos

| Modo | Comportamiento |
|---|---|
| **Continuo** | Clasifica automáticamente cada ~600 ms mientras la cámara está activa. |
| **Foto (snapshot)** | Captura un único frame y lo clasifica al pulsar **Clasificar**. |

## Flujo

1. El frontend abre la cámara (`useCamera`).
2. En modo continuo, cada 600 ms se obtiene un frame con `snapshotFrame` (JPEG) y se envía a
   `POST /api/predict`.
3. Express reenvía el archivo a FastAPI (`:8000`), que lo preprocesa con `base_transform` y
   devuelve la clase, la confianza y las probabilidades por clase.

## Interpretación del resultado

- La clase con mayor probabilidad se muestra con un **Badge** de color:
  `Good-part` = verde, `Scrap` = ámbar, `No-Piece-Detected` = azul.
- **Rechazo de desconocidos**: si `confidence < threshold` (0.60 por defecto) **o**
  `margin < margin_threshold` (0.15 por defecto), el resultado se marca como **"Desconocido"** en
  lugar de forzar una clase. El *margen* es la diferencia entre la probabilidad top-1 y la top-2: un
  margen pequeño indica que el modelo duda entre dos clases.
- La tarjeta **"Rechazo de desconocidos"** permite ajustar ambos umbrales en vivo con dos sliders
  (confianza mínima 30–95 %, margen mínimo 0–50 %); se persisten en `localStorage`
  (`piezas-cnn.rejection`).
- Se muestran las barras de probabilidad ordenadas, el margen y la latencia del servicio.

## Consideraciones de despliegue

- **Latencia**: ~16 ms/img en CPU de escritorio; en una Raspberry Pi 5 puede subir. Ajusta el
  intervalo del modo continuo si es necesario.
- **Iluminación**: la inferencia re-normaliza a gris; mantén una iluminación consistente con la
  del dataset de entrenamiento (fondo uniforme).
- **Umbral**: `CONFIDENCE_THRESHOLD = 0.60` en `src/dataset.py` es el valor por defecto; puede
  sobreescribirse con las variables de entorno `UNKNOWN_CONFIDENCE_THRESHOLD` y
  `UNKNOWN_MARGIN_THRESHOLD`, o en caliente desde la UI. Súbelo para ser más conservador (menos
  falsos positivos, más "Desconocido"); bájalo si el modelo está bien entrenado y quieres menos
  rechazos.
- **Cerrar el dominio**: "Desconocido" es una red de seguridad, no una solución. Para que la
  detección sea fiable, reentrena con piezas reales (Captura → dataset builder → entrenamiento) y,
  opcionalmente, captura ejemplos etiquetados como `desconocido` para añadir una cuarta clase.
