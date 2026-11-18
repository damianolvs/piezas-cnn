# ARCHIVO: inference_service.py
# QUÉ HACE: servicio HTTP (FastAPI) que carga models/model.pt UNA sola vez y expone
#           la inferencia de la CNN para la "línea de producción".
# - GET  /health  -> estado del servicio y del modelo.
# - GET  /model   -> metadatos del modelo cargado (clases, input, época, val_acc).
# - POST /predict -> recibe una imagen JPEG y devuelve clase + confianza.
#
# POLÍTICA "DESCONOCIDO": además de la clase de mayor probabilidad, el servicio
# decide si el objeto cae FUERA de la distribución conocida. Devuelve
# `unknown=true` cuando:
#   - la confianza de la clase ganadora < umbral (`threshold`), o
#   - el margen entre la 1ª y 2ª clase < `margin_threshold` (ambigüedad).
# La UI muestra "Desconocido" en ese caso, en lugar de forzar una clase.
# Ambos umbrales se pueden sobreescribir por petición (form fields) o por entorno:
#   UNKNOWN_CONFIDENCE_THRESHOLD (default: CONFIDENCE_THRESHOLD de dataset.py = 0.60)
#   UNKNOWN_MARGIN_THRESHOLD     (default: 0.15)
#
# Se ejecuta desde la raíz del repo con:
#   .venv/bin/python -m uvicorn inference_service:app --app-dir src --host 127.0.0.1 --port 8000
# (`--app-dir src` mete src/ en sys.path para poder importar dataset/model/train como top-level,
#  igual que hacen train.py y evaluate.py).
import base64
import io
import os
import tempfile
import time
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path

import torch
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from PIL import Image
from pydantic import BaseModel

from dataset import CONFIDENCE_THRESHOLD, INPUT_SIZE, MEAN, STD, base_transform
from evaluate import load_model
from train import MODEL_PATH

# Umbrales de la política "desconocido" (configurables por entorno).
def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


THRESHOLD = _env_float("UNKNOWN_CONFIDENCE_THRESHOLD", CONFIDENCE_THRESHOLD)
MARGIN_THRESHOLD = _env_float("UNKNOWN_MARGIN_THRESHOLD", 0.15)

# Carpeta temporal de diagnóstico: aquí se guarda la instantánea cruda y la imagen
# preprocesada (gris 160x160) EXACTA que recibe el modelo, para comprobar el grayscale.
_default_debug_dir = (
    Path("/tmp/piezas-cnn-debug")
    if Path("/tmp").is_dir()
    else Path(tempfile.gettempdir()) / "piezas-cnn-debug"
)
DEBUG_DIR = Path(os.environ.get("DEBUG_IMAGE_DIR", _default_debug_dir))

# ---------------------------------------------------------------------------
# Estado global: el modelo se carga una sola vez al arrancar (no por request).
# ---------------------------------------------------------------------------
MODEL = None
CKPT = None


class Prediction(BaseModel):
    # Clase de mayor probabilidad (siempre el argmax crudo).
    class_name: str
    confidence: float
    # Diferencia entre la 1ª y la 2ª probabilidad (0..1). Baja = ambigüedad.
    margin: float
    # true => el objeto no se reconoce con seguridad (mostrar "Desconocido").
    unknown: bool
    threshold: float
    margin_threshold: float
    probabilities: dict[str, float]
    latency_ms: float
    # Solo si save_debug=true: rutas en disco e imagen (data URL) del preprocesado
    # gris 160x160 que realmente ve el modelo.
    debug: dict[str, str] | None = None


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
        f"val_acc {CKPT['val_acc']:.3f} | umbral {THRESHOLD:.2f} margen {MARGIN_THRESHOLD:.2f}"
    )
    yield
    MODEL = None
    CKPT = None


app = FastAPI(title="Piezas CNN · Inferencia", version="1.1.0", lifespan=lifespan)


