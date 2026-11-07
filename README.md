# Piezas CNN · Clasificador de piezas

Aplicación integral para clasificar piezas industriales en una banda transportadora con una CNN propia
entrenada desde cero en PyTorch. Reúne en un solo proyecto las tres etapas del ciclo de vida del modelo:

1. **Captura** — genera datasets etiquetados fotografiando objetos con la webcam.
2. **Entrenamiento** — ensambla el dataset (sin fugas de datos) y entrena la CNN con progreso en vivo.
3. **Línea de producción** — clasifica piezas en tiempo real contra el modelo entrenado.

> Proyecto de IA (UTCH). La CNN (`SmallCNN`, ~82 k parámetros) clasifica la imagen completa de la pieza.

## Clases y umbral

| Clase | Significado |
|---|---|
| `Good-part` | Objeto completo, en una sola pieza |
| `Scrap` | El mismo objeto partido en 2 piezas |
| `No-Piece-Detected` | Banda vacía (sin pieza) |

Si la probabilidad máxima es menor a `0.60` (`CONFIDENCE_THRESHOLD`), la salida se marca como **"No seguro"**.

## Arquitectura

```
┌──────────────┐   /api/*    ┌─────────────────────┐   /predict   ┌──────────────────┐
│  Frontend     │ ─────────▶ │  Express (3001)      │ ─────────▶ │  FastAPI (8000)   │
│  React +      │            │  · sesiones captura  │             │  · carga model.pt │
│  shadcn/ui    │            │  · datasets + jobs   │ ◀───────── │  · inferencia     │
│  (Vite, TS)   │            │  · proxy inferencia  │   resultado │  (torch, CPU)    │
└──────────────┘            └─────────────────────┘             └──────────────────┘
                                      │
                                      │ spawn
                                      ▼
                            ┌──────────────────┐
                            │  python src/      │
                            │  train.py (job)   │
                            └──────────────────┘
```

- **Frontend** (`web/`): React 19 + Vite + TypeScript + Tailwind CSS + shadcn/ui + lucide-react. Tema oscuro en escala de grises.
- **API** (`server/`): Express 5 (TypeScript). Gestiona sesiones de captura, ensamblado de datasets, jobs de entrenamiento y hace de proxy hacia el servicio de inferencia.
- **ML** (`src/` + FastAPI): CNN en PyTorch + servicio de inferencia que carga el modelo una sola vez.

Ver [`docs/architecture.md`](docs/architecture.md) para más detalle.

## Estructura del repositorio

```
piezas-cnn/
├── web/                 # Frontend React + shadcn/ui (pnpm workspace @piezas-cnn/web)
├── server/              # API Express + jobs (pnpm workspace @piezas-cnn/server)
├── src/                 # Python: dataset, modelo, train, evaluate + servicio de inferencia
├── models/model.pt      # Modelo entrenado (pesos + clases + normalización)
├── datasets/            # Sesiones de captura (gitignored)
├── data/                # Datasets ensamblados para entrenar (gitignored)
├── reports/             # Métricas, curvas, matriz de confusión (gitignored)
└── docs/                # Documentación
```

## Requisitos

- **Node.js** ≥ 20 y **pnpm** ≥ 9 (gestor de paquetes del frontend/backend).
- **Python** ≥ 3.12 (se recomienda la de Homebrew en macOS: `/opt/homebrew/bin/python3.12`). `torch` actual no soporta Python 3.9.

## Instalación

### 1. Dependencias JS (pnpm)

```bash
pnpm install
```

### 2. Entorno Python (venv)

```bash
/opt/homebrew/bin/python3.12 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

> En Windows: `.venv\Scripts\pip install -r requirements.txt`.

## Desarrollo

```bash
pnpm dev
```

Levanta en paralelo:

| Servicio | Puerto | Comando individual |
|---|---|---|
| API Express | `3001` | `pnpm dev:api` |
| Frontend Vite | `5173` | `pnpm dev:web` |
| Servicio de inferencia (FastAPI) | `8000` | `pnpm dev:ml` |

Abre **http://localhost:5173**. En desarrollo el frontend proxifica `/api` hacia `:3001`.

## Producción

```bash
pnpm build      # compila el frontend a web/dist
pnpm start      # sirve API + frontend desde :3001
```

El servicio de inferencia debe correr aparte (o vía `pnpm dev:ml`) y la variable `FASTAPI_URL`
indica dónde (default `http://127.0.0.1:8000`).

