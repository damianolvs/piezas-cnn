# ARCHIVO: model.py
# QUÉ HACE: define la red neuronal (la clase SmallCNN). Es el "modelo principal" del proyecto.
# - 4 bloques Conv2d -> BatchNorm -> ReLU -> MaxPool (16, 32, 64 y 96 filtros).
# - Luego AdaptiveAvgPool2d y un clasificador pequeño (96 -> 32 -> 3 clases) con dropout.
# - ~82 mil parámetros: es chica para que corra en CPU en la Raspberry Pi.
# - Se entrena desde cero, sin pesos preentrenados ni transfer learning.
# - Los pesos ya entrenados NO están aquí: están en models/model.pt.
"""CNN propia y pequeña, entrenada desde cero."""
import torch.nn as nn


def conv_block(c_in, c_out):
    return nn.Sequential(
        nn.Conv2d(c_in, c_out, 3, padding=1, bias=False),
        nn.BatchNorm2d(c_out),
        nn.ReLU(inplace=True),
        nn.MaxPool2d(2),
    )


class SmallCNN(nn.Module):
    def __init__(self, num_classes=3, widths=(16, 32, 64, 96), dropout=0.4):
        super().__init__()
        chans = (3,) + tuple(widths)
        self.features = nn.Sequential(*[conv_block(a, b) for a, b in zip(chans, chans[1:])])
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(dropout),
            nn.Linear(widths[-1], 32),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(32, num_classes),
        )

    def forward(self, x):
        return self.classifier(self.pool(self.features(x)))


if __name__ == "__main__":
    m = SmallCNN()
    print(sum(p.numel() for p in m.parameters()), "parámetros")
