# ops

Running have-fish on a server. Currently: backups.

## Backups

There were none. One Docker volume, no dumps, no offsite copy, no tested restore — the
top finding of the 2026-07-04 audit and the only gap on that list whose failure mode is
unrecoverable.

Two scripts:

- **`backup.sh`** — dumps the database to gzipped plain SQL, verifies the dump is neither
  truncated nor empty, rotates local copies, and optionally pushes offsite with restic.
- **`restore-check.sh`** — checks the newest dump is recent, replays it into a scratch
  database with `ON_ERROR_STOP` so a dump that only half-restores fails instead of
  reporting PASS, compares row counts for **every** table in the public schema against
  live, and checks that every transaction's postings still balance per currency. Drops the
  scratch database on the way out, including on failure.

A ledger table whose counts disagree is a failure. Better Auth's `session` and
`verification` tables are reported but not fatal: the dump is up to 48 hours older than
the live database it is compared against, so a single login would otherwise fail the
check, and a check that cries wolf is one you stop reading. They are still required to be
present and queryable — a table missing from the dump fails whatever its name.

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
# install, not cp: a restrictive root umask makes cp write these 0600, which works
# but leaves them unreadable to you. The service assumes the repo is at /opt/have-fish
# — edit WorkingDirectory and ExecStart if it is anywhere else, before enabling.
sudo install -o root -g root -m 644 -t /etc/systemd/system/ \
  ops/havefish-backup.service ops/havefish-backup-failed.service ops/havefish-backup.timer
sudo systemctl daemon-reload
systemd-analyze verify /etc/systemd/system/havefish-backup.service   # silence = paths are real
sudo systemctl enable --now havefish-backup.timer
systemctl list-timers havefish-backup
```

The unit assumes the repo is at `/opt/have-fish`; edit both `WorkingDirectory` and
`ExecStart` if not. `systemd-analyze verify` catches a wrong path before the timer does,
which is worth the two seconds — otherwise the first you hear of it is a failure
notification at midnight.

```bash
# 4. Be told when it breaks. Make a check at healthchecks.io (free tier is enough),
#    set its period to 1 day and its grace to a few hours, and put the ping URL in
#    the same credentials file:
echo 'HAVEFISH_PING_URL=https://hc-ping.com/your-uuid-here' \
  | sudo tee -a /etc/have-fish/backup.env >/dev/null
sudo systemctl restart havefish-backup.service   # take one now and watch the check go green
```

The unit also sets `RESTIC_CACHE_DIR` and lets systemd own `/var/cache/havefish-backup`.
Without it restic has no `$HOME` under systemd, cannot find a cache, and re-fetches index
and pack metadata from the remote on every run — which shows up in the journal as
`unable to open cache` and a warning that prune will be very slow.

`backup.sh` pings `…/start` when it begins and the bare URL when it finishes, so three
different failures all reach you: a run that **fails** (the `/fail` ping, sent from the
script's exit trap whatever killed it), a run that **never happens** (no start ping inside
the check's period — the case a dead timer creates, and the reason P0.1 exists), and a run
that **cannot start at all** (`OnFailure=havefish-backup-failed.service`, for a bad
`WorkingDirectory` or an OOM kill before the script's own trap is armed). An ntfy topic or
any URL that lands on your phone works the same way; leave `HAVEFISH_PING_URL` unset and
every ping is skipped silently.

Put a monthly `restore-check.sh` in your calendar — deliberately not automated, because a
restore check that nobody reads is the same as no restore check.

That monthly run is also how you find out the timer died. `restore-check.sh` refuses a
newest dump older than 48 hours rather than cheerfully restoring a stale one and
reporting PASS — a backup job that silently stopped months ago is the likeliest way this
fails, and it looks identical to a healthy one until you need it. Restoring a
deliberately old dump still works: name it as an argument and the age check is skipped.

### Configuration

All optional; the defaults work.

| Variable | Default | Meaning |
|---|---|---|
| `HAVEFISH_BACKUP_DIR` | `./backups` | Where local dumps land |
| `HAVEFISH_KEEP_LOCAL` | `14` | Local dumps kept; restic handles long-term retention |
| `HAVEFISH_MAX_DUMP_AGE_HOURS` | `48` | `restore-check.sh` fails if the newest dump is older; `0` disables |
| `HAVEFISH_COMPOSE` | autodetected | `podman compose` or `docker compose` |
| `HAVEFISH_PING_URL` | unset | Heartbeat base URL; unset means no monitoring and no pings |
| `HAVEFISH_RESTIC_HOST` | `havefish` | Hostname stamped on snapshots; fixed so a server move keeps one retention series |
| `HAVEFISH_PRUNE_EVERY_DAYS` | `7` | How often `forget` also prunes; `0` never prunes and never reclaims space |
| `RESTIC_REPOSITORY` | unset | Unset means local-only, and the script says so each run |
| `RESTIC_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` | `7` / `4` / `12` | Offsite retention, applied with `--group-by host,tags` |

### Offsite retention needs `--group-by host,tags`

Not a detail. `restic forget` groups snapshots by host *and paths* by default, and every
run backs up a differently named file — so each snapshot lands in a group of one, every
group's single member is the newest in that group, and `--keep-daily 7` keeps all of them
forever. Ten daily snapshots in a scratch repository: the default grouping proposes
removing **none**; `--group-by host,tags` makes one group of ten, keeps seven, removes
three. Check yours with `restic snapshots --group-by host,tags` — one group is right.

Which is also why `backup.sh` passes `--host havefish` rather than letting restic use the
machine's real hostname: moving the server to new hardware would otherwise start a second
group, and the old machine's snapshots would never age out, because ageing out needs newer
snapshots in the same group and none ever arrive again. Measured on the same ten daily
snapshots, six taken before a move and four after: with the real hostnames restic sees two
groups and removes **nothing**; with the fixed host it sees one group, keeps seven and
removes three. If snapshots already exist under a real hostname, they stay in their own
group — `restic forget --group-by host,tags --host <oldname> --keep-last 1` once, or just
let them sit; they are a handful of small files.

### `forget` nightly, `prune` weekly

`forget` drops snapshot references and costs almost nothing, so it runs every night and
the snapshot list is always correct. `prune` is the expensive half — it downloads
partially-used pack files, rewrites the blobs still in use, uploads the replacements and
deletes the originals — so it runs every seventh day, tracked by `backups/.last-prune`
rather than a weekday, so a machine that was off on the chosen day does not skip a whole
cycle. The only consequence is that space from forgotten snapshots is reclaimed up to a
week late.

Two things worth knowing before tuning this. The dump is gzipped before restic sees it,
and two gzips of slightly different SQL share almost no bytes, so deduplication between
days is close to zero and every snapshot is effectively a standalone copy — which is also
why prune has little to repack here. And the storage bill is not the reason for any of
this: 23 snapshots at a few hundred KB is single-digit megabytes, which at B2's $6/TB/month
rounds to nothing. The reason is not doing avoidable work unattended at 3am.

### If you set this up before the P0.2 fixes

Dumps written by the earlier script were world-readable, and `umask` cannot retroactively
fix files that already exist:

```bash
chmod 700 backups
chmod 600 backups/*.sql.gz
```

Then `restic forget --dry-run --tag havefish --group-by host,tags --keep-daily 7` once, to
see what the old grouping had been quietly keeping.

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
