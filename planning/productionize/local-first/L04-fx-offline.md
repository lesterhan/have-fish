# L04 — FX rates offline-first

**Status:** Draft (short doc — the problem is bounded)

## Current behaviour

The backend fetches daily rates from `frankfurter.app` (a free API over ECB reference
rates) and caches them in the `fx_rates` table. Multi-currency reporting and
cross-currency settlement read from the cache. In the cloud model the server is
always online; locally, the app may be offline for days (the travel use case —
exactly when multi-currency matters most).

## Design changes

1. **Cache-first is already right** — keep `fx_rates` as the only read path. The
   change is around *filling* it:
   - Background refresh on launch + periodically while online; silent failure.
   - **Backfill gaps** on reconnect (Frankfurter supports date-range queries),
     since a laptop that was closed for two weeks needs the missing days, not just
     today.
2. **Seed dataset shipped in the binary:** ECB reference rates are free to
   redistribute (with attribution). Bundle recent history for ECB-covered
   currencies (~30) at build time — a few MB of embedded data (L01 asset
   embedding) — so a fresh offline install can still convert.
3. **Stale-rate honesty in the UI:** converted amounts show an unobtrusive marker
   when the rate used is > N days old (tooltip: rate date). Never block entry on
   missing rates.
4. **Manual rate entry** as the ultimate fallback (also useful for currencies ECB
   doesn't cover — e.g. many travel currencies): user-entered rates stored in
   `fx_rates` with a `source` column (`ecb | manual`), manual wins for its date.
   Cross-currency settlements already pin `fxRate` on the settlement row, so ledger
   history is immune to later rate changes — good, keep that invariant.
5. **Provider resilience:** Frankfurter is a hobby-scale free API. Alternatives if
   it disappears: ECB's own daily XML/CSV feed (the upstream source), or
   exchangerate.host-class APIs. Isolate behind the existing fetch service so the
   provider is swappable; in the *local* model each user fetches for themselves, so
   rate-limit pressure on the provider is naturally distributed (be a good citizen:
   fetch once per day per install, honour caching headers).

## Work breakdown

Small epic, ≈1 wk: source column + manual-rate UI; gap backfill; seed-data build
step; staleness indicator. No open questions.

## Sources

- [Frankfurter API](https://frankfurter.dev/) — current provider, date-range endpoints
- [ECB euro foreign exchange reference rates](https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html) — upstream data + usage terms (free with attribution)
- Codebase: `backend/src/routes/fx-rates.ts`, `fx_rates` table in `backend/src/db/schema.ts`
