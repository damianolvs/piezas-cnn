# ARCHIVO: evaluate.py
# QUÉ HACE: carga models/model.pt y mide qué tan bien funciona sobre el set de test.
# - Imprime accuracy, precision/recall por clase y la matriz de confusión.
# - Cuenta cuántas imágenes quedarían como "No seguro" (probabilidad máxima < 0.60).
# - Guarda en reports/ la matriz de confusión y las imágenes que el modelo clasificó mal.
# - Con --unseen RUTA evalúa aparte una carpeta de piezas/objetos nunca vistos.
# - Mide el tiempo de inferencia por imagen en CPU (útil para estimar la Raspberry Pi).
"""Paso 5: evaluación.  python src/evaluate.py [--unseen RUTA_CARPETA_CON_CLASES]"""
import argparse
import time

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
from PIL import Image
from sklearn.metrics import classification_report, confusion_matrix
from torch.utils.data import DataLoader
from torchvision import datasets

from dataset import CONFIDENCE_THRESHOLD, DEFAULT_DATASET, ROOT, base_transform
from model import SmallCNN
from train import MODEL_PATH


def load_model(path=MODEL_PATH):
    ckpt = torch.load(path, map_location="cpu", weights_only=False)
    model = SmallCNN(len(ckpt["classes"]), tuple(ckpt["widths"]))
    model.load_state_dict(ckpt["state_dict"])
    return model.eval(), ckpt


@torch.no_grad()
def predict(model, ds):
    probs, ys = [], []
    for x, y in DataLoader(ds, batch_size=32):
        probs.append(torch.softmax(model(x), 1))
        ys.append(y)
    return torch.cat(probs).numpy(), torch.cat(ys).numpy()


def evaluate_split(model, ckpt, folder, name, out_dir):
    ds = datasets.ImageFolder(folder, base_transform(ckpt["input_size"]))
    if ds.class_to_idx != ckpt["class_to_idx"]:
        # p. ej. falta una clase en este split: ImageFolder renumera, así que re-mapeamos por nombre
        print(f"AVISO: {name} tiene clases {sorted(ds.class_to_idx)}; re-mapeando al orden del modelo.")
        remap = [ckpt["class_to_idx"][c] for c in ds.classes]
        ds.targets = [remap[t] for t in ds.targets]
        ds.samples = [(p, remap[t]) for p, t in ds.samples]
    probs, y = predict(model, ds)
    pred = probs.argmax(1)
    labels = list(range(len(ckpt["classes"])))
    print(f"\n=== {name} ({len(y)} imgs) | accuracy {np.mean(pred == y):.3f} ===")
    print(classification_report(y, pred, labels=labels, target_names=ckpt["classes"], zero_division=0))
    cm = confusion_matrix(y, pred, labels=labels)
    print("Matriz de confusión (filas=real, columnas=predicho):\n", cm)

    fig, ax = plt.subplots(figsize=(5, 4.5))
    ax.imshow(cm, cmap="Blues")
    ax.set_xticks(labels, ckpt["classes"], rotation=30, ha="right")
    ax.set_yticks(labels, ckpt["classes"])
    for i in labels:
        for j in labels:
            ax.text(j, i, cm[i, j], ha="center", va="center")
    ax.set_xlabel("predicho"); ax.set_ylabel("real"); ax.set_title(f"Confusión - {name}")
    fig.tight_layout(); fig.savefig(out_dir / f"confusion_{name}.png", dpi=110); plt.close(fig)

    unsure = (probs.max(1) < CONFIDENCE_THRESHOLD).sum()
    print(f"Imágenes con confianza < {CONFIDENCE_THRESHOLD:.0%} ('No seguro'): {unsure}/{len(y)}")

    wrong = np.where(pred != y)[0]
    if len(wrong):
        cols = min(4, len(wrong)); rows = (len(wrong) + cols - 1) // cols
        fig, axes = plt.subplots(rows, cols, figsize=(cols * 3, rows * 3.2), squeeze=False)
        for a in axes.flat:
            a.axis("off")
        for a, i in zip(axes.flat, wrong):
            a.imshow(Image.open(ds.samples[i][0]).convert("RGB"))
            a.set_title(f"real: {ckpt['classes'][y[i]]}\npred: {ckpt['classes'][pred[i]]} "
                        f"({probs[i].max():.0%})", fontsize=8)
        fig.tight_layout(); fig.savefig(out_dir / f"errores_{name}.png", dpi=110); plt.close(fig)
        print(f"Errores guardados en reports/errores_{name}.png")


def time_inference(model, size, runs=100):
    x = torch.randn(1, 3, size, size)
    with torch.no_grad():
        for _ in range(10):
            model(x)
        t = time.perf_counter()
        for _ in range(runs):
            model(x)
    ms = (time.perf_counter() - t) / runs * 1000
    print(f"\nInferencia CPU ({torch.get_num_threads()} hilos, 1 imagen {size}x{size}): {ms:.1f} ms")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(DEFAULT_DATASET))
    ap.add_argument("--unseen", help="carpeta con subcarpetas por clase de objetos nunca vistos")
    args = ap.parse_args()

    out_dir = ROOT / "reports"
    out_dir.mkdir(exist_ok=True)
    model, ckpt = load_model()
    print("Clases:", ckpt["class_to_idx"], "| mejor época:", ckpt["best_epoch"])
    evaluate_split(model, ckpt, f"{args.dataset}/test", "test", out_dir)
    if args.unseen:
        evaluate_split(model, ckpt, args.unseen, "unseen", out_dir)
    time_inference(model, ckpt["input_size"])


if __name__ == "__main__":
    main()
