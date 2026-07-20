#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker &> /dev/null; then
  echo "Docker não encontrado. Instale em: https://docs.docker.com/get-docker/"
  exit 1
fi

if [ -z "$(docker compose ps --status running -q app 2>/dev/null)" ]; then
  echo "O container do sistema não está rodando. Suba com ./subir.sh primeiro."
  exit 1
fi

docker compose exec app npm run resetar-banco
