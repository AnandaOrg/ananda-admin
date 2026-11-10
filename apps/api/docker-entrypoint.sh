#!/bin/sh
# Apply migrations on every start; load demo data once when SEED_DEMO=true and the database is empty.
set -e
node dist/db/migrate.js
if [ "$SEED_DEMO" = "true" ]; then
  node dist/db/seed.js
fi
exec "$@"
