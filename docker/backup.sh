#!/bin/sh
# backup.sh — pg_dump diario de todas las DBs del VPS
# Instalar en cron del host:
#   0 3 * * * /path/to/inmob_demo_back/docker/backup.sh >> /var/log/inmob-backup.log 2>&1
set -e

BACKUP_DIR="${BACKUP_DIR:-/var/backups/inmob}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DATE=$(date +%Y%m%d_%H%M%S)
CONTAINER="${POSTGRES_CONTAINER:-inmob_postgres}"

mkdir -p "$BACKUP_DIR"

echo "[$DATE] Iniciando backup..."

# Dump de todas las bases de datos
docker exec "$CONTAINER" \
    pg_dumpall -U "${POSTGRES_USER:-inmob}" \
    | gzip > "$BACKUP_DIR/inmob_full_${DATE}.sql.gz"

echo "[$DATE] Backup guardado: $BACKUP_DIR/inmob_full_${DATE}.sql.gz"

# Limpiar backups más viejos que RETENTION_DAYS
find "$BACKUP_DIR" -name "inmob_full_*.sql.gz" -mtime +"$RETENTION_DAYS" -delete
echo "[$DATE] Backups antiguos eliminados (retención: ${RETENTION_DAYS} días)"

# Tamaño del backup más reciente
SIZE=$(du -sh "$BACKUP_DIR/inmob_full_${DATE}.sql.gz" | cut -f1)
echo "[$DATE] Tamaño: $SIZE"
echo "[$DATE] Backup completado."
