#!/bin/sh
# init-certbot.sh — Obtener certificados Let's Encrypt por primera vez
# Ejecutar UNA SOLA VEZ en el VPS después del primer deploy.
#
# Uso:
#   cd /path/to/inmob_demo_back
#   APP_DOMAIN=tudominio.com CERTBOT_EMAIL=admin@tudominio.com sh docker/init-certbot.sh
set -e

APP_DOMAIN="${APP_DOMAIN:?Variable APP_DOMAIN requerida. Ej: APP_DOMAIN=tudominio.com}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:?Variable CERTBOT_EMAIL requerida. Ej: CERTBOT_EMAIL=admin@tudominio.com}"

echo "→ Dominio:  $APP_DOMAIN"
echo "→ Email:    $CERTBOT_EMAIL"
echo ""

# 1. Asegurar que nginx esté corriendo en modo HTTP-only
echo "[1/4] Verificando que nginx esté activo..."
docker compose -f docker/docker-compose.yml ps nginx | grep -q "running" || {
    echo "ERROR: nginx no está corriendo. Ejecutar primero: docker compose up -d nginx"
    exit 1
}

# 2. Obtener cert para api.DOMAIN
echo "[2/4] Obteniendo certificado para api.$APP_DOMAIN..."
docker run --rm \
    -v letsencrypt:/etc/letsencrypt \
    -v certbot_webroot:/var/www/certbot \
    certbot/certbot certonly \
        --webroot \
        --webroot-path /var/www/certbot \
        --email "$CERTBOT_EMAIL" \
        --agree-tos \
        --no-eff-email \
        --non-interactive \
        -d "api.$APP_DOMAIN"

# 3. Obtener cert para app.DOMAIN
echo "[3/4] Obteniendo certificado para app.$APP_DOMAIN..."
docker run --rm \
    -v letsencrypt:/etc/letsencrypt \
    -v certbot_webroot:/var/www/certbot \
    certbot/certbot certonly \
        --webroot \
        --webroot-path /var/www/certbot \
        --email "$CERTBOT_EMAIL" \
        --agree-tos \
        --no-eff-email \
        --non-interactive \
        -d "app.$APP_DOMAIN"

# 4. Generar ssl.conf desde template y recargar nginx
echo "[4/4] Generando config SSL y recargando nginx..."
APP_DOMAIN="$APP_DOMAIN" envsubst '${APP_DOMAIN}' \
    < docker/nginx/templates/ssl.conf.template \
    > docker/nginx/conf.d/ssl.conf

docker compose -f docker/docker-compose.yml exec nginx nginx -t
docker compose -f docker/docker-compose.yml exec nginx nginx -s reload

echo ""
echo "✓ SSL activo en:"
echo "  https://api.$APP_DOMAIN"
echo "  https://app.$APP_DOMAIN"
