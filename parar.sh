#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker &> /dev/null; then
  echo "Docker não encontrado. Instale em: https://docs.docker.com/get-docker/"
  exit 1
fi

echo "Parando o sistema (app + MySQL)..."
docker compose stop

echo "Sistema parado. Os dados continuam salvos no volume do Docker."
echo "Para subir de novo: ./subir.sh"
