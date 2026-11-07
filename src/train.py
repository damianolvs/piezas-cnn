# ARCHIVO: train.py
# QUÉ HACE: entrena la CNN y guarda el mejor modelo en models/model.pt.
# - Usa CrossEntropyLoss con pesos de clase + label smoothing, AdamW y ReduceLROnPlateau.
# - En cada época mide loss y accuracy en train y en valid.
# - Se queda con la época de menor loss en valid (señal más estable que accuracy con valid
#   pequeño) y guarda ahí: los pesos, las clases, el tamaño de entrada y la normalización.
# - Early stopping (--patience) para no sobreajustar en datasets pequeños.
# - Genera reports/curves.png (curvas de loss y accuracy) y avisa si detecta overfitting.
# - OJO: sobrescribe models/model.pt cada vez que se corre.
"""Paso 4: entrenamiento.  python src/train.py [--epochs 200] [--dataset RUTA] [--patience 15]"""
import argparse
import copy
import random

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import torch
import torch.nn as nn

from dataset import DEFAULT_DATASET, INPUT_SIZE, MEAN, ROOT, STD, class_weights, get_loaders
from model import SmallCNN

MODEL_PATH = ROOT / "models" / "model.pt"
WIDTHS = (16, 32, 64, 96)


def run_epoch(model, loader, criterion, device, optimizer=None):
    train = optimizer is not None
    model.train(train)
    loss_sum, correct, n = 0.0, 0, 0
    with torch.set_grad_enabled(train):
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            out = model(x)
            loss = criterion(out, y)
            if train:
                optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                optimizer.step()
            loss_sum += loss.item() * len(y)
            correct += (out.argmax(1) == y).sum().item()
            n += len(y)
    return loss_sum / n, correct / n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", default=str(DEFAULT_DATASET))
    ap.add_argument("--epochs", type=int, default=200)
    ap.add_argument("--lr", type=float, default=2e-3)
    ap.add_argument("--batch-size", type=int, default=8)
    ap.add_argument("--size", type=int, default=INPUT_SIZE)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--patience", type=int, default=15,
                    help="épocas sin mejora de val_loss antes de parar (0 = desactiva)")
    ap.add_argument("--label-smoothing", type=float, default=0.1,
                    help="suavizado de etiquetas para calibrar la confianza")
    args = ap.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    ds, loaders = get_loaders(args.dataset, args.size, args.batch_size)
    classes = ds["train"].classes
    print("Clases:", ds["train"].class_to_idx, "| dispositivo:", device)

    model = SmallCNN(len(classes), WIDTHS).to(device)
    print("Parámetros:", sum(p.numel() for p in model.parameters()))
    weights = class_weights(ds["train"]).to(device)
    print("Pesos de clase:", [round(w, 2) for w in weights.tolist()])
    criterion = nn.CrossEntropyLoss(weight=weights, label_smoothing=args.label_smoothing)
    # Pérdida de validación sin pesos ni suavizado: señal más limpia y estable para
    # seleccionar la mejor época cuando el conjunto de validación es pequeño.
    criterion_val = nn.CrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, factor=0.5, patience=5)

    hist = {k: [] for k in ("train_loss", "train_acc", "val_loss", "val_acc")}
    best = {"val_loss": float("inf"), "val_acc": -1.0, "epoch": 0, "state": None, "train_acc": 0.0}

    bad_epochs = 0
    for epoch in range(1, args.epochs + 1):
        tl, ta = run_epoch(model, loaders["train"], criterion, device, optimizer)
        vl, va = run_epoch(model, loaders["valid"], criterion_val, device)
        scheduler.step(vl)
        for k, v in zip(hist, (tl, ta, vl, va)):
            hist[k].append(v)
        # mejor = menor loss en valid (más estable que accuracy con valid diminuto)
        if vl < best["val_loss"] - 1e-4:
            best.update(val_loss=vl, val_acc=va, epoch=epoch, train_acc=ta,
                        state=copy.deepcopy(model.state_dict()))
            bad_epochs = 0
        else:
            bad_epochs += 1
            if args.patience > 0 and bad_epochs >= args.patience:
                print(f"Early stopping en época {epoch} (patience {args.patience})")
                break
        if epoch % 5 == 0 or epoch == 1:
            print(f"ep {epoch:3d} | train loss {tl:.3f} acc {ta:.3f} | valid loss {vl:.3f} acc {va:.3f}")

    MODEL_PATH.parent.mkdir(exist_ok=True)
    torch.save({
        "state_dict": best["state"],
        "classes": classes,
        "class_to_idx": ds["train"].class_to_idx,
        "input_size": args.size,
        "mean": MEAN,
        "std": STD,
        "widths": WIDTHS,
        "best_epoch": best["epoch"],
        "val_acc": best["val_acc"],
        "val_loss": best["val_loss"],
    }, MODEL_PATH)
    print(f"\nMejor época {best['epoch']}: valid acc {best['val_acc']:.3f}, loss {best['val_loss']:.3f}")
    print("Modelo guardado en", MODEL_PATH)

    # Curvas
    out = ROOT / "reports"
    out.mkdir(exist_ok=True)
    fig, ax = plt.subplots(1, 2, figsize=(10, 4))
    ax[0].plot(hist["train_loss"], label="train"); ax[0].plot(hist["val_loss"], label="valid")
    ax[0].set_title("Loss"); ax[0].legend()
    ax[1].plot(hist["train_acc"], label="train"); ax[1].plot(hist["val_acc"], label="valid")
    ax[1].axvline(best["epoch"] - 1, color="gray", ls=":")
    ax[1].set_title("Accuracy"); ax[1].legend()
    fig.tight_layout(); fig.savefig(out / "curves.png", dpi=110); plt.close(fig)

    # Aviso de overfitting
    gap = hist["train_acc"][best["epoch"] - 1] - best["val_acc"]
    last_val = np.mean(hist["val_loss"][-5:])
    if gap > 0.15:
        print(f"AVISO: posible overfitting (train acc - valid acc = {gap:.2f} en la mejor época).")
    if last_val > min(hist["val_loss"]) * 1.5:
        print("AVISO: la loss de valid subió bastante respecto a su mínimo; el modelo se sobreajustó "
              "después de la mejor época.")
    if len(ds["valid"]) < 50:
        print(f"NOTA: valid tiene solo {len(ds['valid'])} imágenes; la selección del mejor modelo es ruidosa.")


if __name__ == "__main__":
    main()