## Flujo de trabajo

### 1. Captura
En el módulo **Captura** indica la etiqueta del objeto (p. ej. `pieza-buena`, `pieza-rota`, `banda-vacia`),
ajusta los parámetros (fotos, duración, resolución, grises) y pulsa **Iniciar captura**. Cada sesión
se guarda en `datasets/<etiqueta>-<timestamp>/` con sus `frame_*.jpg` y `metadata.json`.

### 2. Entrenamiento
En el módulo **Entrenamiento**:

1. **Preparar dataset** — el ensamblador agrupa las sesiones por etiqueta → clase y reparte los
   objetos entre `train`/`valid`/`test` **sin fugas** (un mismo objeto nunca está en dos splits).
   Las etiquetas ambiguas van a cuarentena.
2. **Entrenar modelo** — elige epochs/lr/batch/seed y lanza el job. El progreso se ve en vivo
   (SSE) y el modelo se guarda en `models/model.pt`.

### 3. Línea de producción
Apunta la cámara a la banda y observa la clasificación en vivo, o toma una foto y clasifícala una sola vez.

## Pipeline Python (CLI)

Los scripts de `src/` siguen funcionando por línea de comandos:

```bash
export ROBOFLOW_API_KEY=...        # solo para descargar el dataset original
.venv/bin/python src/download_dataset.py
.venv/bin/python src/inspect_dataset.py
.venv/bin/python src/train.py --dataset data/<nombre> --epochs 200 --lr 2e-3 --batch-size 8
.venv/bin/python src/evaluate.py
```

## API

Resumen (base `/api`):

| Método | Ruta | Descripción |
|---|---|---|
| `GET` | `/health` | Salud de la API |
| `GET` / `POST` | `/sessions` | Listar / crear sesión de captura |
| `POST` | `/sessions/:id/frames` | Subir una foto |
| `PATCH` | `/sessions/:id` | Finalizar sesión |
| `GET` | `/model` | Info del modelo cargado |
| `POST` | `/predict` | Clasificar una imagen |
| `GET` / `POST` | `/datasets` | Listar / construir dataset |
| `GET` | `/datasets/:name` | Detalle de un dataset |
| `GET` / `POST` | `/training` | Listar / lanzar job de entrenamiento |
| `POST` | `/training/:id/cancel` | Cancelar job |
| `GET` | `/training/:id/events` | Progreso en vivo (SSE) |

Ver [`docs/api.md`](docs/api.md).

## Resultados actuales del modelo

- **Checkpoint** `models/model.pt`: `best_epoch=286`, `val_acc≈0.87` (20/23), 82 387 parámetros.
- **Inferencia**: ~16 ms por imagen en CPU.
- **Umbral de confianza**: 0.60.

## Limitaciones conocidas

- Dataset original muy pequeño (118 imágenes) y ruidoso; el split aleatorio de Roboflow **filtraba**
  objetos entre train y test (ya resuelto con el ensamblador por sesión/objeto).
- `No-Piece-Detected` carecía de imágenes en test.
- El modelo está subajustado y con baja confianza (muchas predicciones por debajo del umbral).
  La prioridad del proyecto es **recolectar más datos** con el módulo de captura.

## Documentación

- [`docs/architecture.md`](docs/architecture.md) — arquitectura y decisiones.
- [`docs/api.md`](docs/api.md) — contrato completo de la API.
- [`docs/training-pipeline.md`](docs/training-pipeline.md) — dataset builder y entrenamiento.
- [`docs/production-line.md`](docs/production-line.md) — línea de producción en vivo.
- [`docs/raspberry-pi.md`](docs/raspberry-pi.md) — despliegue en Raspberry Pi 5.
