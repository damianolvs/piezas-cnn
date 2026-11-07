# ARCHIVO: dataset_builder.py
# QUÉ HACE: convierte las sesiones de captura (datasets/<id>/ con metadata.json + frame_*.jpg)
#           en un dataset de entrenamiento con estructura ImageFolder SIN FUGA DE DATOS:
#             data/<name>/train|valid|test/<clase>/<sessionId>_frame_NNN.jpg
#
# Principio clave: la unidad de identidad es la SESIÓN (un objeto físico), no la imagen.
# Todos los frames de una misma sesión van al MISMO split, para que el mismo objeto
# nunca aparezca a la vez en train y en test (esto era la fuga del split aleatorio de Roboflow).
#
# Uso (CLI):
#   .venv/bin/python src/dataset_builder.py --name mi-dataset
#   .venv/bin/python src/dataset_builder.py --name mi-dataset --dry-run
#   .venv/bin/python src/dataset_builder.py --name mi-dataset --json   # salida JSON (para el server)
import argparse
import json
import random
import re
import shutil
import unicodedata
from collections import defaultdict
from pathlib import Path

from dataset import ROOT

SESSIONS_DIR = ROOT / "datasets"
DATA_DIR = ROOT / "data"

# Clases canónicas (DEBEN coincidir con las carpetas que ImageFolder ordena alfabéticamente
# y, por tanto, con el class_to_idx del checkpoint: Good-part=0, No-Piece-Detected=1, Scrap=2).
CLASSES = ["Good-part", "No-Piece-Detected", "Scrap"]


def normalize(value: str) -> str:
    """NFD (quita acentos) -> lower -> reemplaza no-alfanuméricos por '-', colapsa guiones."""
    value = unicodedata.normalize("NFD", value)
    value = "".join(c for c in value if not unicodedata.combining(c))
    value = value.lower()
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return value.strip("-")


def classify_label(label: str) -> str | None:
    """Mapea una etiqueta libre del usuario a una clase canónica. Devuelve None si es ambigua."""
    norm = normalize(label)
    if not norm:
        return None

    # Orden de prioridad: primero las más distintivas.
    no_piece = [
        "no-piece", "nopiece", "no-piece-detected", "vacia", "vacio", "empty",
        "banda", "nada", "sin-pieza", "sinpieza", "sin-piece", "detect",
        "fondo", "background", "libre", "vacante",
    ]
    scrap = [
        "scrap", "mala", "malo", "rota", "roto", "partida", "partido", "defect",
        "rechaz", "dano", "danada", "danado", "fallo", "falla", "quebrad", "fisur",
    ]
    good = [
        "good", "buen", "buena", "bueno", "ok", "complet", "entera", "entero",
        "correcta", "correcto", "sana", "sano", "valida", "valido", "apta", "apto",
    ]

    if any(k in norm for k in no_piece):
        return "No-Piece-Detected"
    if any(k in norm for k in scrap):
        return "Scrap"
    if any(k in norm for k in good) or "pieza" in norm or "part" in norm:
        return "Good-part"
    return None


