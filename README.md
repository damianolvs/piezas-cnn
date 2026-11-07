# Clasificador de piezas buenas/malas con CNN

Proyecto de IA (UTCH). Una CNN propia, entrenada desde cero en PyTorch (sin modelos preentrenados),
clasifica la imagen completa de una pieza en una banda transportadora:

- `Good-part`: objeto completo, en una sola pieza.
- `Scrap`: el mismo objeto partido en 2 piezas.
- `No-Piece-Detected`: banda vacía.

Si la probabilidad máxima es menor a 0.60 (`CONFIDENCE_THRESHOLD` en `src/dataset.py`), la salida es "No seguro".

## Estructura
```
src/
  download_dataset.py   descarga el dataset de Roboflow a data/
  inspect_dataset.py    conteos, tamaños, fugas entre splits, cuadrículas
  dataset.py            carga de datos, normalización, augmentations, umbral
  model.py              SmallCNN (~82k parámetros)
  train.py              entrenamiento -> models/model.pt
  evaluate.py           accuracy, matriz de confusión, errores, tiempo de inferencia
models/model.pt         modelo entrenado (pesos, clases, tamaño de entrada, normalización)
```
`data/` y `reports/` no se suben a git.

## Instalación
```bash
python -m venv .venv
.venv/Scripts/pip install -r requirements.txt   # Windows
```

## Uso
```bash
# 1. Descargar el dataset (la API key va en una variable de entorno, nunca en el código)
export ROBOFLOW_API_KEY=...        # PowerShell: $env:ROBOFLOW_API_KEY="..."
python src/download_dataset.py

# 2. Revisar el dataset
python src/inspect_dataset.py

# 3. Entrenar (defaults: 200 épocas, lr 0.002, batch 8; sobrescribe models/model.pt)
python src/train.py

# 4. Evaluar (opcional: --unseen CARPETA con objetos nunca vistos)
python src/evaluate.py
```
También se puede usar un dataset propio con la misma estructura `train|valid|test/<clase>/imagen`
pasando `--dataset RUTA`. Los nombres de clase deben ser exactos.

## Resultados actuales (dataset de 118 imágenes)
- Accuracy: 78% en valid (23 imgs), 67% en test (12 imgs). Meta: 60%.
- Inferencia: ~20 ms por imagen en CPU de laptop.

## Limitaciones
- Dataset muy pequeño; el test de 12 imágenes es ruidoso.
- El split de Roboflow es aleatorio: los mismos objetos aparecen en train y test, así que el accuracy está inflado.
- `No-Piece-Detected` no tiene imágenes en test.
- El modelo está subajustado y con baja confianza: ninguna imagen de test supera 60% de probabilidad máxima.
- Pendiente: demo en tiempo real con OpenCV y guía para la Raspberry Pi 5.
