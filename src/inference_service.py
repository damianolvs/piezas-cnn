# ARCHIVO: inference_service.py
# QUÉ HACE: servicio HTTP (FastAPI) que carga models/model.pt UNA sola vez y expone
#           la inferencia de la CNN para la "línea de producción".
# - GET  /health  -> estado del servicio y del modelo.
# - GET  /model   -> metadatos del modelo cargado (clases, input, época, val_acc).
# - POST /predict -> recibe una imagen JPEG y devuelve clase + confianza + "no seguro".
#
# Se ejecuta desde la raíz del repo con:
#   .venv/bin/python -m uvicorn inference_service:app --app-dir src --host 127.0.0.1 --port 8000
# (`--app-dir src` mete src/ en sys.path para poder importar dataset/model/train como top-level,
#  igual que hacen train.py y evaluate.py).
import io
import time
from contextlib import asynccontextmanager

import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel

from dataset import CONFIDENCE_THRESHOLD, INPUT_SIZE, MEAN, STD, base_transform
from evaluate import load_model
from train import MODEL_PATH

# ---------------------------------------------------------------------------
# Estado global: el modelo se carga una sola vez al arrancar (no por request).
# ---------------------------------------------------------------------------
MODEL = None
CKPT = None


class Prediction(BaseModel):
    class_name: str
    confidence: float
    unsure: bool
    threshold: float
    probabilities: dict[str, float]
    latency_ms: float


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global MODEL, CKPT
    MODEL, CKPT = load_model(MODEL_PATH)
    MODEL.eval()
    # Fijar hilos de CPU para predecibilidad (útil en Raspberry Pi).
    if hasattr(torch, "set_num_threads"):
        try:
            torch.set_num_threads(max(1, (torch.get_num_threads() + 1) // 2))
        except Exception:
            pass
    print(
        f"[inference] modelo cargado: {len(CKPT['classes'])} clases "
        f"{CKPT['classes']} | input {CKPT['input_size']} | época {CKPT['best_epoch']} "
        f"val_acc {CKPT['val_acc']:.3f}"
    )
    yield
    MODEL = None
    CKPT = None


app = FastAPI(title="Piezas CNN · Inferencia", version="1.0.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "ok": MODEL is not None,
        "service": "inference",
        "model_loaded": MODEL is not None,
        "classes": CKPT["classes"] if CKPT else [],
        "input_size": CKPT["input_size"] if CKPT else None,
        "threshold": CONFIDENCE_THRESHOLD,
        "device": "cpu",
    }


@app.get("/model")
def model_info():
    if CKPT is None:
        raise HTTPException(status_code=503, detail="Modelo no cargado")
    return {
        "classes": CKPT["classes"],
        "class_to_idx": CKPT["class_to_idx"],
        "input_size": CKPT["input_size"],
        "mean": CKPT["mean"],
        "std": CKPT["std"],
        "widths": list(CKPT["widths"]),
        "best_epoch": CKPT["best_epoch"],
        "val_acc": CKPT["val_acc"],
        "threshold": CONFIDENCE_THRESHOLD,
        "params": sum(p.numel() for p in MODEL.parameters()),
    }


@app.post("/predict", response_model=Prediction)
async def predict(file: UploadFile = File(...)):
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Modelo no cargado")
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=415, detail="Se espera una imagen JPEG")

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Imagen vacía")

    try:
        # base_transform hace Resize(160) -> Grayscale(3ch) -> ToTensor -> Normalize(0.5/0.5)
        # exactamente igual que valid/test/demo. Es lo que garantiza ver lo mismo que en train.
        img = base_transform(CKPT["input_size"])(Image.open(io.BytesIO(raw)))
        x = img.unsqueeze(0)
    except Exception as exc:  # imagen corrupta o no decodificable
        raise HTTPException(status_code=400, detail=f"No se pudo decodificar la imagen: {exc}") from exc

    start = time.perf_counter()
    with torch.inference_mode():
        probs = torch.softmax(MODEL(x), dim=1)[0]
    latency_ms = round((time.perf_counter() - start) * 1000, 2)

    conf, idx = torch.max(probs, dim=0)
    confidence = round(float(conf), 4)
    class_name = CKPT["classes"][int(idx)]

    return Prediction(
        class_name=class_name,
        confidence=confidence,
        unsure=confidence < CONFIDENCE_THRESHOLD,
        threshold=CONFIDENCE_THRESHOLD,
        probabilities={c: round(float(p), 4) for c, p in zip(CKPT["classes"], probs)},
        latency_ms=latency_ms,
    )
