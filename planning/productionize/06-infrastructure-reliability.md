# 06 — Infrastructure & reliability

**Status:** Outline — research queue for a future session. Depends on open question
**Q4 (PROGRESS.md): home server vs. managed hosting** — answer that first; it reshapes
every section below.

## Framing

Doc 01's most severe finding lives here: **no backups, no tested restore**. Second:
the whole stack assumes a trusted tailnet (published DB port, no TLS, root
containers, migrations-on-start). A paying user's bar: their ledger survives a dead
disk, and the service is up when they open the app at a café.

## Sections to write (research queue)

1. **Hosting decision (Q4)** — home server (cost ~$0, but residential uptime, power,
   ISP, physical security, and *you* are the failover) vs. VPS (Hetzner/DO/Vultr,
   ~$10–30/mo, snapshots) vs. PaaS (Fly.io/Railway) vs. managed Postgres split
   (Neon/Supabase/Crunchy — backups and PITR become a checkbox). Gut lean to
   evaluate: **small VPS + managed Postgres** = most reliability per dollar per
   ops-hour for a solo operator; home server stays as staging.
2. **Backups & disaster recovery** — implement doc 02 §5. Define RPO/RTO targets
   (propose: RPO ≤ 24h launch / ≤ 1h later via WAL shipping; RTO ≤ 4h). Write the
   restore runbook and a monthly automated restore test. DR scenario table: dead
   disk, dead host, dead provider, bad migration, fat-fingered delete.
3. **TLS & edge** — Caddy (or Traefik) reverse proxy, auto-certs, HTTP→HTTPS,
   security headers here or in-app (doc 02 §1). Optional Cloudflare in front for
   DDoS absorption at zero cost — decide with awareness they see plaintext.
4. **Compose → production topology** — remove published Postgres port; non-root
   containers, resource limits, restart policies, healthchecks for backend/frontend
   (backend `/health` exists — add a DB-touching readiness variant); pinned image
   digests instead of `:latest`.
5. **Deploys & migrations** — decouple `db:migrate` from container start (doc 01):
   explicit migrate step in deploy script; expand-contract convention for zero-ish
   downtime; rollback procedure (image rollback + migration down-plan policy).
   Staging environment definition; smoke test post-deploy.
6. **Scaling reality check** — do the math for 100 / 1k / 10k users (postings-table
   growth per active importer, report query cost). Likely conclusion: one decent
   Postgres carries this for years — write it down so nobody builds queues
   prematurely. Identify the first real bottlenecks (report aggregation, CSV import
   bursts) and their cheap mitigations (indexes, materialized summaries).
7. **FX-rate dependency** — frankfurter.app has no SLA. Cache-first design already
   exists (`fx_rates` table); add: retry/backoff, stale-rate tolerance policy,
   fallback provider list (ECB direct), and alerting when rates go stale (doc 07).
8. **Uptime target & status page** — honest SLO for a solo operator (99.5%?);
   maintenance-window comms channel; external uptime monitor (UptimeRobot/Hetrix).

## Sources (seed list — expand when writing)

- [pgBackRest](https://pgbackrest.org/) / [WAL-G](https://github.com/wal-g/wal-g) — PITR backups
- [Caddy — Automatic HTTPS](https://caddyserver.com/docs/automatic-https)
- [Docker Compose — production guidance](https://docs.docker.com/compose/production/)
- [Google SRE Book — Ch. 4, SLOs](https://sre.google/sre-book/service-level-objectives/) (right-size the target)
- [PostgreSQL — backup docs](https://www.postgresql.org/docs/current/backup.html)
- Expand-contract migrations: [PlanetScale — safe schema changes](https://planetscale.com/blog/safely-making-database-schema-changes)