@app.get("/health")
def health():
    return {
        "ok": MODEL is not None,
        "service": "inference",
        "model_loaded": MODEL is not None,
        "classes": CKPT["classes"] if CKPT else [],
        "input_size": CKPT["input_size"] if CKPT else None,
        "threshold": THRESHOLD,
        "margin_threshold": MARGIN_THRESHOLD,
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
        "threshold": THRESHOLD,
        "margin_threshold": MARGIN_THRESHOLD,
        "params": sum(p.numel() for p in MODEL.parameters()),
    }


def _save_debug_snapshot(raw: bytes, tensor: torch.Tensor) -> dict[str, str]:
    """Guarda la imagen cruda y la preprocesada (gris 160x160) que ve el modelo.

    Devuelve las rutas en disco mas un data URL para mostrarla en la UI sin
    necesidad de servir archivos desde Express.
    """
    DEBUG_DIR.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S-%f")

    raw_path = DEBUG_DIR / f"{stamp}_raw.jpg"
    raw_path.write_bytes(raw)

    # Des-normaliza el tensor [-1,1] a una imagen 0..255 para verla como la recibe el modelo.
    mean = torch.tensor(CKPT["mean"]).view(3, 1, 1)
    std = torch.tensor(CKPT["std"]).view(3, 1, 1)
    denorm = (tensor * std + mean).clamp(0.0, 1.0)
    arr = (denorm * 255).round().to(torch.uint8).permute(1, 2, 0).cpu().numpy()

    pre_path = DEBUG_DIR / f"{stamp}_preprocessed_grayscale.png"
    image = Image.fromarray(arr, mode="RGB")
    image.save(pre_path)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    data_url = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")

    return {
        "dir": str(DEBUG_DIR),
        "raw": str(raw_path),
        "preprocessed": str(pre_path),
        "preprocessed_data_url": data_url,
    }


@app.post("/predict", response_model=Prediction)
async def predict(
    file: UploadFile = File(...),
    threshold: float | None = Form(None),
    margin: float | None = Form(None),
    save_debug: bool = Form(False),
):
    if MODEL is None:
        raise HTTPException(status_code=503, detail="Modelo no cargado")
    if file.content_type not in ("image/jpeg", "image/png", "image/webp"):
        raise HTTPException(status_code=415, detail="Se espera una imagen JPEG")
    if threshold is not None and not (0.0 <= threshold <= 1.0):
        raise HTTPException(status_code=400, detail="threshold debe estar en [0, 1]")
    if margin is not None and not (0.0 <= margin <= 1.0):
        raise HTTPException(status_code=400, detail="margin debe estar en [0, 1]")

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

    threshold_used = THRESHOLD if threshold is None else float(threshold)
    margin_used = MARGIN_THRESHOLD if margin is None else float(margin)

    conf, idx = torch.max(probs, dim=0)
    confidence = round(float(conf), 4)
    class_name = CKPT["classes"][int(idx)]

    # Margen entre las dos clases más probables (ambigüedad).
    if probs.numel() > 1:
        top2 = torch.topk(probs, 2).values
        margin_value = round(float(top2[0] - top2[1]), 4)
    else:
        margin_value = 1.0

    unknown = confidence < threshold_used or margin_value < margin_used

    debug_info = None
    if save_debug:
        try:
            debug_info = _save_debug_snapshot(raw, img)
            print(f"[inference] diagnostico guardado en {debug_info['preprocessed']}")
        except Exception as exc:  # nunca romper la inferencia por un fallo de diagnóstico
            print(f"[inference] no se pudo guardar el diagnostico: {exc}")

    return Prediction(
        class_name=class_name,
        confidence=confidence,
        margin=margin_value,
        unknown=unknown,
        threshold=threshold_used,
        margin_threshold=margin_used,
        probabilities={c: round(float(p), 4) for c, p in zip(CKPT["classes"], probs)},
        latency_ms=latency_ms,
        debug=debug_info,
    )
