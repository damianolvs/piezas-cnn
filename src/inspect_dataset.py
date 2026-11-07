# ARCHIVO: inspect_dataset.py
# QUÉ HACE: revisa que el dataset esté sano ANTES de entrenar.
# - Cuenta imágenes por clase y por split (train/valid/test) y avisa si falta alguna clase.
# - Muestra el tamaño y modo de color de las imágenes.
# - Detecta fugas: el mismo frame repetido en más de un split o con etiquetas distintas.
# - Guarda cuadrículas de ejemplos por clase en reports/grids/ para revisarlas a ojo.
"""Paso 1: revisa el dataset (conteos, tamaños, duplicados entre splits, cuadrículas).

Uso:
    python src/inspect_dataset.py [ruta_dataset]
Guarda las cuadrículas en reports/grids/.
"""
import argparse
import hashlib
import random
import re
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = ROOT / "data" / "good-vs-bad-pieces-1"
SPLITS = ["train", "valid", "test"]
IMG_EXT = {".jpg", ".jpeg", ".png", ".bmp"}


def list_images(folder):
    return sorted(p for p in folder.iterdir() if p.suffix.lower() in IMG_EXT)


def source_name(path):
    """Roboflow renombra a '<original>_jpg.rf.<hash>.jpg'; sin el hash queda el frame original."""
    return re.split(r"\.rf\.", path.name)[0]


def file_hash(path):
    return hashlib.md5(path.read_bytes()).hexdigest()


def save_grid(paths, title, out, n=16, cols=4, seed=0):
    rng = random.Random(seed)
    sample = rng.sample(paths, min(n, len(paths)))
    rows = (len(sample) + cols - 1) // cols
    fig, axes = plt.subplots(rows, cols, figsize=(cols * 3, rows * 3), squeeze=False)
    for ax in axes.flat:
        ax.axis("off")
    for ax, p in zip(axes.flat, sample):
        ax.imshow(Image.open(p).convert("RGB"))
        ax.set_title(p.name[:28], fontsize=6)
    fig.suptitle(title)
    fig.tight_layout()
    fig.savefig(out, dpi=110)
    plt.close(fig)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("dataset", nargs="?", default=str(DEFAULT_DATASET))
    args = ap.parse_args()
    ds = Path(args.dataset)
    out_dir = ROOT / "reports" / "grids"
    out_dir.mkdir(parents=True, exist_ok=True)

    present = [s for s in SPLITS if (ds / s).is_dir()]
    print(f"Dataset: {ds}\nSplits encontrados: {present}\n")

    classes = sorted({c.name for s in present for c in (ds / s).iterdir() if c.is_dir()})
    print(f"Clases: {classes}\n")

    # 1) Conteos por clase y split
    counts = {s: {c: 0 for c in classes} for s in present}
    by_class = defaultdict(list)
    for s in present:
        for c in classes:
            d = ds / s / c
            if d.is_dir():
                imgs = list_images(d)
                counts[s][c] = len(imgs)
                by_class[c] += imgs

    print(f"{'split':<8}" + "".join(f"{c:>20}" for c in classes) + f"{'total':>8}")
    for s in present:
        print(f"{s:<8}" + "".join(f"{counts[s][c]:>20}" for c in classes) + f"{sum(counts[s].values()):>8}")
    tot = {c: sum(counts[s][c] for s in present) for c in classes}
    print(f"{'TOTAL':<8}" + "".join(f"{tot[c]:>20}" for c in classes) + f"{sum(tot.values()):>8}\n")

    for s in SPLITS:
        if s not in present:
            print(f"AVISO: falta el split '{s}'")
    for s in present:
        for c in classes:
            if counts[s][c] == 0:
                print(f"AVISO: {s}/{c} está vacío")
    if "Good-Part" in tot and "Scrap" in tot and min(tot["Good-Part"], tot["Scrap"]):
        ratio = max(tot["Good-Part"], tot["Scrap"]) / min(tot["Good-Part"], tot["Scrap"])
        print(f"Relación Good-Part/Scrap: {ratio:.2f}x" + ("  -> desbalance, usar pesos de clase" if ratio > 1.5 else ""))

    # 2) Tamaños y modos
    sizes, modes = Counter(), Counter()
    for imgs in by_class.values():
        for p in imgs:
            with Image.open(p) as im:
                sizes[im.size] += 1
                modes[im.mode] += 1
    print("\nTamaños (ancho x alto):")
    for sz, n in sizes.most_common(8):
        print(f"  {sz[0]}x{sz[1]}: {n}")
    print(f"Modos de color: {dict(modes)}")
    if len(sizes) == 1:
        w, h = next(iter(sizes))
        print(f"Aspect ratio original {w / h:.2f}; a 160x160 " + ("se estira" if abs(w / h - 1) > 0.05 else "sin deformación"))

    # 3) Fuga entre splits: mismo frame original o mismo contenido en splits distintos
    src_splits, hash_splits = defaultdict(set), defaultdict(set)
    for s in present:
        for c in classes:
            d = ds / s / c
            if d.is_dir():
                for p in list_images(d):
                    src_splits[source_name(p)].add(s)
                    hash_splits[file_hash(p)].add(s)
    leak_src = sum(len(v) > 1 for v in src_splits.values())
    leak_hash = sum(len(v) > 1 for v in hash_splits.values())
    print(f"\nFrames originales únicos: {len(src_splits)}")
    print(f"Frames repartidos en más de un split: {leak_src}")
    print(f"Archivos idénticos en más de un split: {leak_hash}")
    # misma imagen con etiquetas distintas
    lab = defaultdict(set)
    for c, imgs in by_class.items():
        for p in imgs:
            lab[source_name(p)].add(c)
    conflicts = {k: v for k, v in lab.items() if len(v) > 1}
    print(f"Frames con más de una etiqueta: {len(conflicts)}")
    for k, v in list(conflicts.items())[:10]:
        print(f"  {k}: {sorted(v)}")

    # 4) Cuadrículas por clase
    for c, imgs in by_class.items():
        out = out_dir / f"grid_{c}.png"
        save_grid(imgs, f"{c} ({len(imgs)} imgs)", out)
        print(f"Cuadrícula guardada: {out}")


if __name__ == "__main__":
    main()
