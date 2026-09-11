# ops

Running have-fish on a server. Currently: backups.

## Backups

There were none. One Docker volume, no dumps, no offsite copy, no tested restore — the
top finding of the 2026-07-04 audit and the only gap on that list whose failure mode is
unrecoverable.

Two scripts:

- **`backup.sh`** — dumps the database to gzipped plain SQL, verifies the dump is neither
  truncated nor empty, rotates local copies, and optionally pushes offsite with restic.
- **`restore-check.sh`** — restores the most recent dump into a scratch database, compares
  row counts against live, and checks that every transaction's postings still balance per
  currency. Drops the scratch database on the way out, including on failure.

Run the second one. A backup nobody has restored is a hope.

### Why plain SQL rather than `pg_dump -Fc`

Custom format is the better operational choice in general — selective restore, parallel
restore, built-in compression. It is the wrong choice here. A backup you cannot read with
`zless` is one you have to trust somebody about, and not having to do that is the entire
premise of this project. At this data size the format costs nothing either way.

### Setup

```bash
# 1. From the repo root on the server, take one now and check it restores.
ops/backup.sh
ops/restore-check.sh
```

That alone fixes the unrecoverable half: dumps land in `./backups/`, the most recent 14
are kept, and you can restore any of them. It does not protect against losing the machine.

```bash
# 2. Offsite, so a dead disk or a house fire is survivable. Backblaze B2 costs
#    cents at this data size; any restic backend works.
sudo mkdir -p /etc/have-fish
sudo tee /etc/have-fish/backup.env >/dev/null <<'EOF'
RESTIC_REPOSITORY=b2:your-bucket-name:havefish
RESTIC_PASSWORD=a-long-random-string-you-keep-somewhere-else
B2_ACCOUNT_ID=...
B2_ACCOUNT_KEY=...
EOF
sudo chmod 600 /etc/have-fish/backup.env

restic init   # once, with those variables exported
```

`RESTIC_PASSWORD` encrypts the repository. **Store it somewhere that is not the server
being backed up** — losing it loses the offsite copies. This is also where the
encryption-at-rest question gets answered for free: the offsite copies are encrypted
whether or not the server's disk is.

```bash
# 3. Run it daily.
sudo cp ops/havefish-backup.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now havefish-backup.timer
systemctl list-timers havefish-backup
```

The unit assumes the repo is at `/opt/have-fish`; edit `WorkingDirectory` if not. Put a
monthly `restore-check.sh` in your calendar — deliberately not automated, because a
restore check that nobody reads is the same as no restore check.

### Configuration

All optional; the defaults work.

| Variable | Default | Meaning |
|---|---|---|
| `HAVEFISH_BACKUP_DIR` | `./backups` | Where local dumps land |
| `HAVEFISH_KEEP_LOCAL` | `14` | Local dumps kept; restic handles long-term retention |
| `HAVEFISH_COMPOSE` | autodetected | `podman compose` or `docker compose` |
| `RESTIC_REPOSITORY` | unset | Unset means local-only, and the script says so each run |
| `RESTIC_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` | `7` / `4` / `12` | Offsite retention |

### Restoring for real

```bash
gzip -dc backups/havefish-20260911T120000Z.sql.gz \
  | podman compose exec -T postgres psql -U havefish -d havefish
```

The dump carries `--clean --if-exists`, so it drops and recreates its own objects. Stop
the backend first so nothing writes underneath the restore.

### What this does not cover

Postgres is the whole story today, so dumping it is enough. Once the local-first work
lands (`planning/productionize/00-direction.md`), the ledger is a SQLite file on each
user's machine and this script stops being the primary defence — `L02` moves that
responsibility into the app, with automatic local backup rotation and restore offered as
a first-run path. This is the right answer for the deployment that exists now, and it is
expected to be replaced rather than extended.
