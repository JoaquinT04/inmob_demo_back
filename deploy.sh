#!/bin/sh
# deploy.sh — Pull, rebuild y restart de todos los servicios
# Uso en el VPS:
#   cd /path/to/inmob_demo_back
#   sh deploy.sh
set -e

COMPOSE="docker compose -f docker/docker-compose.yml"

echo "→ [1/4] Pulling latest code..."
git pull origin main

echo "→ [2/4] Building images..."
$COMPOSE build --no-cache api

echo "→ [3/4] Starting services..."
$COMPOSE up -d --remove-orphans

echo "→ [4/4] Health check..."
sleep 8
$COMPOSE ps

# Verificar que la API responde
API_URL="http://localhost:3001/health"
if curl -sf "$API_URL" > /dev/null 2>&1; then
    echo "✓ API responde en $API_URL"
else
    echo "✗ API no responde — revisar logs:"
    echo "  docker compose -f docker/docker-compose.yml logs api --tail=50"
    exit 1
fi

echo ""
echo "Deploy completado: $(date)"
