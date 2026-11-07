# Arquitectura

## Resumen

Piezas CNN es un monorepo `pnpm` con un frontend React, una API Express y un servicio de
inferencia FastAPI que envuelve una CNN de PyTorch. Los tres procesos se comunican por HTTP.

```
Frontend (Vite, :5173)
   │  /api/*  (proxy en dev, mismo origen en prod)
   ▼
Express API (:3001)
   │  ├─ sesiones de captura  →  datasets/<id>/
   │  ├─ datasets             →  python src/dataset_builder.py
   │  ├─ training jobs        →  python src/train.py (spawn, SSE)
   │  └─ /api/predict         →  proxy a FastAPI
   ▼
FastAPI (:8000)
   │  carga models/model.pt una sola vez (lifespan)
   └─ /predict  →  Prediction
```

## Workspace `pnpm`

- `pnpm-workspace.yaml` declara los paquetes `web` y `server`.
- Raíz (`package.json`, name `piezas-cnn` v2.0.0) orquesta los scripts `dev`/`build`/`start`.
- `concurrently` levanta los tres servicios en `pnpm dev`.

## Frontend (`web/`, `@piezas-cnn/web`)

- React 19 + Vite 7 + TypeScript (estricto).
- Tailwind CSS v4 con el preset **radix-nova** de shadcn/ui (paleta neutral, fuente Geist, dark por defecto).
- Componentes shadcn/ui en `src/components/ui/`; iconos `lucide-react`.
- Navegación por estado (`ModuleKey`) con `AppShell` (sidebar + header + footer con estado del modelo).

### Módulos

| Carpeta | Módulo | Responsabilidad |
|---|---|---|
| `features/capture/` | Captura | cámara, ráfaga, sesión, resumen |
| `features/training/` | Entrenamiento | dataset builder + jobs |
| `features/production/` | Producción | inferencia continua / foto |

### Capa de datos

- `lib/api.ts` — cliente HTTP tipado, con timeout y cancelación. Único punto de acceso a la API.
- `lib/types.ts` — tipos del contrato (espejo del backend).
- `hooks/useCamera.ts`, `useCapture.ts`, `useModel.ts` — estado de cámara, máquina de captura y modelo.

## API Express (`server/`, `@piezas-cnn/server`)

- Express 5 + TypeScript (`tsx` para dev).
- `src/index.ts` — arranque, middleware, sesiones de captura, manejo de errores, sirve `web/dist`.
- `src/ml.ts` — router de ML: proxy de inferencia, datasets y jobs de entrenamiento.
- `src/jobs.ts` — `TrainingJobManager`: cola de 1 job concurrente, parseo de progreso y SSE.

### Decisiones

- **Concurrencia de entrenamiento limitada a 1** (evita OOM/CPU y solapamiento de `models/model.pt`).
- **`spawn` con array de argumentos** (nunca interpolación de strings) para evitar inyección de comandos.
- **Jobs en memoria** (no persisten entre reinicios): suficiente para un operador local; los logs
  se rotan a las últimas 200 líneas.
- **Escritura atómica de `metadata.json`** (tmp + rename) y **lock por sesión** para lecturas/escrituras concurrentes.

## Servicio de inferencia (`src/inference_service.py`)

- FastAPI + uvicorn, escucha en `:8000` (configurable con `FASTAPI_URL` en el lado Express).
- Carga `models/model.pt` **una vez** en el `lifespan`, reconstruye `SmallCNN` con `widths` y `classes`
  del checkpoint (no se hardcodean), y aplica `base_transform(input_size)` exacta:
  `Resize → Grayscale(3ch) → ToTensor → Normalize(0.5, 0.5)`.
- `torch.inference_mode()` para la predicción; CPU por defecto.

## Python (`src/`)

Módulos planos (sin `__init__.py`), importados como top-level (`from model import SmallCNN`).
Se ejecutan con el directorio del script en `sys.path` (p. ej. `python src/train.py`) o con
`uvicorn --app-dir src`.

| Módulo | Función |
|---|---|
| `dataset.py` | carga, `base_transform`/`train_transform`, `CONFIDENCE_THRESHOLD` |
| `model.py` | `SmallCNN` |
| `train.py` | entrenamiento → `models/model.pt` |
| `evaluate.py` | `load_model`, `predict`, métricas, matriz de confusión |
| `inspect_dataset.py` | conteos, fugas, cuadrículas |
| `download_dataset.py` | descarga Roboflow |
| `dataset_builder.py` | **nuevo** — ensambla sesiones en dataset sin fugas |
| `inference_service.py` | **nuevo** — FastAPI de inferencia |

## Flujos de datos

- **Captura**: webcam → `captureFrame` (recorte central, grises luma, JPEG) → `POST /api/sessions/:id/frames`.
- **Dataset**: sesiones `datasets/*/` → `dataset_builder.py` → `data/<nombre>/train|valid|test/<clase>/`.
- **Entrenamiento**: `POST /api/training` → `TrainingJobManager` → `python src/train.py` → `models/model.pt`.
- **Producción**: frame → `POST /api/predict` → FastAPI → `Prediction`.
