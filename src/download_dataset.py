# ARCHIVO: download_dataset.py
# QUÉ HACE: descarga el dataset desde Roboflow (formato "Folder Structure") a la carpeta data/.
# - La API key NO está en el código: se lee de la variable de entorno ROBOFLOW_API_KEY.
# - Roboflow se usa solo para etiquetar y exportar las imágenes, no para entrenar.
# - Se corre una sola vez (o cuando haya una versión nueva del dataset).
"""Descarga el dataset de Roboflow (formato Folder Structure) a data/.

Uso:
    set ROBOFLOW_API_KEY=...   (PowerShell: $env:ROBOFLOW_API_KEY="...")
    python src/download_dataset.py
"""
import os
import sys
from pathlib import Path

from roboflow import Roboflow

WORKSPACE = "test-roboflow-0ymkb"
PROJECT = "good-vs-bad-pieces"
VERSION = 1
DATA_DIR = Path(__file__).resolve().parent.parent / "data"


def main():
    api_key = os.environ.get("ROBOFLOW_API_KEY")
    if not api_key:
        sys.exit("Falta la variable de entorno ROBOFLOW_API_KEY.")

    DATA_DIR.mkdir(exist_ok=True)
    rf = Roboflow(api_key=api_key)
    project = rf.workspace(WORKSPACE).project(PROJECT)
    dataset = project.version(VERSION).download(
        "folder", location=str(DATA_DIR / f"{PROJECT}-{VERSION}")
    )
    print("Dataset en:", dataset.location)


if __name__ == "__main__":
    main()
