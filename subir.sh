#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v docker &> /dev/null; then
  echo "Docker não encontrado. Instale em: https://docs.docker.com/get-docker/"
  exit 1
fi

echo "Subindo o sistema (app + MySQL) com Docker Compose..."
docker compose up -d --build

echo "Aguardando o sistema responder em http://localhost:3000 ..."
for i in $(seq 1 30); do
  if curl -sf -o /dev/null http://localhost:3000; then
    echo ""
    echo "Sistema no ar: http://localhost:3000"
    exit 0
  fi
  sleep 2
done

echo ""
echo "O sistema demorou para responder. Veja os logs com: docker compose logs -f"
exit 1
