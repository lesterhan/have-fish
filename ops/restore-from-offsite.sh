#!/usr/bin/env bash
#
# Rehearse the disaster. Pull the newest offsite snapshot, restore it into a throwaway
# database on THIS machine, and check it holds a real ledger.
#
# This is deliberately not restore-check.sh. That one runs on the server, against the
# live database, with credentials that live on the box it is protecting — so it cannot
# tell you whether you could rebuild from nothing. This one assumes the server is gone
# and everything you have is a password manager. Run it on a laptop, once in a while.
#
# Nothing here touches the server, and nothing writes to the offsite repository.
#
# Usage:  ops/restore-from-offsite.sh [snapshot-id]     (default: latest)
set -euo pipefail
# The restored ledger is every transaction you have ever made. Nothing this creates is
# readable by anyone but the owner.
umask 077

log()  { echo "restore-from-offsite: $*"; }
die()  { echo "restore-from-offsite: $*" >&2; exit 1; }

SNAPSHOT="${1:-latest}"
TAG="${HAVEFISH_RESTIC_TAG:-havefish}"
SCRATCH="${HAVEFISH_SCRATCH_CONTAINER:-havefish-restore-check}"
# Match the server's Postgres major version: a dump from 16 does not reliably replay
# into 15. Fully qualified because podman does not assume Docker Hub and will otherwise
# stop to ask which registry you meant, which hangs an unattended run.
PG_IMAGE="${HAVEFISH_PG_IMAGE:-docker.io/library/postgres:16-alpine}"

command -v restic >/dev/null 2>&1 || die "restic is not installed"

# podman first, same precedence as backup.sh, so a laptop running podman and a server
# running docker both work with no flags.
CONTAINER="${HAVEFISH_CONTAINER:-}"
if [[ -z "$CONTAINER" ]]; then
  if   command -v podman >/dev/null 2>&1; then CONTAINER=podman
  elif command -v docker >/dev/null 2>&1; then CONTAINER=docker
  else die "neither podman nor docker found; set HAVEFISH_CONTAINER"
  fi
fi

: "${RESTIC_REPOSITORY:?not set — e.g. export RESTIC_REPOSITORY=b2:your-bucket:havefish}"

# Asking here rather than telling you to export them first is not politeness: pasting a
# block of `read` lines into a shell makes each read swallow the next line of the paste
# as its input, and you end up authenticating with a fragment of the instructions.
ask() {  # ask VARNAME "prompt"
  local -n ref="$1"
  [[ -n "${ref:-}" ]] && return 0
  [[ -t 0 ]] || die "$1 is not set and there is no terminal to ask on"
  read -rsp "$2: " ref; echo
  export "${!ref}"
}
if [[ -z "${RESTIC_PASSWORD:-}" && -z "${RESTIC_PASSWORD_FILE:-}" ]]; then
  ask RESTIC_PASSWORD "restic repository password"
fi
if [[ "$RESTIC_REPOSITORY" == b2:* ]]; then
  ask B2_ACCOUNT_ID  "B2 keyID"
  ask B2_ACCOUNT_KEY "B2 applicationKey"
fi

# Opening the repository at all is the single most informative step in this script: it
# proves the password you kept somewhere else is the password that decrypts the backups.
log "opening $RESTIC_REPOSITORY"
restic snapshots --tag "$TAG" --latest 3 || die "could not open the repository — wrong password, wrong keys, or wrong repository"

# `restic dump` streams one file's contents; `restic restore` would rebuild the whole
# path tree with the modes it recorded, and the backups directory is mode 700 owned by
# root on the server, so a non-root restore lands somewhere you cannot read.
DUMP_PATH="$(restic ls "$SNAPSHOT" --tag "$TAG" 2>/dev/null | grep -E '\.sql\.gz$' | tail -1 || true)"
[[ -n "$DUMP_PATH" ]] || die "no .sql.gz found in snapshot '$SNAPSHOT' with tag '$TAG'"
log "restoring $DUMP_PATH"

