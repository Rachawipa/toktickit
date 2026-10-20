#!/usr/bin/env bash
# Post-deployment smoke test. Usage: scripts/smoke-test.sh https://<service-url>
# Optional: SMOKE_EMAIL / SMOKE_PASSWORD enable an authenticated check (login + DB read).
set -euo pipefail

BASE="${1:?usage: smoke-test.sh <base-url>}"
BASE="${BASE%/}"
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

# Cloud Run may need a few seconds for a new revision to take traffic.
for i in 1 2 3 4 5 6; do
  curl -fsS --max-time 10 "$BASE/api/health" >/dev/null 2>&1 && break
  [ "$i" = 6 ] && fail "/api/health not reachable"
  sleep 5
done

curl -fsS "$BASE/api/health" | grep -q '"status":"ok"' || fail "/api/health body"
echo "ok  /api/health"

code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/")
[ "$code" = 200 ] || fail "UI / returned $code"
echo "ok  UI /"

curl -fsS "$BASE/api/categories" >/dev/null || fail "/api/categories (database read)"
echo "ok  /api/categories (DB)"

if [ -n "${SMOKE_EMAIL:-}" ] && [ -n "${SMOKE_PASSWORD:-}" ]; then
  token=$(curl -fsS -X POST "$BASE/api/auth/login" -H 'content-type: application/json' \
    -d "{\"email\":\"$SMOKE_EMAIL\",\"password\":\"$SMOKE_PASSWORD\"}" \
    | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
  [ -n "$token" ] || fail "login returned no token"
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/tickets" -H "Authorization: Bearer $token")
  [ "$code" = 200 ] || fail "authenticated /api/tickets returned $code"
  echo "ok  login + /api/tickets"
fi
echo "SMOKE PASS"
