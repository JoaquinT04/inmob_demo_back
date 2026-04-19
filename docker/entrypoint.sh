#!/bin/sh
set -e

echo "→ Applying migrations..."
node packages/database/dist/scripts/migrate-up.js

echo "→ Starting API..."
exec node apps/api/dist/index.js
