# API

Base: `/api`. Todas las respuestas de error son JSON `{ "error": string }`, con los códigos
`400` (petición inválida), `404` (no encontrado), `409` (conflicto), `413` (archivo muy grande),
`415` (formato no soportado), `500` (interno). Los errores de proxy hacia FastAPI devuelven
`502` (upstream 5xx) o `503` (servicio de inferencia no disponible).

## Salud y modelo

### `GET /api/health`
```json
{ "ok": true, "service": "piezas-cnn", "datasets": "datasets/", "time": "…" }
```

### `GET /api/model`
Metadatos del checkpoint cargado en el servicio de inferencia.
```json
{
  "classes": ["Good-part", "No-Piece-Detected", "Scrap"],
  "class_to_idx": { "Good-part": 0, "No-Piece-Detected": 1, "Scrap": 2 },
  "input_size": 160, "mean": [0.5,0.5,0.5], "std": [0.5,0.5,0.5],
  "widths": [16,32,64,96], "best_epoch": 286, "val_acc": 0.8695,
  "threshold": 0.6, "params": 82387, "inferenceUrl": "http://127.0.0.1:8000"
}
```

### `POST /api/predict`
Clasifica una imagen. `multipart/form-data` con el campo `file` (JPEG/PNG/WebP, ≤ 5 MB).

```json
{
  "class_name": "No-Piece-Detected",
  "confidence": 0.9594,
  "unsure": false,
  "threshold": 0.6,
  "probabilities": { "Good-part": 0.0333, "No-Piece-Detected": 0.9594, "Scrap": 0.0073 },
  "latency_ms": 15.8
}
```

## Sesiones de captura

### `GET /api/sessions`
```json
{ "sessions": [ { …SessionMetadata } ] }
```

### `POST /api/sessions`
Crea una sesión. Body JSON:
```json
{
  "label": "pieza-buena",           // obligatorio, ≤ 80 chars
  "notes": "luz difusa",            // opcional, ≤ 1000
  "settings": {
    "count": 50, "durationMs": 10000, "size": 224, "quality": 0.75, "grayscale": true
  },
  "camera": { "deviceId": "…", "label": "FaceTime HD Camera" }
}
```
Clamps del servidor: `count` 1–500, `durationMs` 1000–300000, `size` 64–1024, `quality` 0.3–1.0,
`grayscale` por defecto `true`. Respuesta `201`:
```json
{ "session": { …SessionMetadata }, "folder": "datasets/pieza-buena-20261106-200511" }
```

### `POST /api/sessions/:id/frames`
Sube una foto. `multipart/form-data`: `frame` (JPEG, ≤ 2 MB) + `index` (entero) + `timeMs`.
Idempotente por `index` (reemplaza el frame previo con el mismo índice).
```json
{ "ok": true, "capturedCount": 10, "bytes": 2245 }
```

### `PATCH /api/sessions/:id`
Finaliza la sesión. Body: `{ "status": "completed"|"partial", "actualDurationMs": 10008, "failedCount": 0 }`.
Respuesta `{ "session": { … } }`.

### `SessionMetadata`
```json
{
  "id": "pieza-buena-20261106-200511",
  "label": "pieza-buena", "notes": "",
  "status": "completed",
  "createdAt": "…", "completedAt": "…",
  "colorSpace": "grayscale",
  "settings": { "count": 50, "durationMs": 10000, "size": 224, "quality": 0.75, "grayscale": true },
  "camera": { "deviceId": "…", "label": "…" },
  "frames": [ { "index": 0, "file": "frame_000.jpg", "timeMs": 100, "bytes": 920 } ],
  "capturedCount": 1, "uploadedCount": 1, "failedCount": 0, "totalBytes": 920,
  "actualDurationMs": 1000, "userAgent": "…"
}
```

## Datasets

### `GET /api/datasets`
```json
{ "datasets": [ { "name": "…", "splitCounts": { "train": {}, "valid": {}, "test": {} }, "imageCount": 0, "manifest": null } ] }
```

### `POST /api/datasets/build`
Construye un dataset desde las sesiones. Body:
```json
{ "name": "mi-dataset", "force": false, "seed": 0, "validRatio": 0.15, "testRatio": 0.15 }
```
`name` cumple `^[a-z0-9][a-z0-9-]{0,80}$`. Respuesta:
```json
{
  "ok": true,
  "summary": {
    "name": "mi-dataset", "sessions_total": 30, "sessions_used": 28,
    "quarantined": ["etiqueta-ambigua-…"], "images_copied": 1400,
    "splits": { "train": {}, "valid": {}, "test": {} },
    "per_class": { "Good-part": 28, "No-Piece-Detected": 0, "Scrap": 0 }
  }
}
```

### `GET /api/datasets/:name`
```json
{ "dataset": { "name": "…", "splitCounts": {…}, "imageCount": 1400, "manifest": {…} } }
```

## Entrenamiento

### `GET /api/training`
```json
{ "jobs": [ { …TrainingJob } ] }
```

### `POST /api/training`
Lanza un job. Body: `{ "dataset": "mi-dataset", "epochs": 200, "lr": 0.002, "batchSize": 8, "seed": 0 }`.
Clamps: `epochs` 1–2000, `lr` 1e-6–0.1, `batchSize` 1–128, `seed` ≥ 0. Respuesta `202 { "job": {…} }`.
El job queda `queued` si ya hay uno corriendo (máximo 1 concurrente).

### `GET /api/training/:id`
```json
{ "job": { …TrainingJob } }
```

### `POST /api/training/:id/cancel`
```json
{ "ok": true }
```

### `GET /api/training/:id/events`
Server-Sent Events. Emite `data: {…TrainingJob}` en cada actualización y `data: [done]` al terminar.

### `TrainingJob`
```json
{
  "id": "a1b2c3d4", "dataset": "mi-dataset",
  "params": { "dataset": "mi-dataset", "epochs": 200, "lr": 0.002, "batchSize": 8, "seed": 0 },
  "status": "running", "epoch": 120, "totalEpochs": 200, "progress": 0.6,
  "log": ["ep 120 | train loss 0.4 acc 0.85 | valid loss 0.5 acc 0.8"],
  "startedAt": "…", "finishedAt": null, "error": null
}
```
`status ∈ { queued, running, completed, failed, cancelled }`.
