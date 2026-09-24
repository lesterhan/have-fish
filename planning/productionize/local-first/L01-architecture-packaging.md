# L01 — Architecture & packaging

**Status:** Draft (first full pass 2026-07-04)
**Decision this doc drives:** what *is* the executable — and how much of the current
codebase survives.

## Form-factor options

### Option A — Bun compiled binary + browser UI (recommended MVP)

`bun build --compile` bundles our TypeScript and the Bun runtime into a single
executable per platform, no runtime install needed. The binary runs the existing Hono
app bound to `127.0.0.1`, serves the SvelteKit frontend as embedded static files, and
opens the user's default browser at `http://127.0.0.1:<port>`.

- **Reuse:** nearly everything. Hono routes, services, Drizzle (with the L02 data
  layer swap), the whole Svelte frontend. This is the smallest redesign by far.
- **Cross-compilation:** Bun cross-compiles to Linux/macOS/Windows (x64/arm64) from
  one CI job via `--target` — no per-OS build machines.
- **Asset embedding:** static frontend build embedded via `with { type: "file" }`
  imports / glob embedding in `Bun.build()`. Known rough edge: embedded *directories*
  have open issues (oven-sh/bun #23852) — plan a build script that manifests files
  explicitly rather than trusting directory globs.
- **Frontend change:** switch SvelteKit from `adapter-node` (SSR + proxy) to
  `adapter-static` (SPA). The app is behind auth and fully dynamic — SSR buys nothing
  locally. API calls go to the same origin, so CORS complexity disappears.
- **Size:** expect a ~60–100 MB binary (Bun runtime included). Fine for desktop.
- **Cons:** it's "an app that lives in your browser tab" — no dock icon/native menus,
  and users must not lose the tab. Mitigable later (see Option B as a shell).

### Option B — Tauri v2 wrapper (polish phase, not MVP)

Tauri gives a real windowed desktop app (~10 MB shell) using the OS webview. Our
backend is not Rust, so the Hono/Bun logic runs as a **sidecar**: Tauri v2 supports
bundling and supervising an external binary — *the same compiled Bun binary from
Option A*. Tauri then contributes: native window/menu/tray, the updater plugin, and
installer packaging (`.dmg`, `.msi`, `.deb`/AppImage).

- Option A is strictly a prerequisite of Option B — so building A first is not
  throwaway work. Decide on B when polish/updates matter (L05).
- The design system already mimics a desktop OS; in a native window the illusion
  completes. (Amusingly, Graphite chrome in a real window is the whole aesthetic
  thesis.)

### Option C — Electron (rejected)

Ships a full Chromium (~200 MB), we'd still need the Node/Bun sidecar or a backend
rewrite, and Tauri covers every need for less. No advantage for us.

### Option D — Full SPA, no server at all (rejected for now)

Move all logic into the frontend, PGlite/wa-sqlite in the browser, ship as a static
site or Tauri app with no backend process. Maximum rewrite (every route/service moves
into the client), kills the co-located route test suite, and complicates CSV
processing and the hledger export CLI story. Revisit only if Option A's process model
proves painful.

## Recommendation

**A now, B later.** One codebase, three artifacts eventually: cloud container
(Track A), bare binary (CLI-friendly, self-hosters), Tauri-wrapped desktop app.

## Process & lifecycle design (Option A specifics)

- **Bind `127.0.0.1` only, never `0.0.0.0`.** Port: pick a fixed default with fallback
  scan; print/open the URL. (Security implications — DNS rebinding, browser access to
  localhost — are L07's core topic; the design answer lands here: token-gated session
  bootstrap + `Host`/`Origin` validation.)
- **Single-instance lock** (lockfile in the data dir) so a second launch focuses the
  existing instance's URL instead of racing on the DB file.
- **Auth in local mode:** no email/password. First launch creates the single local
  profile; optional app passphrase later (ties to L02 encryption question). Better
  Auth is *removed* from the local build path — the session middleware in `app.ts`
  gets a `LOCAL_MODE` branch that injects the local profile's `userId`. Identity
  reappears only when the user connects to a sync service (L03).
- **Mode flag, one codebase:** `HAVEFISH_MODE=local|server` selected at build/run
  time. The route/service layer stays identical; only the edges differ (auth
  middleware, DB driver, static serving). Keeping the seam this narrow is the main
  architectural discipline of the whole track.
- **Graceful shutdown:** SIGINT/window-close → checkpoint DB, release lock. No
  background daemon in v1 (a tray daemon is a Tauri-phase decision).
- **Updates:** out of scope here — L05 (manual download → in-app "new version"
  notice → Tauri updater, in that order of effort).

## What this does to the test suite

The route tests (`app.request()` against real Postgres) are the project's crown
jewel. Local mode must not orphan them:

- Tests run against the same route layer with the L02 embedded DB — *faster* than
  Postgres if SQLite is chosen (or identical if PGlite).
- Add a CI matrix leg: run the suite in `local` mode + embedded DB and in `server`
  mode + Postgres, so both artifacts stay green. This doubles CI DB-dialect coverage
  and is the honest cost of the dual-mode decision (L02 discusses).

## Phased work breakdown

**Phase P1 — spike (≈1 wk):** compile a hello-world Hono+static+SQLite binary for all
3 OS targets; verify embedded-asset and `bun:sqlite`-in-compiled-binary behavior;
measure size/startup. Kill-or-commit gate for the whole track.
**Phase P2 — mode seam (≈2–3 wks):** `LOCAL_MODE` auth branch; adapter-static
frontend build; static serving from the binary; single-instance lock; browser-open;
port handling.
**Phase P3 — data layer (L02, parallel):** embedded DB migration.
**Phase P4 — release pipeline (L05):** CI cross-compile matrix, checksums, signing.

## Sources

- [Bun — Single-file executables](https://bun.com/docs/bundler/executables) (compile, cross-compile targets, asset embedding, embedded SQLite)
- [Bun issue #23852 — embedded directories not fully included](https://github.com/oven-sh/bun/issues/23852)
- [Bundling a Node.js web app into a single executable with Bun](https://hiddentao.com/archives/2024/11/16/bundling-your-nodejs-web-app-into-a-single-executable-using-bun/) (embedding a frontend build, practical walkthrough)
- [Tauri v2 — Embedding external binaries (sidecar)](https://v2.tauri.app/develop/sidecar/), [Updater plugin](https://v2.tauri.app/plugin/updater/)
- [SvelteKit — adapter-static](https://svelte.dev/docs/kit/adapter-static)
- [Actual Budget — FAQ / architecture](https://actualbudget.org/docs/faq/) (precedent: local-first finance app, browser-served UI)
