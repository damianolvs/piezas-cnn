# Pipeline de entrenamiento

## Visión general

1. **Captura** produce sesiones en `datasets/<etiqueta>-<timestamp>/` con `metadata.json` y `frame_*.jpg`.
2. **`dataset_builder.py`** ensambla esas sesiones en un dataset `data/<nombre>/train|valid|test/<clase>/`.
3. **`train.py`** entrena `SmallCNN` sobre el dataset y guarda `models/model.pt`.

## Dataset builder (`src/dataset_builder.py`)

### Principio anti-fuga

La unidad de identidad es la **sesión de captura** (= un objeto físico), no la imagen. Un objeto
fotografiado 50 veces no debe aparecer a la vez en `train` y `test`, o la métrica queda inflada.

- Cada sesión completa/parcial con ≥ 1 frame se asigna **entera** a un único split.
- Los archivos se copian como `<sessionId>_frame_NNN.jpg` para que `inspect_dataset.py` pueda
  volver a auditar fugas por prefijo.
- Se escribe `split_manifest.json` (sessionId → clase/split) para que el split sea reproducible y auditable.

### Mapeo etiqueta → clase

La etiqueta se normaliza (sin acentos, minúsculas, guiones) y se clasifica por subcadenas:

| Subcadena | Clase |
|---|---|
| `good`, `buen`, `ok`, `complet`, `entera`, `pieza`, `part` | `Good-part` |
| `scrap`, `mala`, `rota`, `partida`, `defect`, `rechaz`, `dano`, `quebrad` | `Scrap` |
| `no-piece`, `vacia`, `empty`, `banda`, `nada`, `sin-pieza`, `detect`, `fondo` | `No-Piece-Detected` |

Si no hay coincidencia (o hay conflicto), la sesión va a **cuarentena** (`summary.quarantined`)
y no se asigna en silencio.

### Reparto de splits

- Ratios configurables (`--valid-ratio`, `--test-ratio`, default 0.15/0.15) con `--seed` para
  reproducibilidad.
- Se fuerza que cada clase tenga **al menos 1 sesión en test** cuando es posible; si no, se emite
  warning explícito en vez de generar un split sin esa clase.

### CLI

```bash
.venv/bin/python src/dataset_builder.py \
  --name mi-dataset --sessions-dir datasets \
  --valid-ratio 0.15 --test-ratio 0.15 --seed 0 --json
```

## Entrenamiento (`src/train.py`)

| Hiperparámetro | Default | Rango |
|---|---|---|
| `--epochs` | 200 | 1–2000 |
| `--lr` | 2e-3 | 1e-6–0.1 |
| `--batch-size` | 8 | 1–128 |
| `--size` | 160 | fijo (input del modelo) |
| `--seed` | 0 | ≥ 0 |

- Pérdida `CrossEntropyLoss` con pesos por clase (`class_weights` = `N / (C·n_c)`).
- Optimizador AdamW (`weight_decay=1e-4`) con recorte de gradiente (`clip_grad_norm_`, máx 1.0), scheduler `ReduceLROnPlateau` (factor 0.5, patience 5).
- Pérdida con label smoothing (`--label-smoothing`, default 0.1) en train; validación con `CrossEntropyLoss` sin pesos ni suavizado.
- Guarda el mejor estado por `val_loss` (con early stopping real vía `--patience`, default 15); escribe `reports/curves.png` y avisa si detecta
  sobreajuste.

### Salida parseable

`train.py` imprime cada 5 épocas (y la 1ª):

```
ep 120 | train loss 0.4123 acc 0.8500 | valid loss 0.5123 acc 0.8000
```

El `TrainingJobManager` parsea esta línea (regex `\bep\s+(\d+)\s*\|`) para el progreso de la UI.

## Preprocesado (debe coincidir con inferencia)

`base_transform` (valid/test/inferencia) es determinista:

1. `Resize((160, 160))`
2. `Grayscale(num_output_channels=3)`
3. `ToTensor()` → `[0, 1]`
4. `Normalize(mean=[0.5,0.5,0.5], std=[0.5,0.5,0.5])` → `[-1, 1]`

`train_transform` añade `RandomHorizontalFlip`, `RandomRotation(10)`, `ColorJitter(0.3, 0.3)`.

## Verificación post-entrenamiento

```bash
.venv/bin/python src/evaluate.py --dataset data/mi-dataset
.venv/bin/python src/inspect_dataset.py --dataset data/mi-dataset
```

`evaluate.py` reporta accuracy global y por clase (precision/recall/F1), matriz de confusión,
galería de errores y tiempo de inferencia. `inspect_dataset.py` valida conteos, modos y fugas.
