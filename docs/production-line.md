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
- Si `confidence < threshold` (0.60), el resultado se marca **"No seguro"** (no se fuerza una clase).
- Se muestran las barras de probabilidad ordenadas y la latencia del servicio.

## Consideraciones de despliegue

- **Latencia**: ~16 ms/img en CPU de escritorio; en una Raspberry Pi 5 puede subir. Ajusta el
  intervalo del modo continuo si es necesario.
- **Iluminación**: la inferencia re-normaliza a gris; mantén una iluminación consistente con la
  del dataset de entrenamiento (fondo uniforme).
- **Umbral**: `CONFIDENCE_THRESHOLD = 0.60` en `src/dataset.py`. Auméntalo para ser más
  conservador (menos falsos positivos, más "No seguro").
