# ARCHIVO: dataset.py
# QUÉ HACE: define cómo se cargan y se preparan las imágenes para la CNN.
# - Tamaño de entrada (160x160), normalización y umbral de confianza (0.60) en UN solo lugar,
#   para que el entrenamiento, la evaluación y la demo usen exactamente lo mismo.
# - Transformaciones de train (con augmentations suaves) y de valid/test/demo (sin augmentations).
# - Carga las carpetas train/valid/test con ImageFolder (clases en orden alfabético).
# - Calcula los pesos de clase para compensar que hay más Good-part que Scrap.
from pathlib import Path

import torch
from torch.utils.data import DataLoader
from torchvision import datasets, transforms

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATASET = ROOT / "data" / "good-vs-bad-pieces-1"

INPUT_SIZE = 160
MEAN = [0.5, 0.5, 0.5]
STD = [0.5, 0.5, 0.5]

# Si la probabilidad máxima es menor a esto, la interfaz muestra no seguro
CONFIDENCE_THRESHOLD = 0.60


def base_transform(size=INPUT_SIZE):
    """Preprocesado determinista (valid/test y demo).

    Grayscale -> 3 canales: el dataset fue tomado con una app propia que venía en gris; así el modelo ve
    lo mismo aunque la webcam entregue color o se re-exporte el dataset en color.
    """
    return transforms.Compose([
        transforms.Resize((size, size)),
        transforms.Grayscale(num_output_channels=3),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ])


def train_transform(size=INPUT_SIZE):
    """Augmentations suaves: nada que deforme o 'una' piezas partidas."""
    return transforms.Compose([
        transforms.Resize((size, size)),
        transforms.RandomHorizontalFlip(),
        transforms.RandomRotation(10, fill=200),
        transforms.ColorJitter(brightness=0.3, contrast=0.3),
        transforms.Grayscale(num_output_channels=3),
        transforms.ToTensor(),
        transforms.Normalize(MEAN, STD),
    ])


def get_datasets(root=DEFAULT_DATASET, size=INPUT_SIZE):
    root = Path(root)
    return {
        "train": datasets.ImageFolder(root / "train", train_transform(size)),
        "valid": datasets.ImageFolder(root / "valid", base_transform(size)),
        "test": datasets.ImageFolder(root / "test", base_transform(size)),
    }


def class_weights(dataset):
    counts = torch.bincount(torch.tensor(dataset.targets), minlength=len(dataset.classes)).float()
    return counts.sum() / (len(counts) * counts.clamp(min=1))


def get_loaders(root=DEFAULT_DATASET, size=INPUT_SIZE, batch_size=16, num_workers=0):
    ds = get_datasets(root, size)
    return ds, {
        "train": DataLoader(ds["train"], batch_size, shuffle=True, num_workers=num_workers),
        "valid": DataLoader(ds["valid"], batch_size, num_workers=num_workers),
        "test": DataLoader(ds["test"], batch_size, num_workers=num_workers),
    }
