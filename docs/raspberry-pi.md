# Despliegue en Raspberry Pi 5

Guía para correr la aplicación completa en una Raspberry Pi 5 (o equipo embebido Linux).

## Requisitos

- Raspberry Pi OS (64-bit) actualizado.
- Python 3.11+ (el sistema trae 3.11 en Bookworm; evita 3.9).
- Node.js ≥ 20 y pnpm.

## Dependencias del sistema

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip nodejs npm
# opencv suele requerir libGL en sistemas headless:
sudo apt install -y libgl1 libglib2.0-0
```

## Instalación

```bash
# 1. Clonar y rama
git clone https://github.com/damianolvs/piezas-cnn.git
cd piezas-cnn && git checkout dittrich

# 2. Entorno Python (usa python3.11 del sistema)
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt

# 3. Dependencias JS
corepack enable && pnpm install

# 4. Compilar frontend
pnpm build
```

## Ejecución

```bash
# Servicio de inferencia (FastAPI)
.venv/bin/python -m uvicorn inference_service:app --app-dir src --host 0.0.0.0 --port 8000

# API + frontend (en otra terminal, o con un systemd service)
pnpm start
```

Abre `https://<ip-de-la-pi>:3001` (ver la sección HTTPS más abajo; el navegador
solo permite la cámara en HTTPS o localhost).

## HTTPS y acceso a la cámara (obligatorio desde otro dispositivo)

La API de cámara del navegador (`getUserMedia`) **solo existe en un contexto
seguro**: `https://` o `http://localhost`. Si abres el panel por
`http://<ip-de-la-pi>:3001` desde tu portátil o móvil, el navegador oculta
`navigator.mediaDevices` y la cámara no aparece (no es un problema de CORS).

Solución: servir el panel por HTTPS con un certificado autofirmado.

```bash
# 1. Genera el certificado (incluye localhost y la IP de la LAN automáticamente)
pnpm gen:certs
#    o fuerza una IP concreta:
pnpm gen:certs 192.168.1.50

# 2. Compila y arranca por HTTPS
pnpm build
pnpm start:https
```

Abre `https://<ip-de-la-pi>:3001`. La primera vez el navegador avisará que el
certificado es autofirmado: entra en "Avanzado" → "Continuar" (o instala el
certificado como de confianza en el dispositivo).

> Alternativa sin certificados: reenvía el puerto por SSH y abre
> `http://localhost:3001` en tu equipo (localhost se considera contexto seguro):
> `ssh -L 3001:localhost:3001 pi@<ip-de-la-pi>`.

El servicio de inferencia (FastAPI, puerto 8000) no necesita HTTPS: solo lo
consulta el servidor Node en la propia Pi.

> Si el servicio de inferencia corre en otra máquina, define `FASTAPI_URL` al arrancar la API:
> `FASTAPI_URL=http://<ip>:8000 pnpm start`.

## Rendimiento

- `torch` en CPU: la inferencia ronda 15–20 ms/img en un escritorio; en la Pi 5 será algo mayor.
  El modelo es pequeño (~82 k parámetros), así que es viable sin GPU.
- Para bajar latencia/memoria se puede exportar a ONNX/TorchScript y cuantizar (futuro).

## Servicios con systemd

Ejemplo para el servicio de inferencia (`/etc/systemd/system/piezas-ml.service`):

```ini
[Unit]
Description=Piezas CNN inference
After=network.target

[Service]
WorkingDirectory=/home/pi/piezas-cnn
ExecStart=/home/pi/piezas-cnn/.venv/bin/python -m uvicorn inference_service:app --app-dir src --host 0.0.0.0 --port 8000
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now piezas-ml
```

Repite el patrón para la API (`pnpm start`) con otro unit.

## Cámara

- Si usas una cámara CSI, verifica que el navegador la exponga como `videoinput`.
- Para cámara USB, suele aparecer automáticamente. Usa el selector del módulo de Captura para
  elegir el dispositivo correcto.
