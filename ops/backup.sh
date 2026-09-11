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

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

QUIET=0
[[ "${1:-}" == "--quiet" ]] && QUIET=1
log() { [[ $QUIET -eq 1 ]] || echo "$@"; }
die() { echo "backup: $*" >&2; exit 1; }

[[ -f .env ]] || die "no .env at $ROOT — copy .env.example and fill it in"
set -a; . ./.env; set +a

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
mkdir -p "$BACKUP_DIR"

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

# A dump with no COPY or INSERT lines is an empty database or a silent auth failure.
if ! gzip -dc "$TMP" | grep -qE '^(COPY|INSERT INTO) '; then
  rm -f "$TMP"
  die "dump contains no table data — refusing to keep it"
fi

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
  restic backup --quiet --tag havefish "$OUT"
  restic forget --quiet --prune --tag havefish \
    --keep-daily "${RESTIC_KEEP_DAILY:-7}" \
    --keep-weekly "${RESTIC_KEEP_WEEKLY:-4}" \
    --keep-monthly "${RESTIC_KEEP_MONTHLY:-12}"
  log "backup: offsite ok"
else
  log "backup: RESTIC_REPOSITORY unset — local only, no offsite copy"
fi

log "backup: done"