$CONTAINER rm -f "$SCRATCH" >/dev/null 2>&1 || true
log "starting a throwaway $PG_IMAGE as $SCRATCH"
$CONTAINER run --rm -d --name "$SCRATCH" \
  -e POSTGRES_USER=havefish \
  -e POSTGRES_PASSWORD=scratch \
  -e POSTGRES_DB=havefish_restore \
  "$PG_IMAGE" >/dev/null

ready=0
for _ in $(seq 60); do
  if $CONTAINER exec "$SCRATCH" pg_isready -U havefish -q >/dev/null 2>&1; then ready=1; break; fi
  sleep 1
done
(( ready )) || die "$SCRATCH did not become ready; check '$CONTAINER logs $SCRATCH'"

psql_scratch() { $CONTAINER exec -i "$SCRATCH" psql -qtAX -U havefish -d havefish_restore -c "$1"; }

# ON_ERROR_STOP or this is theatre: without it psql prints the error, carries on, and
# exits 0, so a dump that only half-replays reports success.
log "replaying the dump"
restic dump "$SNAPSHOT" "$DUMP_PATH" \
  | gzip -dc \
  | $CONTAINER exec -i "$SCRATCH" psql -q -v ON_ERROR_STOP=1 -U havefish -d havefish_restore >/dev/null \
  || die "the dump does not replay cleanly — this backup would not have saved you"

TABLES=$(psql_scratch "SELECT count(*) FROM pg_tables WHERE schemaname='public';" | tr -d '[:space:]')
TXNS=$(psql_scratch   "SELECT count(*) FROM transactions WHERE deleted_at IS NULL;" | tr -d '[:space:]')
POSTS=$(psql_scratch  "SELECT count(*) FROM postings WHERE deleted_at IS NULL;" | tr -d '[:space:]')
UNBAL=$(psql_scratch "
  SELECT count(*) FROM (
    SELECT transaction_id, currency FROM postings WHERE deleted_at IS NULL
    GROUP BY transaction_id, currency HAVING sum(amount) <> 0) bad;" | tr -d '[:space:]')

echo
printf '  %-28s %s\n' "tables in public"      "$TABLES"
printf '  %-28s %s\n' "transactions"          "$TXNS"
printf '  %-28s %s\n' "postings"              "$POSTS"
printf '  %-28s %s\n' "unbalanced txn/ccy"    "$UNBAL"
echo

[[ "$TXNS"  =~ ^[0-9]+$ && "$TXNS"  -gt 0 ]] || die "restored copy holds no transactions"
[[ "$UNBAL" == "0" ]] || die "$UNBAL transaction/currency pairs do not balance in the restored copy"

# Counts prove the machinery. Recognising your own money is the part that decides whether
# the backup is real, and no script can do it for you — so the last thing this prints is
# your ledger, and the last step is yours.
log "the ten most recent postings in the restored copy:"
$CONTAINER exec -i "$SCRATCH" psql -U havefish -d havefish_restore -c "
  SELECT t.date::date AS date,
         coalesce(t.description, '(none)') AS description,
         p.currency, p.amount,
         coalesce(a.name, a.path) AS account
  FROM transactions t
  JOIN postings p ON p.transaction_id = t.id
  JOIN accounts a ON a.id = p.account_id
  WHERE t.deleted_at IS NULL AND p.deleted_at IS NULL
  ORDER BY t.date DESC, t.id, p.amount DESC
  LIMIT 10;"

cat <<EOF

restore-from-offsite: the checks passed. Now read the rows above and confirm they are
your money — that is the step that matters, and it is the one you have to do yourself.

The scratch database is still running, so you can look further:
  $CONTAINER exec -it $SCRATCH psql -U havefish -d havefish_restore

When you are done:
  $CONTAINER rm -f $SCRATCH
  unset RESTIC_PASSWORD B2_ACCOUNT_ID B2_ACCOUNT_KEY
EOF
