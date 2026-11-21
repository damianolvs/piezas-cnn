#!/usr/bin/env bash
# Genera un certificado TLS autofirmado en certs/ con SAN para localhost y la IP
# de la LAN. La cámara del navegador solo funciona en HTTPS o localhost, así que
# este certificado permite usar el panel desde otro dispositivo de la red.
#
# Uso:
#   pnpm gen:certs              # detecta la IP de la LAN automáticamente
#   pnpm gen:certs 192.168.1.50 # fuerza una IP extra
#
# El navegador mostrará una advertencia de certificado autofirmado la primera
# vez: acéptala ("Avanzado" -> "Continuar") para entrar.
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v openssl >/dev/null 2>&1; then
  echo "Error: openssl no está instalado." >&2
  exit 1
fi

mkdir -p certs

EXTRA_IP="${1:-}"
LAN_IP=""

# Raspberry Pi / Linux: hostname -I devuelve las IPs separadas por espacios.
if command -v hostname >/dev/null 2>&1; then
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi
# macOS: ipconfig getifaddr en0 / en1.
if [ -z "$LAN_IP" ] && command -v ipconfig >/dev/null 2>&1; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
fi

SAN="DNS:localhost,IP:127.0.0.1"
if [ -n "$LAN_IP" ]; then
  SAN="$SAN,IP:$LAN_IP"
fi
if [ -n "$EXTRA_IP" ] && [ "$EXTRA_IP" != "$LAN_IP" ]; then
  SAN="$SAN,IP:$EXTRA_IP"
fi

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -days 825 \
  -subj "/CN=piezas-cnn" \
  -addext "subjectAltName=$SAN"

echo ""
echo "Certificado generado:"
echo "  certs/cert.pem"
echo "  certs/key.pem"
echo "SAN: $SAN"
echo ""
echo "Arranca con: pnpm start:https"
if [ -n "$LAN_IP" ]; then
  echo "Abre en el navegador: https://$LAN_IP:3001"
fi
