#!/usr/bin/env bash
#
# Restore the most recent dump into a scratch database and check it holds real data.
#
# This is the half people skip. An untested backup is a hope, and the failure mode is
# discovering that at the worst possible moment. Run it monthly.
#
# Nothing here touches the live database: the dump is restored into a throwaway
# database which is dropped on the way out, including on failure.
#
# Usage:  ops/restore-check.sh [path/to/dump.sql.gz]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

die() { echo "restore-check: $*" >&2; exit 1; }

[[ -f .env ]] || die "no .env at $ROOT"
set -a; . ./.env; set +a
: "${POSTGRES_USER:?not set in .env}"
: "${POSTGRES_DB:?not set in .env}"

COMPOSE="${HAVEFISH_COMPOSE:-}"
if [[ -z "$COMPOSE" ]]; then
  if command -v podman >/dev/null 2>&1; then COMPOSE="podman compose"
  elif command -v docker >/dev/null 2>&1; then COMPOSE="docker compose"
  else die "neither podman nor docker found; set HAVEFISH_COMPOSE"
  fi
fi

BACKUP_DIR="${HAVEFISH_BACKUP_DIR:-$ROOT/backups}"
EXPLICIT="${1:-}"
DUMP="${EXPLICIT:-$(ls -1t "$BACKUP_DIR"/havefish-*.sql.gz 2>/dev/null | head -1 || true)}"
[[ -n "$DUMP" && -f "$DUMP" ]] || die "no dump found in $BACKUP_DIR — run ops/backup.sh first"

# A timer that quietly stopped running is the likeliest way this whole thing fails, and
# restoring a six-month-old dump would otherwise PASS and tell you nothing. Only applies
# when we picked the dump ourselves — restoring a named old dump is a deliberate act.
MAX_AGE_HOURS="${HAVEFISH_MAX_DUMP_AGE_HOURS:-48}"
if [[ -z "$EXPLICIT" && "$MAX_AGE_HOURS" != "0" ]]; then
  AGE_HOURS=$(( ( $(date +%s) - $(date -r "$DUMP" +%s) ) / 3600 ))
  if (( AGE_HOURS > MAX_AGE_HOURS )); then
    die "newest dump is ${AGE_HOURS}h old (limit ${MAX_AGE_HOURS}h) — backups have stopped running: $DUMP"
  fi
  echo "restore-check: newest dump is ${AGE_HOURS}h old"
fi

# Check the archive before touching the database, so a truncated or tampered dump fails
# with a sentence rather than a gzip warning from the middle of a pipeline.
gzip -t "$DUMP" 2>/dev/null || die "not a valid gzip stream (truncated or corrupt): $DUMP"

SCRATCH="havefish_restorecheck"
psql_scratch() { $COMPOSE exec -T postgres psql -qtAX --username "$POSTGRES_USER" --dbname "$SCRATCH" -c "$1"; }
psql_admin()   { $COMPOSE exec -T postgres psql -qtAX --username "$POSTGRES_USER" --dbname postgres -c "$1"; }

cleanup() { psql_admin "DROP DATABASE IF EXISTS $SCRATCH;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "restore-check: restoring $DUMP into $SCRATCH"
cleanup
psql_admin "CREATE DATABASE $SCRATCH;" >/dev/null

# --clean --if-exists in the dump means DROP statements run against an empty database
# and emit notices; ON_ERROR_STOP would abort on those, so check the data instead.
gzip -dc "$DUMP" | $COMPOSE exec -T postgres psql -q --username "$POSTGRES_USER" --dbname "$SCRATCH" >/dev/null

FAILED=0
echo "restore-check: comparing row counts against the live database"
printf '%-22s %12s %12s\n' TABLE LIVE RESTORED
for t in accounts transactions postings expense_groups group_expenses account_coverage; do
  live=$($COMPOSE exec -T postgres psql -qtAX --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
           -c "SELECT count(*) FROM $t;" 2>/dev/null | tr -d '[:space:]' || echo "?")
  got=$(psql_scratch "SELECT count(*) FROM $t;" 2>/dev/null | tr -d '[:space:]' || echo "?")
  printf '%-22s %12s %12s' "$t" "$live" "$got"
  if [[ "$live" == "$got" && "$got" != "?" ]]; then echo "  ok"; else echo "  MISMATCH"; FAILED=1; fi
done

# Row counts alone would pass on a dump full of NULLs. Check the ledger still balances
# in the restored copy: every transaction's postings must sum to zero per currency.
echo "restore-check: checking postings balance per transaction and currency"
UNBALANCED=$(psql_scratch "
  SELECT count(*) FROM (
    SELECT transaction_id, currency
    FROM postings WHERE deleted_at IS NULL
    GROUP BY transaction_id, currency
    HAVING sum(amount) <> 0
  ) AS bad;" | tr -d '[:space:]')
if [[ "$UNBALANCED" == "0" ]]; then
  echo "  all transactions balance"
else
  echo "  $UNBALANCED transaction/currency pairs do not balance"
  # Pre-existing imbalance in the live data would also show here, so this is a warning
  # about the ledger rather than proof the backup is bad. Check the live database too.
  echo "  (check the live database for the same query before blaming the backup)"
fi

if [[ $FAILED -eq 0 ]]; then
  echo "restore-check: PASS — $DUMP restores to a database matching live"
else
  echo "restore-check: FAIL — restored copy does not match live" >&2
  exit 1
fi
