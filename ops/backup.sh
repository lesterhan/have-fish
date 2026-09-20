#!/usr/bin/env bash
#
# Dump the have-fish database, rotate local copies, and optionally push offsite.
#
# Plain SQL, gzipped — not pg_dump's custom format. A backup you cannot read with
# `zless` is a backup you have to trust rather than inspect, and this project's whole
# premise is not having to trust anyone about your own data. At this data size the
# format costs nothing.
#
# Usage:  ops/backup.sh [--quiet]
# Cron:   see ops/README.md
set -euo pipefail
# Dumps are the whole ledger in plain text. Nothing this script creates is readable by
# anyone but the owner, including the directory it creates on a first run.
umask 077

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1
log() { [[ $QUIET -eq 1 ]] || echo "$@"; }
die() { echo "backup: $*" >&2; exit 1; }

# Heartbeat. HAVEFISH_PING_URL is a healthchecks.io check URL (or an ntfy topic, or
# anything that lands on a phone). Pinging /start at the top and the bare URL at the end
# means a run that *never happens* is alerted too, which is the failure P0.1 makes
# likely: a silent timer looks exactly like a healthy one until you need the backup.
# Never fatal — a backup that worked must not be reported as failed because the network
# was down.
heartbeat() {
  [[ -n "${HAVEFISH_PING_URL:-}" ]] || return 0
  curl -fsS -m 10 --retry 3 -o /dev/null "${HAVEFISH_PING_URL%/}${1:-}" || \
    echo "backup: warning — could not reach ${HAVEFISH_PING_URL%/}${1:-}" >&2
}

# Any exit but a clean one tells the monitor, whether it came from die(), from set -e, or
# from the machine losing power mid-run.
trap 'rc=$?; (( rc == 0 )) || heartbeat /fail' EXIT

[[ -f .env ]] || die "no .env at $ROOT — copy .env.example and fill it in"
set -a; . ./.env; set +a

heartbeat /start

: "${POSTGRES_USER:?not set in .env}"
: "${POSTGRES_DB:?not set in .env}"

# podman and docker are interchangeable here; prefer whichever the host actually has.
COMPOSE="${HAVEFISH_COMPOSE:-}"
if [[ -z "$COMPOSE" ]]; then
  if command -v podman >/dev/null 2>&1; then COMPOSE="podman compose"
  elif command -v docker >/dev/null 2>&1; then COMPOSE="docker compose"
  else die "neither podman nor docker found; set HAVEFISH_COMPOSE"
  fi
fi

BACKUP_DIR="${HAVEFISH_BACKUP_DIR:-$ROOT/backups}"
KEEP_LOCAL="${HAVEFISH_KEEP_LOCAL:-14}"

# restic stamps every snapshot with the machine's hostname, and the --group-by below
# groups on it. Move the server to new hardware and the new hostname starts a second
# retention group: 7/4/12 kept from each, and the old machine's snapshots never age out,
# because ageing out requires newer snapshots in the same group and none ever arrive. A
# fixed name keeps one series across a hardware change. Override only if two machines
# genuinely back up to this repository and you want them retained apart.
SNAPSHOT_HOST="${HAVEFISH_RESTIC_HOST:-havefish}"
mkdir -p "$BACKUP_DIR"
# umask only covers what this run creates; an existing directory from before keeps its
# mode, so say it outright.
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/havefish-$STAMP.sql.gz"
TMP="$OUT.partial"

# Write to .partial and rename only on success, so a dump interrupted halfway
# (power cut, OOM, lid closed) never leaves a truncated file that looks complete.
log "backup: dumping $POSTGRES_DB"
if ! $COMPOSE exec -T postgres pg_dump \
      --username "$POSTGRES_USER" \
      --dbname "$POSTGRES_DB" \
      --clean --if-exists --no-owner --no-privileges \
    | gzip -9 > "$TMP"; then
  rm -f "$TMP"
  die "pg_dump failed — nothing written"
fi

# gzip -t catches a stream that ended early but still exited 0 somewhere in the pipe.
gzip -t "$TMP" || { rm -f "$TMP"; die "dump is not a valid gzip stream — discarded"; }

# A dump with no COPY or INSERT lines at all is a schema-only dump — the one failure the
# live row count below cannot see, since it asks the database rather than the file.
#
# grep -c, not grep -q: -q exits the moment it matches, gzip takes SIGPIPE while it is
# still decompressing the rest, and `set -o pipefail` turns that 141 into a pipeline
# failure. The guard then reports "no table data" about a perfectly good dump. It only
# bites once the dump outgrows the 64K pipe buffer, which is to say only on a real
# ledger and never on a test fixture.
DATA_SECTIONS=$(gzip -dc "$TMP" | grep -cE '^(COPY|INSERT INTO) ' || true)
if [[ ! "$DATA_SECTIONS" =~ ^[0-9]+$ || "$DATA_SECTIONS" -eq 0 ]]; then
  rm -f "$TMP"
  die "dump contains no table data — refusing to keep it"
fi

# The line above passes on a dump of an empty ledger: a table with no rows still emits a
# COPY header. Ask the live database instead. A count of zero means the wrong database,
# a wiped volume, or an auth failure that answered politely — all three are things you
# want to hear about tonight rather than at restore time.
ROWS=$($COMPOSE exec -T postgres psql -qtAX -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c "SELECT count(*) FROM transactions WHERE deleted_at IS NULL;" | tr -d '[:space:]')
[[ "$ROWS" =~ ^[0-9]+$ && "$ROWS" -gt 0 ]] || { rm -f "$TMP"; die "live database reports ${ROWS:-no} transactions — refusing to keep a dump of an empty ledger"; }
log "backup: live ledger holds $ROWS transactions"

mv "$TMP" "$OUT"
log "backup: wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Rotate local copies. Offsite retention is restic's job, not this script's.
mapfile -t OLD < <(ls -1t "$BACKUP_DIR"/havefish-*.sql.gz 2>/dev/null | tail -n "+$((KEEP_LOCAL + 1))")
if [[ ${#OLD[@]} -gt 0 ]]; then
  log "backup: pruning ${#OLD[@]} local dump(s) beyond $KEEP_LOCAL"
  rm -f "${OLD[@]}"
fi

# Offsite. Optional: unset RESTIC_REPOSITORY and this is a local-only backup,
# which protects against disk failure but not against the house burning down.
if [[ -n "${RESTIC_REPOSITORY:-}" ]]; then
  command -v restic >/dev/null 2>&1 || die "RESTIC_REPOSITORY set but restic is not installed"
  log "backup: pushing to $RESTIC_REPOSITORY"
  restic backup --quiet --tag havefish --host "$SNAPSHOT_HOST" "$OUT"
  # --group-by is not optional: restic's default groups by host *and* paths, and every
  # run backs up a differently named file, so each snapshot lands in a group of one and
  # --keep-daily keeps all of them forever. Grouping by tag alone makes retention apply
  # to the series.
  restic forget --quiet --prune --tag havefish --group-by host,tags \
    --keep-daily "${RESTIC_KEEP_DAILY:-7}" \
    --keep-weekly "${RESTIC_KEEP_WEEKLY:-4}" \
    --keep-monthly "${RESTIC_KEEP_MONTHLY:-12}"
  log "backup: offsite ok"
else
  log "backup: RESTIC_REPOSITORY unset — local only, no offsite copy"
fi

heartbeat
log "backup: done"