def list_sessions(sessions_dir=SESSIONS_DIR) -> list[dict]:
    """Devuelve las sesiones de captura con >=1 frame y status completado/parcial."""
    sessions = []
    if not sessions_dir.is_dir():
        return sessions
    for session_dir in sorted(sessions_dir.iterdir()):
        if not session_dir.is_dir():
            continue
        meta_file = session_dir / "metadata.json"
        if not meta_file.is_file():
            continue
        try:
            meta = json.loads(meta_file.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            continue
        frames = sorted(session_dir.glob("frame_*.jpg"))
        if not frames:
            continue
        if meta.get("status") not in ("completed", "partial"):
            continue
        sessions.append({
            "id": session_dir.name,
            "label": str(meta.get("label", "")).strip(),
            "class": classify_label(str(meta.get("label", ""))),
            "status": meta.get("status"),
            "frames": [f.name for f in frames],
            "count": len(frames),
        })
    return sessions


def _partition(group: list[dict], valid_ratio: float, test_ratio: float, rng: random.Random):
    """Reparte las sesiones de UNA clase en train/valid/test garantizando cobertura de test."""
    n = len(group)
    shuffled = group[:]
    rng.shuffle(shuffled)
    if n == 1:
        return shuffled, [], []
    if n == 2:
        return shuffled[:1], [], shuffled[1:]
    test_n = max(1, round(n * test_ratio))
    test = shuffled[:test_n]
    rest = shuffled[test_n:]
    valid_n = max(1, round(len(rest) * valid_ratio)) if valid_ratio > 0 and len(rest) >= 2 else 0
    valid = rest[:valid_n]
    train = rest[valid_n:]
    return train, valid, test


def build(name: str, sessions_dir=SESSIONS_DIR, out_root=DATA_DIR,
          valid_ratio: float = 0.15, test_ratio: float = 0.15,
          seed: int = 0, force: bool = False, dry_run: bool = False) -> dict:
    """Construye el dataset. Devuelve un dict con el resumen (para el server)."""
    out_dir = out_root / name
    if out_dir.exists() and not force:
        raise FileExistsError(f"El dataset '{name}' ya existe. Usa --force para sobrescribirlo.")

    all_sessions = list_sessions(sessions_dir)
    by_class: dict[str, list[dict]] = defaultdict(list)
    quarantine: list[dict] = []
    for s in all_sessions:
        if s["class"] is None:
            quarantine.append(s)
        else:
            by_class[s["class"]].append(s)

    rng = random.Random(seed)
    assignment: dict[str, str] = {}  # session id -> split
    split_counts: dict[str, dict[str, int]] = {"train": {}, "valid": {}, "test": {}}
    manifest: dict[str, dict] = {}

    for cls in CLASSES:
        group = by_class.get(cls, [])
        train, valid, test = _partition(group, valid_ratio, test_ratio, rng)
        for bucket, name_split in ((train, "train"), (valid, "valid"), (test, "test")):
            for s in bucket:
                assignment[s["id"]] = name_split
                split_counts[name_split][cls] = split_counts[name_split].get(cls, 0) + s["count"]
                manifest[s["id"]] = {"label": s["label"], "class": cls, "split": name_split,
                                     "frames": s["count"]}

    # Materializar los archivos.
    copies = 0
    if not dry_run:
        if out_dir.exists():
            shutil.rmtree(out_dir)
        for cls in CLASSES:
            for split in ("train", "valid", "test"):
                (out_dir / split / cls).mkdir(parents=True, exist_ok=True)
        for s in all_sessions:
            split = assignment.get(s["id"])
            if not split:
                continue
            src_dir = sessions_dir / s["id"]
            dest_dir = out_dir / split / s["class"]
            for fname in s["frames"]:
                shutil.copy2(src_dir / fname, dest_dir / f"{s['id']}_{fname}")
                copies += 1
        # Manifest reproducible y auditable.
        (out_dir / "split_manifest.json").write_text(
            json.dumps({
                "name": name, "seed": seed,
                "valid_ratio": valid_ratio, "test_ratio": test_ratio,
                "classes": CLASSES,
                "sessions": manifest,
            }, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    summary = {
        "name": name,
        "sessions_total": len(all_sessions),
        "sessions_used": len(assignment),
        "quarantined": [{"id": s["id"], "label": s["label"]} for s in quarantine],
        "images_copied": copies,
        "splits": split_counts,
        "per_class": {cls: len(by_class.get(cls, [])) for cls in CLASSES},
    }
    return summary


def main():
    ap = argparse.ArgumentParser(description="Ensambla sesiones de captura en un dataset sin fuga.")
    ap.add_argument("--name", required=True, help="nombre del dataset (se crea en data/<name>)")
    ap.add_argument("--sessions-dir", default=str(SESSIONS_DIR))
    ap.add_argument("--valid-ratio", type=float, default=0.15)
    ap.add_argument("--test-ratio", type=float, default=0.15)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--force", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--json", action="store_true", help="imprime el resumen como JSON")
    args = ap.parse_args()

    try:
        summary = build(args.name, Path(args.sessions_dir), DATA_DIR,
                        args.valid_ratio, args.test_ratio, args.seed, args.force, args.dry_run)
    except FileExistsError as exc:
        if args.json:
            print(json.dumps({"error": str(exc)}, ensure_ascii=False))
        else:
            print(f"ERROR: {exc}")
        raise SystemExit(1)

    if args.json:
        print(json.dumps(summary, ensure_ascii=False))
    else:
        print(f"Dataset '{summary['name']}': {summary['sessions_used']} sesiones "
              f"({summary['images_copied']} imágenes) repartidas en "
              f"{summary['splits']}")
        if summary["quarantined"]:
            print(f"⚠ {len(summary['quarantined'])} sesiones en cuarentena (etiqueta ambigua): "
                  f"{[q['label'] for q in summary['quarantined']]}")


if __name__ == "__main__":
    main()
