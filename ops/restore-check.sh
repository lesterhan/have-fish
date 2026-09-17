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
# This script writes nothing but temporary psql output; the umask is here so that stays
# true if it ever grows a scratch file.
umask 077

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
psql_db()      { $COMPOSE exec -T postgres psql -qtAX --username "$POSTGRES_USER" --dbname "$1" -c "$2"; }
psql_scratch() { psql_db "$SCRATCH" "$1"; }
psql_admin()   { psql_db postgres "$1"; }
psql_live()    { psql_db "$POSTGRES_DB" "$1"; }

cleanup() { psql_admin "DROP DATABASE IF EXISTS $SCRATCH;" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "restore-check: restoring $DUMP into $SCRATCH"
cleanup
psql_admin "CREATE DATABASE $SCRATCH;" >/dev/null

# ON_ERROR_STOP or the restore is theatre: without it psql prints the error, carries on,
# and exits 0, so a dump that half-restores reports PASS. The DROPs in a --clean dump are
# the reason it was left off, and --if-exists already demotes those to notices, which
# ON_ERROR_STOP does not trip on.
gzip -dc "$DUMP" | $COMPOSE exec -T postgres psql -q -v ON_ERROR_STOP=1 \
  --username "$POSTGRES_USER" --dbname "$SCRATCH" >/dev/null \
  || die "restore failed — the dump does not replay cleanly into an empty database: $DUMP"

# Every table, not a hand-written six. A list that has to be edited when the schema grows
# is a list that silently stops covering the new table, which is the one most likely to be
# missing from an old dump.
TABLES=$(psql_live "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY 1;" | tr -d '\r')
[[ -n "$TABLES" ]] || die "live database $POSTGRES_DB has no tables in schema public — wrong database?"

FAILED=0
echo "restore-check: comparing row counts for $(wc -l <<<"$TABLES") tables against the live database"
echo "restore-check: live is read at a later instant than the dump, so a few rows' drift on"
echo "               transactions or postings right after a write is expected, not a fault."
printf '%-32s %12s %12s\n' TABLE LIVE RESTORED
for t in $TABLES; do
  live=$(psql_live "SELECT count(*) FROM public.\"$t\";" 2>/dev/null | tr -d '[:space:]' || echo "?")
  got=$(psql_scratch "SELECT count(*) FROM public.\"$t\";" 2>/dev/null | tr -d '[:space:]' || echo "?")
  printf '%-32s %12s %12s' "$t" "$live" "$got"
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
