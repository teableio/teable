#!/bin/bash

run_migration() {
    echo "Running database migration..."
    cd /app && node scripts/db-migrate.mjs
    local migration_status=$?
    if [ $migration_status -ne 0 ]; then
        echo "Database migration failed"
        exit 1
    fi
    echo "Database migration completed successfully"
}

case "$1" in
    "skip-migrate")
        echo "Skipping database migration..."
        ;;
    "migrate-only")
        run_migration
        exit 0
        ;;
    *)
        run_migration
        ;;
esac

node ./apps/nestjs-backend/dist/index.js &
node ./plugins/server.js &
wait -n
