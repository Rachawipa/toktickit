#!/bin/sh
set -e

echo "Applying Prisma database migrations..."
npx prisma migrate deploy

if [ "${RUN_SEED:-true}" = "true" ]; then
  echo "Running idempotent database seed..."
  npm run prisma:seed
fi

echo "Bootstrapping categories and initial administrator (if configured)..."
node dist/bootstrap.js

echo "Starting TokTickIT API server..."
exec "$@"
