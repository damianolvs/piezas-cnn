"""Clasifica todas las imágenes de una carpeta usando models/model.pt.

Uso:
    python src/predict_folder.py --folder RUTA_DE_TU_CARPETA
    python src/predict_folder.py --folder RUTA_DE_TU_CARPETA --save-csv
"""
import argparse
import sys
import time
from pathlib import Path

import torch
from PIL import Image

# Permitir imports relativos a src si se corre directo
sys.path.append(str(Path(__file__).resolve().parent))

from dataset import CONFIDENCE_THRESHOLD, base_transform
from evaluate import load_model
from train import MODEL_PATH

VALID_EXTS = {".jpg", ".jpeg", ".png", ".webp", ".bmp"}


def predict_folder(folder_path: Path, model_path: Path = MODEL_PATH, save_csv: bool = False, limit: int = None, output_csv: Path = None):
    if not folder_path.exists() or not folder_path.is_dir():
        print(f"Error: la carpeta '{folder_path}' no existe o no es un directorio.")
        sys.exit(1)

    image_files = sorted([p for p in folder_path.rglob("*") if p.suffix.lower() in VALID_EXTS])
    if not image_files:
        print(f"No se encontraron imágenes ({', '.join(VALID_EXTS)}) en '{folder_path}'.")
        return

    if limit and limit > 0:
        image_files = image_files[:limit]

    print(f"Cargando modelo desde {model_path}...")
    model, ckpt = load_model(model_path)
    transform = base_transform(ckpt["input_size"])
    classes = ckpt["classes"]

    print(f"Encontradas {len(image_files)} imágenes. Evaluando...\n")
    header = f"{'Archivo':<35} | {'Clase Predicha':<18} | {'Confianza':<10} | {'Estado':<10} | {'Latencia'}"
    print(header)
    print("-" * len(header))

    results = []
    total_time = 0.0

    for p in image_files:
        try:
            with Image.open(p) as raw_img:
                img_t = transform(raw_img.convert("RGB")).unsqueeze(0)
        except Exception as e:
            print(f"{p.name:<35} | ERROR: {e}")
            continue

        t0 = time.perf_counter()
        with torch.inference_mode():
            probs = torch.softmax(model(img_t), dim=1)[0]
        dt = (time.perf_counter() - t0) * 1000
        total_time += dt

        conf, idx = torch.max(probs, dim=0)
        confidence = float(conf)
        class_name = classes[int(idx)]
        unsure = confidence < CONFIDENCE_THRESHOLD
        status = "No seguro" if unsure else "OK"

        rel_path = str(p.relative_to(folder_path))
        if len(rel_path) > 35:
            rel_path = "..." + rel_path[-32:]

        print(f"{rel_path:<35} | {class_name:<18} | {confidence:>8.2%} | {status:<10} | {dt:>6.1f} ms")

        results.append({
            "path": str(p),
            "class": class_name,
            "confidence": round(confidence, 4),
            "unsure": unsure,
            "latency_ms": round(dt, 2),
            **{f"prob_{c}": round(float(prob), 4) for c, prob in zip(classes, probs)},
        })

    avg_time = total_time / len(image_files) if image_files else 0
    print("-" * len(header))
    print(f"Total evaluadas: {len(results)} | Tiempo prom/img: {avg_time:.1f} ms | Umbral: {CONFIDENCE_THRESHOLD:.0%}")

    if save_csv or output_csv:
        import csv
        csv_path = output_csv if output_csv else (folder_path / "predicciones.csv")
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        with open(csv_path, "w", newline="", encoding="utf-8") as f:
            writer = csv.DictWriter(f, fieldnames=results[0].keys())
            writer.writeheader()
            writer.writerows(results)
        print(f"Resultados guardados en: {csv_path}")


def main():
    parser = argparse.ArgumentParser(description="Clasifica imágenes de una carpeta usando la CNN.")
    parser.add_argument("--folder", "-f", required=True, type=Path, help="Ruta a la carpeta con las imágenes")
    parser.add_argument("--model", "-m", default=MODEL_PATH, type=Path, help="Ruta al modelo (por defecto models/model.pt)")
    parser.add_argument("--save-csv", action="store_true", help="Guardar resultados en un archivo predicciones.csv")
    parser.add_argument("--output-csv", "-o", type=Path, default=None, help="Ruta personalizada para guardar el archivo CSV")
    parser.add_argument("--limit", "-l", type=int, default=None, help="Limitar cantidad máxima de imágenes a procesar")
    args = parser.parse_args()

    predict_folder(args.folder, args.model, args.save_csv, args.limit, args.output_csv)


if __name__ == "__main__":
    main()
